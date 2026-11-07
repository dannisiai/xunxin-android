package app.floatphone.shell

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import android.widget.FrameLayout
import android.widget.TextView
import android.view.Gravity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.retryWhen
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Float 小手机安卓壳：全屏 WebView 直接加载线上站点。
 * 网页每次部署即时生效，本壳只负责原生能力（推送长连接、文件上下行、外链）。
 */
class MainActivity : AppCompatActivity() {

    companion object {
        val SITE_URL: String = BuildConfig.SITE_URL
        const val VERSION = "1.2.1"
        var companionHost: WeakReference<MainActivity> = WeakReference(null)
        @Volatile var currentFoldInfo: JSONObject? = null
        @Volatile var currentOverlayFold: OverlayFoldSnapshot? = null
        /** 来电接听等场景的站内深链（必须以 SITE_URL 开头，否则忽略） */
        const val EXTRA_OPEN_URL = "open_url"
    }

    private var latestWindowLayout: OverlayFoldObservation? = null
    private lateinit var webView: WebView
    private lateinit var webViewWindow: WebViewWindowController
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCompanion: Bundle? = null
    private var pendingDocumentExport: String? = null

    private val documentExportLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val base64 = pendingDocumentExport ?: return@registerForActivityResult
        pendingDocumentExport = null
        val target = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || target == null) return@registerForActivityResult
        val resolver = applicationContext.contentResolver
        Thread {
            val saved = runCatching {
                val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                val output = resolver.openOutputStream(target) ?: error("无法写入文件")
                output.use { it.write(bytes) }
            }.isSuccess
            runOnUiThread { Toast.makeText(this, if (saved) "文档已保存" else "文档保存失败，请重试", Toast.LENGTH_LONG).show() }
        }.start()
    }

    private val overlayPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        if (pendingCompanion != null && Settings.canDrawOverlays(this)) requestCompanionCaptureConsent()
        else {
            pendingCompanion = null
            Toast.makeText(this, "未开启悬浮窗权限，无法显示 AI 伴侣", Toast.LENGTH_LONG).show()
        }
    }

    private val companionCaptureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val config = pendingCompanion ?: return@registerForActivityResult
        pendingCompanion = null
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            Toast.makeText(this, "未允许屏幕共享，点击应用可以重新开启陪伴", Toast.LENGTH_LONG).show()
            return@registerForActivityResult
        }
        runCatching {
            ContextCompat.startForegroundService(this, Intent(this, CompanionOverlayService::class.java)
                .putExtras(config).putExtra("projectionData", data))
        }.onFailure { Toast.makeText(this, "无法启动 AI 伴侣，请重新打开后重试", Toast.LENGTH_LONG).show() }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        val data = result.data?.data
        callback.onReceiveValue(if (data != null) arrayOf(data) else emptyArray())
    }

    private val notifPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) PushService.start(this)
    }

    // 网页侧 getUserMedia（通话按住说话、语音条录音、视频通话摄像头）触发的
    // WebView 权限请求：先要系统运行时权限，拿到后再转授给页面。
    // 不实现 onPermissionRequest 时 WebView 会静默拒绝，页面永远拿不到麦克风。
    private var pendingWebPermissionRequest: android.webkit.PermissionRequest? = null

    private val webPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        val request = pendingWebPermissionRequest ?: return@registerForActivityResult
        pendingWebPermissionRequest = null
        val granted = request.resources.filter { resource ->
            webResourcePermissions(resource).all {
                ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
            }
        }
        if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
    }

    private fun webResourcePermissions(resource: String): List<String> = when (resource) {
        android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE -> listOf(Manifest.permission.RECORD_AUDIO)
        android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE -> listOf(Manifest.permission.CAMERA)
        else -> emptyList()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        companionHost = WeakReference(this)
        pendingCompanion = savedInstanceState?.getBundle("pendingCompanion")
        // 音量键默认调媒体流：WebView 里的语音条/TTS 都走媒体流播放，
        // 不设的话短音频没在播时按键调的是铃声，用户感觉"音量键无效、声音巨大"
        volumeControlStream = AudioManager.STREAM_MUSIC

        webView = WebView(this)
        val loading = TextView(this).apply {
            text = "寻信正在启动…\n首次打开需要准备应用文件，请稍候。"
            gravity = Gravity.CENTER
            textSize = 16f
        }
        val container = FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(-1, -1))
            if (BuildConfig.LOCAL_BUNDLE) addView(loading, FrameLayout.LayoutParams(-1, -1))
        }
        setContentView(container)
        webViewWindow = WebViewWindowController(this, container, webView) { isTrustedPage() }
        webViewWindow.install()
        webView.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            if (left != oldLeft || top != oldTop || right != oldRight || bottom != oldBottom) {
                webViewWindow.viewportChanged()
                latestWindowLayout?.let { updateFoldState(it) }
            }
        }

        webView.settings.apply {
            useWideViewPort = true
            loadWithOverviewMode = false
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            userAgentString = "$userAgentString FloatShell/$VERSION"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        webView.addJavascriptInterface(ShellBridge(), "AndroidShell")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                val current = runCatching { Uri.parse(url) }.getOrNull()
                val site = Uri.parse(SITE_URL)
                if (current?.scheme == site.scheme && current?.host == site.host && current?.port == site.port) {
                    view.evaluateJavascript("document.documentElement.dataset.androidShell='1'", null)
                    webViewWindow.viewportChanged(force = true)
                    currentFoldInfo?.let { fold ->
                        view.evaluateJavascript("window.__updateDeviceFoldInfo && window.__updateDeviceFoldInfo($fold)", null)
                    }
                }
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val scheme = url.scheme ?: return false
                if (scheme == "floatshell" && url.host == "companion") {
                    if (request.isForMainFrame && request.hasGesture() && isTrustedPage()) {
                        requestCompanion(url)
                    }
                    return true
                }
                // 站内导航留在壳里；http(s) 外链和自定义协议（shortcuts:// 等）交给系统
                if (scheme == "http" || scheme == "https") {
                    if (url.host == Uri.parse(SITE_URL).host) return false
                    return runCatching {
                        startActivity(Intent(Intent.ACTION_VIEW, url)); true
                    }.getOrDefault(true)
                }
                return runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, url)); true
                }.getOrDefault(true)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                val supported = request.resources.filter { webResourcePermissions(it).isNotEmpty() }
                if (supported.isEmpty()) { request.deny(); return }
                val missing = supported.flatMap { webResourcePermissions(it) }
                    .distinct()
                    .filter { ContextCompat.checkSelfPermission(this@MainActivity, it) != PackageManager.PERMISSION_GRANTED }
                if (missing.isEmpty()) { request.grant(supported.toTypedArray()); return }
                if (pendingWebPermissionRequest != null) { request.deny(); return }
                pendingWebPermissionRequest = request
                webPermissionLauncher.launch(missing.toTypedArray())
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePathCallback?.onReceiveValue(emptyArray())
                filePathCallback = callback
                return runCatching {
                    fileChooserLauncher.launch(params.createIntent()); true
                }.getOrElse {
                    filePathCallback = null; false
                }
            }
        }

        // 备份导出等下载：交给系统下载管理器，落到公共下载目录
        webView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            runCatching {
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    // blob/data 由页面内 JS 触发的 a[download] 处理；提示用户等待
                    Toast.makeText(this, "正在导出…", Toast.LENGTH_SHORT).show()
                    return@DownloadListener
                }
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    addRequestHeader("User-Agent", userAgent)
                    addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType),
                    )
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "已开始下载到「下载」目录", Toast.LENGTH_SHORT).show()
            }
        })

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
            }
        })

        // 冷启动带深链（如来电接听）直接加载目标；否则加载首页
        if (BuildConfig.LOCAL_BUNDLE) {
            LocalNodeRuntime.start(this) { localUrl, error ->
                if (isFinishing || isDestroyed) return@start
                if (localUrl != null) {
                    container.removeView(loading)
                    webView.loadUrl(localUrl)
                } else {
                    loading.text = error ?: "本地服务启动失败"
                }
            }
        } else {
            webView.loadUrl(consumeOpenUrl(intent) ?: SITE_URL)
            ensurePushService()
        }

        lifecycleScope.launch {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                observeOverlayFolds(this@MainActivity, windowManager) {
                    WindowInfoTracker.getOrCreate(this@MainActivity).windowLayoutInfo(this@MainActivity)
                }.retryWhen { cause, attempt ->
                    val retry = attempt < 2 && cause is Exception && cause !is SecurityException
                        && cause !is UnsupportedOperationException
                    if (retry) delay(250L shl attempt.toInt())
                    retry
                }.catch { failure ->
                    if (failure !is Exception && failure !is LinkageError && failure !is NotImplementedError) throw failure
                    latestWindowLayout = null
                }.collect { observation ->
                    latestWindowLayout = observation
                    updateFoldState(observation)
                }
            }
        }
    }

    private fun updateFoldState(observation: OverlayFoldObservation) {
        if (webView.width <= 0 || webView.height <= 0) return
        val matchesWindow = runCatching { observation.frame == overlayDisplayFrame(windowManager)
            && observation.area == overlayWindowArea(this, windowManager) }.getOrDefault(false)
        if (!matchesWindow) return
        val layoutInfo = observation.layout
        val feature = layoutInfo.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull()
        val density = resources.displayMetrics.density
        val location = IntArray(2).also { webView.getLocationInWindow(it) }
        val json = JSONObject().apply {
            put("hasFold", feature != null)
            put("viewportWidth", webView.width / density)
            put("viewportHeight", webView.height / density)
        }
        if (feature != null) {
            val bounds = feature.bounds
            val orientation = if (feature.orientation == FoldingFeature.Orientation.VERTICAL) "vertical" else "horizontal"
            val left = (bounds.left - location[0]).coerceIn(0, webView.width)
            val top = (bounds.top - location[1]).coerceIn(0, webView.height)
            val right = (bounds.right - location[0]).coerceIn(left, webView.width)
            val bottom = (bounds.bottom - location[1]).coerceIn(top, webView.height)
            json.put("posture", if (feature.state == FoldingFeature.State.HALF_OPENED) "folded" else "continuous")
                .put("orientation", orientation).put("isSeparating", feature.isSeparating)
                .put("bounds", JSONObject().put("left", left / density).put("top", top / density)
                    .put("width", (right - left) / density).put("height", (bottom - top) / density))
        }
        // Keep an explicit display fingerprint: an Activity cache may outlive rotation or resizing.
        // A partial Activity reporting no hinge cannot clear geometry belonging to another pane.
        currentOverlayFold = runCatching {
            val frame = overlayDisplayFrame(windowManager)
            val next = observation.snapshot()
            val cached = currentOverlayFold?.inFrame(frame)
            if (next != null && (cached == null || next.observedAtNanos >= cached.observedAtNanos)) next else cached
        }.getOrNull()
        if (layoutInfo.displayFeatures.isEmpty() && !observation.confirmedEmpty
            && currentFoldInfo?.optBoolean("hasFold") == true) return
        currentFoldInfo = json
        CompanionOverlayService.current?.onFoldChanged(currentOverlayFold)
        // The web layer is the single owner of CSS geometry, including viewport scaling.
        if (isTrustedPage()) webView.evaluateJavascript("window.__updateDeviceFoldInfo && window.__updateDeviceFoldInfo($json)", null)
    }

    /** singleTask：App 已在运行时（如全屏来电页接听）通过 onNewIntent 送达深链 */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val target = consumeOpenUrl(intent) ?: return
        // SPA 已加载：loadUrl 到同页 hash 只触发 hashchange，不会整页重载
        webView.loadUrl(target)
    }

    private fun consumeOpenUrl(intent: Intent?): String? {
        val target = intent?.getStringExtra(EXTRA_OPEN_URL) ?: return null
        intent.removeExtra(EXTRA_OPEN_URL)
        return target.takeIf { it.startsWith(SITE_URL) }
    }

    private fun ensurePushService() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            PushService.start(this)
        }
    }

    private fun isTrustedPage(): Boolean {
        val current = runCatching { Uri.parse(webView.url) }.getOrNull() ?: return false
        val site = Uri.parse(SITE_URL)
        return current.scheme == site.scheme && current.host == site.host && current.port == site.port
    }

    private fun requestCompanion(url: Uri) {
        if (pendingCompanion != null) return
        val appId = url.getQueryParameter("app") ?: return
        val target = CompanionOverlayService.targetPackage(appId) ?: return
        val characterId = url.getQueryParameter("characterId")?.takeIf { it.isNotBlank() && it.length <= 200 } ?: return
        if (packageManager.getLaunchIntentForPackage(target) == null) {
            Toast.makeText(this, "请先安装${if (appId == "douyin") "抖音" else "小红书"} App", Toast.LENGTH_LONG).show()
            return
        }
        stopService(Intent(this, CompanionOverlayService::class.java))
        pendingCompanion = Bundle().apply {
            putString("appId", appId); putString("characterId", characterId)
            putString("name", url.getQueryParameter("name")?.take(80) ?: "AI 伴侣")
        }
        if (Settings.canDrawOverlays(this)) { requestCompanionCaptureConsent(); return }
        Toast.makeText(this, "请允许小手机显示悬浮窗，返回后继续", Toast.LENGTH_LONG).show()
        runCatching {
            overlayPermissionLauncher.launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }.onFailure {
            pendingCompanion = null
            Toast.makeText(this, "无法打开悬浮窗权限设置", Toast.LENGTH_LONG).show()
        }
    }

    private fun requestCompanionCaptureConsent() {
        runCatching {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val consent = if (Build.VERSION.SDK_INT >= 34) manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                else manager.createScreenCaptureIntent()
            companionCaptureLauncher.launch(consent)
        }.onFailure {
            pendingCompanion = null
            Toast.makeText(this, "无法请求屏幕共享权限", Toast.LENGTH_LONG).show()
        }
    }

    fun dispatchCompanionEvent(name: String, detail: JSONObject) {
        if (isFinishing || isDestroyed || !isTrustedPage()) {
            stopService(Intent(this, CompanionOverlayService::class.java))
            return
        }
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent(${JSONObject.quote(name)},{detail:$detail}))", null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBundle("pendingCompanion", pendingCompanion)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        if (companionHost.get() === this) {
            companionHost.clear()
            stopService(Intent(this, CompanionOverlayService::class.java))
        }
        CookieManager.getInstance().flush()
        webView.destroy()
        super.onDestroy()
    }

    /** 暴露给网页的原生桥（网页侧可用 window.AndroidShell 特性检测壳环境）。 */
    inner class ShellBridge {
        @JavascriptInterface
        fun getVersion(): String = VERSION

        @JavascriptInterface
        fun supportsCompanionOverlay(): Boolean = true

        /** Save a user-selected document through Android's system file picker. */
        @JavascriptInterface
        fun saveDocumentFile(base64: String, name: String, mime: String) {
            if (base64.length > 40 * 1024 * 1024) return
            runOnUiThread {
                if (!isTrustedPage()) return@runOnUiThread
                if (pendingDocumentExport != null) {
                    Toast.makeText(this@MainActivity, "请先完成当前文件保存", Toast.LENGTH_SHORT).show()
                    return@runOnUiThread
                }
                pendingDocumentExport = base64
                runCatching {
                    documentExportLauncher.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = mime.takeIf { it.contains('/') } ?: "application/octet-stream"
                        putExtra(Intent.EXTRA_TITLE, name.substringAfterLast('/').substringAfterLast('\\').take(240))
                    })
                }.onFailure {
                    pendingDocumentExport = null
                    Toast.makeText(this@MainActivity, "无法打开文件保存窗口", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun setCompanionAvatar(overlayId: String, dataUrl: String) {
            runOnUiThread { if (isTrustedPage()) CompanionOverlayService.current?.setAvatar(overlayId, dataUrl) }
        }

        @JavascriptInterface
        fun completeCompanionRequest(overlayId: String, requestId: String, text: String, isError: Boolean) {
            runOnUiThread { if (isTrustedPage()) CompanionOverlayService.current?.complete(overlayId, requestId, text, isError) }
        }

        /** 打开本应用的系统设置页（引导用户关电池限制、开自启动）。 */
        @JavascriptInterface
        fun openAppSettings() {
            runCatching {
                startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }

        /** 请求忽略电池优化（保活关键一步）。 */
        @SuppressLint("BatteryLife")
        @JavascriptInterface
        fun requestIgnoreBatteryOptimization() {
            runCatching {
                startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }

        /** 返回折叠屏铰链/折痕几何与状态信息 */
        @JavascriptInterface
        fun getFoldInfo(): String = currentFoldInfo?.toString() ?: "{\"hasFold\":false}"

        @JavascriptInterface
        fun getDeviceWindowInfo(): String = webViewWindow.snapshot()

        @JavascriptInterface
        fun setSystemBarAppearance(useDarkIcons: Boolean) {
            runOnUiThread { if (isTrustedPage()) webViewWindow.applyBarAppearance(useDarkIcons) }
        }
    }
}
