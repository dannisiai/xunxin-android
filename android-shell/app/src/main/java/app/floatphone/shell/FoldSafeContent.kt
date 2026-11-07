package app.floatphone.shell

import android.graphics.Rect
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect

/** Native full-screen pages keep controls on one unobscured physical screen. */
fun installFoldSafeContent(activity: AppCompatActivity, content: View, onSize: (Int, Int) -> Unit) {
    WindowCompat.setDecorFitsSystemWindows(activity.window, false)
    val frame = FrameLayout(activity).apply { setBackgroundColor(android.graphics.Color.rgb(22, 26, 34)) }
    frame.addView(content, FrameLayout.LayoutParams(-1, -1))
    activity.setContentView(frame)
    var insets = androidx.core.graphics.Insets.NONE
    var fold: FoldingFeature? = null
    var lastRect: Rect? = null
    fun reflow() {
        if (frame.width <= 0 || frame.height <= 0) return
        val available = Rect(insets.left, insets.top, maxOf(insets.left + 1, frame.width - insets.right), maxOf(insets.top + 1, frame.height - insets.bottom))
        val feature = fold
        val location = IntArray(2).also { frame.getLocationInWindow(it) }
        val hinge = feature?.bounds?.let { Rect(it).apply { offset(-location[0], -location[1]) } }
        val segments = when {
            feature?.isSeparating == true && hinge != null && feature.orientation == FoldingFeature.Orientation.VERTICAL
                && hinge.left > available.left && hinge.right < available.right -> listOf(
                    Rect(available.left, available.top, hinge.left, available.bottom), Rect(hinge.right, available.top, available.right, available.bottom))
            feature?.isSeparating == true && hinge != null && feature.orientation == FoldingFeature.Orientation.HORIZONTAL
                && hinge.top > available.top && hinge.bottom < available.bottom -> listOf(
                    Rect(available.left, available.top, available.right, hinge.top), Rect(available.left, hinge.bottom, available.right, available.bottom))
            else -> listOf(available)
        }
        val safe = segments.maxByOrNull { it.width().toLong() * it.height() } ?: available
        if (safe == lastRect) return
        lastRect = Rect(safe)
        content.layoutParams = FrameLayout.LayoutParams(safe.width(), safe.height(), Gravity.TOP or Gravity.LEFT).apply {
            leftMargin = safe.left
            topMargin = safe.top
        }
        onSize(safe.width(), safe.height())
    }
    frame.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> reflow() }
    ViewCompat.setOnApplyWindowInsetsListener(frame) { _, value ->
        insets = value.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        reflow()
        value
    }
    ViewCompat.requestApplyInsets(frame)
    activity.lifecycleScope.launch {
        activity.repeatOnLifecycle(Lifecycle.State.STARTED) {
            WindowInfoTracker.getOrCreate(activity).windowLayoutInfo(activity).collect { info ->
                fold = info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull()
                reflow()
            }
        }
    }
}
