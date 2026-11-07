package app.floatphone.shell

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Rect
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.util.UUID

/** Small, user-controlled companion bubble; the existing WebView generates and saves replies. */
class CompanionOverlayService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var windows: WindowManager
    private lateinit var foldMonitor: OverlayFoldMonitor
    private val overlayUiContext get() = foldMonitor.uiContext
    private var independentFoldReady = false
    private var capture: CompanionScreenCapture? = null
    private var bubble: FrameLayout? = null
    private var avatar: ImageView? = null
    private var initial: TextView? = null
    private var panel: LinearLayout? = null
    private var transcript: TextView? = null
    private var scroll: ScrollView? = null
    private var input: EditText? = null
    private var readButton: Button? = null
    private var sendButton: Button? = null
    private var requestId: String? = null
    private var overlayId = UUID.randomUUID().toString()
    private var characterId = ""
    private var characterName = ""
    private var appId = ""
    private var busy = false
    private var destroyed = false
    private var foldSnapshot: OverlayFoldSnapshot? = null
    private var lastFoldObservationNanos = Long.MIN_VALUE
    private var imeBottom = 0
    private var unregisterPanelBack: (() -> Unit)? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        foldMonitor = OverlayFoldMonitor(this,
            onFold = { snapshot ->
                if (applyFoldGeometry(snapshot)) independentFoldReady = true
            },
            onUnavailable = { independentFoldReady = false },
            onConfiguration = { reconcileDisplayConfiguration() })
        windows = foldMonitor.windows
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
            NotificationChannel(CHANNEL, "AI 伴侣屏幕陪伴", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CLOSE) { stopSelf(); return START_NOT_STICKY }
        if (capture != null) return START_NOT_STICKY
        val stop = PendingIntent.getService(this, 0, Intent(this, CompanionOverlayService::class.java).setAction(ACTION_CLOSE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val home = PendingIntent.getActivity(this, 0, desktopIntent(),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("AI 伴侣正在陪你浏览")
            .setContentText("点击悬浮头像读取当前屏幕；可随时关闭")
            .setOngoing(true).setContentIntent(home).addAction(0, "关闭陪伴", stop).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        else startForeground(NOTIFICATION_ID, notification)
        try {
            appId = intent?.getStringExtra("appId") ?: ""
            characterId = intent?.getStringExtra("characterId") ?: ""
            characterName = intent?.getStringExtra("name") ?: "AI 伴侣"
            val target = targetPackage(appId) ?: error("不支持的应用")
            if (characterId.isBlank() || MainActivity.companionHost.get() == null) error("请返回小手机重新打开陪伴")
            @Suppress("DEPRECATION")
            val data = intent?.getParcelableExtra<Intent>("projectionData") ?: error("请重新允许屏幕共享")
            current = this
            onFoldChanged(MainActivity.currentOverlayFold)
            capture = CompanionScreenCapture(this) {
                Toast.makeText(this, "屏幕共享已结束，陪伴悬浮窗已关闭", Toast.LENGTH_LONG).show()
                stopSelf()
            }.also { it.start(data) }
            showBubble()
            foldMonitor.start()
            val host = MainActivity.companionHost.get() ?: error("请返回小手机")
            host.dispatchCompanionEvent("android-companion-avatar", JSONObject().put("overlayId", overlayId).put("characterId", characterId))
            val launch = packageManager.getLaunchIntentForPackage(target) ?: error("请先安装${appName()}")
            startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (error: Exception) {
            Toast.makeText(this, error.message ?: "无法启动屏幕陪伴", Toast.LENGTH_LONG).show()
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun appName() = if (appId == "douyin") "抖音" else "小红书"
    private fun dp(value: Int) = (value * overlayUiContext.resources.displayMetrics.density).toInt()
    private fun background(color: Int, radius: Float) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius.toInt()).toFloat() }

    private fun showBubble() {
        val root = FrameLayout(overlayUiContext).apply {
            background = background(Color.rgb(255, 230, 239), 32f)
            clipToOutline = true
            contentDescription = "点击让${characterName}看看当前屏幕，拖动移动"
        }
        initial = TextView(overlayUiContext).apply { text = characterName.take(1); textSize = 24f; gravity = Gravity.CENTER; setTextColor(Color.rgb(155, 66, 103)) }
        root.addView(initial, FrameLayout.LayoutParams(-1, -1))
        avatar = ImageView(overlayUiContext).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        root.addView(avatar, FrameLayout.LayoutParams(-1, -1))
        val params = WindowManager.LayoutParams(dp(60), dp(60), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START; x = dp(16); y = dp(140)
        }
        var downX = 0f; var downY = 0f; var originalX = 0; var originalY = 0; var moved = false
        val slop = ViewConfiguration.get(overlayUiContext).scaledTouchSlop
        root.setOnClickListener { if (busy) showPanel() else requestScreen("") }
        root.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; originalX = params.x; originalY = params.y; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX; val dy = event.rawY - downY
                    if (kotlin.math.abs(dx) > slop || kotlin.math.abs(dy) > slop) moved = true
                    if (moved) {
                        params.x = originalX + dx.toInt()
                        params.y = originalY + dy.toInt()
                        fitBubble(params)
                        windows.updateViewLayout(root, params)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> { if (!moved) view.performClick(); true }
                MotionEvent.ACTION_CANCEL -> true
                else -> false
            }
        }
        fitBubble(params)
        windows.addView(root, params)
        bubble = root
    }

    private fun button(label: String, action: () -> Unit) = Button(overlayUiContext).apply {
        text = label; textSize = 13f; isAllCaps = false; minWidth = 0; minimumWidth = 0
        setOnClickListener { action() }
    }

    private fun showPanel() {
        if (destroyed) return
        panel?.let {
            it.visibility = View.VISIBLE
            setPanelFocusable(true)
            it.post { if (!destroyed && it.visibility == View.VISIBLE) registerPanelBack(it) }
            reflowOverlays()
            return
        }
        val root = object : LinearLayout(overlayUiContext) {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                    if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) handlePanelBack()
                    return true
                }
                return super.dispatchKeyEvent(event)
            }
        }.apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(12))
            background = background(Color.rgb(255, 248, 251), 18f)
            elevation = dp(8).toFloat()
            isFocusableInTouchMode = true
        }
        val header = LinearLayout(overlayUiContext).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(TextView(overlayUiContext).apply { text = characterName; textSize = 17f; setTextColor(Color.rgb(77, 43, 62)) }, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(button("收起") { hidePanel() })
        header.addView(button("×") { stopSelf() })
        root.addView(header)
        root.addView(button("‹ 返回寻信桌面") { returnToDesktop() }, LinearLayout.LayoutParams(-1, dp(44)))
        transcript = TextView(overlayUiContext).apply { textSize = 15f; setTextColor(Color.rgb(64, 48, 60)); setTextIsSelectable(true); text = "点击头像，和${characterName}一起看看${appName()}。" }
        scroll = ScrollView(overlayUiContext).apply { addView(transcript) }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        readButton = button("看看当前屏幕") { requestScreen("") }
        root.addView(readButton)
        val row = LinearLayout(overlayUiContext).apply { gravity = Gravity.CENTER_VERTICAL }
        input = EditText(overlayUiContext).apply { hint = "想跟他说什么…"; textSize = 14f; maxLines = 3; setTextColor(Color.rgb(64, 48, 60)) }
        row.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
        sendButton = button("发送") {
            val text = input?.text?.toString()?.trim().orEmpty()
            if (text.isNotBlank()) { input?.setText(""); requestScreen(text) }
        }
        row.addView(sendButton)
        root.addView(row)
        val params = WindowManager.LayoutParams(
            dp(340), dp(430), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        fitPanel(params)
        windows.addView(root, params)
        panel = root
        root.requestFocus()
        root.post { if (!destroyed && root.visibility == View.VISIBLE) registerPanelBack(root) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val next = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            if (next != imeBottom) {
                imeBottom = next
                root.post { if (!destroyed) reflowOverlays() }
            }
            insets
        }
        ViewCompat.requestApplyInsets(root)
        updateBusy()
    }

    private fun safeSegments(): List<Rect> {
        val frame = overlayDisplayFrame(windows)
        val metrics = if (Build.VERSION.SDK_INT >= 30) windows.currentWindowMetrics else null
        val area = metrics?.bounds ?: frame.bounds
        val width = area.width().coerceAtLeast(1)
        val height = area.height().coerceAtLeast(1)
        val full = Rect(0, 0, width, height)
        if (Build.VERSION.SDK_INT >= 30) {
            val insets = metrics!!.windowInsets.getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            full.set(insets.left.coerceIn(0, width - 1), insets.top.coerceIn(0, height - 1),
                (width - insets.right).coerceIn(1, width), (height - insets.bottom).coerceIn(1, height))
        } else {
            val statusId = resources.getIdentifier("status_bar_height", "dimen", "android")
            val navId = resources.getIdentifier("navigation_bar_height", "dimen", "android")
            full.top = if (statusId > 0) resources.getDimensionPixelSize(statusId) else dp(24)
            full.bottom = maxOf(full.top + 1, height - if (navId > 0) resources.getDimensionPixelSize(navId) else dp(24))
        }
        full.bottom = minOf(full.bottom, maxOf(full.top + 1, height - imeBottom))
        if (full.isEmpty) return listOf(Rect(0, 0, width, height))
        val snapshot = foldSnapshot?.inFrame(frame) ?: return listOf(full)
        // WindowContext LayoutParams are local to the current display area, not the maximum display.
        val hinge = snapshot.bounds?.let { Rect(it).apply { offset(-area.left, -area.top) } } ?: return listOf(full)
        val parts = when {
            snapshot.orientation == "vertical" -> listOf(
                Rect(full.left, full.top, minOf(full.right, hinge.left), full.bottom), Rect(maxOf(full.left, hinge.right), full.top, full.right, full.bottom))
            snapshot.orientation == "horizontal" -> listOf(
                Rect(full.left, full.top, full.right, minOf(full.bottom, hinge.top)), Rect(full.left, maxOf(full.top, hinge.bottom), full.right, full.bottom))
            else -> listOf(full)
        }
        // Never fall back across a known hinge just because both remaining segments are narrow.
        return parts.filter { it.width() > 0 && it.height() > 0 }.ifEmpty { listOf(full) }
    }

    private fun segmentAt(x: Int, y: Int): Rect = safeSegments().minByOrNull {
        val dx = maxOf(it.left - x, 0, x - it.right).toLong()
        val dy = maxOf(it.top - y, 0, y - it.bottom).toLong()
        dx * dx + dy * dy
    }!!

    private fun fitBubble(params: WindowManager.LayoutParams) {
        val segment = segmentAt(params.x + params.width / 2, params.y + params.height / 2)
        params.gravity = Gravity.TOP or Gravity.LEFT
        params.width = minOf(dp(60), segment.width())
        params.height = minOf(dp(60), segment.height())
        params.x = params.x.coerceIn(segment.left, maxOf(segment.left, segment.right - params.width))
        params.y = params.y.coerceIn(segment.top, maxOf(segment.top, segment.bottom - params.height))
    }

    private fun fitPanel(params: WindowManager.LayoutParams) {
        val bubbleParams = bubble?.layoutParams as? WindowManager.LayoutParams
        val segment = if (bubbleParams != null) segmentAt(bubbleParams.x + bubbleParams.width / 2, bubbleParams.y + bubbleParams.height / 2)
            else safeSegments().maxByOrNull { it.width().toLong() * it.height() }!!
        val margin = minOf(dp(12), minOf(segment.width(), segment.height()) / 8)
        params.gravity = Gravity.TOP or Gravity.LEFT
        params.width = minOf(dp(340), segment.width() - margin * 2)
        params.height = minOf(dp(430), segment.height() - margin * 2)
        params.x = segment.left + (segment.width() - params.width) / 2
        params.y = segment.bottom - margin - params.height
    }

    private fun reflowOverlays() {
        bubble?.let { view ->
            val params = view.layoutParams as WindowManager.LayoutParams
            fitBubble(params)
            if (view.isAttachedToWindow) runCatching { windows.updateViewLayout(view, params) }
        }
        panel?.let { view ->
            val params = view.layoutParams as WindowManager.LayoutParams
            fitPanel(params)
            if (view.isAttachedToWindow) runCatching { windows.updateViewLayout(view, params) }
        }
    }

    fun onFoldChanged(snapshot: OverlayFoldSnapshot?) {
        if (snapshot == null || independentFoldReady && snapshot.observedAtNanos <= lastFoldObservationNanos) return
        val compatible = runCatching { snapshot.inFrame(overlayDisplayFrame(windows)) }.getOrNull() ?: return
        runCatching { applyFoldGeometry(compatible) }
    }

    private fun applyFoldGeometry(snapshot: OverlayFoldSnapshot): Boolean {
        // A cached Activity update must not resurrect a hinge cleared by a newer observation.
        if (snapshot.observedAtNanos < lastFoldObservationNanos) return false
        lastFoldObservationNanos = snapshot.observedAtNanos
        foldSnapshot = snapshot
        val cached = MainActivity.currentOverlayFold
        if (cached == null || cached.observedAtNanos <= snapshot.observedAtNanos) MainActivity.currentOverlayFold = snapshot
        reflowOverlays()
        return true
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        foldMonitor.configurationChanged()
    }

    private fun reconcileDisplayConfiguration() {
        (bubble?.layoutParams as? WindowManager.LayoutParams)?.let { params ->
            params.width = dp(60)
            params.height = dp(60)
        }
        foldSnapshot = foldSnapshot?.inFrame(overlayDisplayFrame(windows))
        imeBottom = 0
        reflowOverlays()
        panel?.let { ViewCompat.requestApplyInsets(it) }
    }

    private fun hidePanel() {
        panel?.windowToken?.let { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(it, 0) }
        unregisterPanelBack?.invoke(); unregisterPanelBack = null
        input?.clearFocus()
        setPanelFocusable(false)
        panel?.visibility = View.GONE
    }

    private fun setPanelFocusable(focusable: Boolean) {
        val root = panel ?: return
        val params = root.layoutParams as? WindowManager.LayoutParams ?: return
        params.flags = if (focusable) params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
            else params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        windows.updateViewLayout(root, params)
        if (focusable) root.requestFocus()
    }

    private fun registerPanelBack(root: View) {
        if (Build.VERSION.SDK_INT < 33) return
        unregisterPanelBack?.invoke(); unregisterPanelBack = null
        val dispatcher = root.findOnBackInvokedDispatcher() ?: return
        val callback = OnBackInvokedCallback { handlePanelBack() }
        dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY, callback)
        unregisterPanelBack = { dispatcher.unregisterOnBackInvokedCallback(callback) }
    }

    private fun handlePanelBack() {
        val root = panel ?: return
        if (root.visibility != View.VISIBLE) return
        if (ViewCompat.getRootWindowInsets(root)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(root.windowToken, 0)
            input?.clearFocus()
            root.requestFocus()
            return
        }
        returnToDesktop()
    }

    private fun desktopIntent() = Intent(this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(MainActivity.EXTRA_RETURN_TO_DESKTOP, true)

    private fun returnToDesktop() {
        runCatching { startActivity(desktopIntent()) }
            .onSuccess { hidePanel(); stopSelf() }
            .onFailure { Toast.makeText(this, "无法返回寻信，请从最近任务打开寻信", Toast.LENGTH_SHORT).show() }
    }

    private fun updateBusy() { readButton?.isEnabled = !busy; sendButton?.isEnabled = !busy; input?.isEnabled = !busy }

    private fun append(text: String) {
        showPanel()
        transcript?.let { it.text = (it.text.toString() + "\n\n" + text).takeLast(16000) }
        scroll?.post { scroll?.fullScroll(View.FOCUS_DOWN) }
    }

    private fun requestScreen(text: String) {
        if (busy || destroyed) return
        val host = MainActivity.companionHost.get()
        if (host == null) { Toast.makeText(this, "请返回小手机重新打开陪伴", Toast.LENGTH_LONG).show(); stopSelf(); return }
        busy = true; updateBusy()
        val id = UUID.randomUUID().toString()
        requestId = id
        hidePanel()
        bubble?.visibility = View.INVISIBLE
        // Let the compositor remove our bubble/panel and keyboard before reading.
        handler.postDelayed({
            if (destroyed || requestId != id) return@postDelayed
            capture?.capture { image, error ->
                if (destroyed || requestId != id) return@capture
                bubble?.visibility = View.VISIBLE
                if (image == null) { complete(overlayId, id, error ?: "没有读到屏幕", true); return@capture }
                append(if (text.isBlank()) "${characterName}正在看当前屏幕…" else "我：$text\n${characterName}正在看当前屏幕…")
                host.dispatchCompanionEvent("android-companion-screen", JSONObject()
                    .put("overlayId", overlayId).put("requestId", id).put("characterId", characterId)
                    .put("appId", appId).put("imageDataUrl", image).put("text", text))
                handler.postDelayed({
                    if (requestId == id) complete(overlayId, id, "回复等待时间较长，请检查网络和 API；已发送的内容保留在聊天中。", true)
                }, 180000)
            }
        }, 300)
    }

    fun complete(session: String, id: String, text: String, isError: Boolean) {
        if (destroyed || session != overlayId || id != requestId) return
        requestId = null; busy = false; bubble?.visibility = View.VISIBLE
        append(if (isError) "提示：$text" else "$characterName：$text")
        updateBusy()
    }

    fun setAvatar(session: String, dataUrl: String) {
        if (destroyed || session != overlayId || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 200000) return
        runCatching {
            val bytes = Base64.decode(dataUrl.substringAfter(','), Base64.DEFAULT)
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
            avatar?.setImageBitmap(bitmap); initial?.visibility = View.GONE
        }
    }

    override fun onDestroy() {
        destroyed = true
        unregisterPanelBack?.invoke(); unregisterPanelBack = null
        if (::foldMonitor.isInitialized) foldMonitor.close()
        handler.removeCallbacksAndMessages(null)
        capture?.close(); capture = null
        panel?.let { runCatching { windows.removeView(it) } }; panel = null
        bubble?.let { runCatching { windows.removeView(it) } }; bubble = null
        if (current === this) current = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "companion_screen_overlay"
        private const val NOTIFICATION_ID = 8204
        private const val ACTION_CLOSE = "app.floatphone.shell.CLOSE_COMPANION"
        var current: CompanionOverlayService? = null
            private set
        fun targetPackage(appId: String): String? = when (appId) {
            "xiaohongshu" -> "com.xingin.xhs"
            "douyin" -> "com.ss.android.ugc.aweme"
            else -> null
        }
    }
}
