package app.floatphone.shell

import android.graphics.Color
import android.os.Build
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.window.layout.WindowMetricsCalculator
import org.json.JSONObject

/** One owner for real system bars, IME resizing and WebView-local safe-area geometry. */
class WebViewWindowController(
    private val activity: AppCompatActivity,
    private val container: FrameLayout,
    private val webView: WebView,
    private val trustedPage: () -> Boolean,
) {
    @Volatile private var cachedInfo = "{}"
    private var insets: WindowInsetsCompat? = null

    @Suppress("DEPRECATION")
    fun install() {
        activity.enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        if (Build.VERSION.SDK_INT >= 29) {
            activity.window.isStatusBarContrastEnforced = false
            activity.window.isNavigationBarContrastEnforced = false
        }
        // The wallpaper is drawn by the full-size WebView; no opaque status-bar strip sits above it.
        container.setBackgroundColor(Color.rgb(194, 226, 240))
        webView.setBackgroundColor(Color.TRANSPARENT)
        applyBarAppearance(true)
        ViewCompat.setOnApplyWindowInsetsListener(container) { _, value ->
            insets = value
            viewportChanged()
            value
        }
        container.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> viewportChanged() }
        ViewCompat.requestApplyInsets(container)
    }

    fun snapshot(): String = cachedInfo

    fun applyBarAppearance(useDarkIcons: Boolean) {
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
            isAppearanceLightStatusBars = useDarkIcons
            isAppearanceLightNavigationBars = useDarkIcons
        }
    }

    fun viewportChanged(force: Boolean = false) {
        if (container.height <= 0 || webView.width <= 0) return
        val value = insets ?: ViewCompat.getRootWindowInsets(container) ?: return
        val windowBounds = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(activity).bounds
        val origin = IntArray(2).also { container.getLocationInWindow(it) }
        val ime = value.getInsets(WindowInsetsCompat.Type.ime()).bottom
        // Some Android/ZUI versions already apply adjustResize. Deduct only the remaining overlap.
        val alreadyResized = (windowBounds.height() - origin[1] - container.height).coerceAtLeast(0)
        val bottom = (ime - alreadyResized).coerceIn(0, (container.height - 1).coerceAtLeast(0))
        if (container.paddingBottom != bottom) {
            container.setPadding(0, 0, 0, bottom)
            webView.post { publish(force) }
        } else publish(force)
    }

    private fun publish(force: Boolean) {
        if (webView.width <= 0 || webView.height <= 0) return
        val value = insets ?: ViewCompat.getRootWindowInsets(container) ?: return
        val bars = value.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val bounds = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(activity).bounds
        val origin = IntArray(2).also { webView.getLocationInWindow(it) }
        val config = activity.resources.configuration
        val info = JSONObject().apply {
            put("viewWidthPx", webView.width)
            put("viewHeightPx", webView.height)
            put("density", activity.resources.displayMetrics.density)
            put("smallestWidthDp", config.smallestScreenWidthDp)
            put("fontScale", config.fontScale)
            put("manufacturer", Build.MANUFACTURER)
            put("model", Build.MODEL)
            put("sdkInt", Build.VERSION.SDK_INT)
            put("imeVisible", value.isVisible(WindowInsetsCompat.Type.ime()))
            put("insets", JSONObject().apply {
                put("left", (bars.left - origin[0]).coerceAtLeast(0))
                put("top", (bars.top - origin[1]).coerceAtLeast(0))
                put("right", (origin[0] + webView.width - bounds.width() + bars.right).coerceAtLeast(0))
                put("bottom", (origin[1] + webView.height - bounds.height() + bars.bottom).coerceAtLeast(0))
            })
        }.toString()
        if (!force && info == cachedInfo) return
        cachedInfo = info
        if (trustedPage()) webView.evaluateJavascript("window.__updateAndroidWindowInfo && window.__updateAndroidWindowInfo($info)", null)
    }
}
