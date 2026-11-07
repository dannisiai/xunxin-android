package app.floatphone.shell

import android.graphics.Point
import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.view.WindowManager
import androidx.window.layout.FoldingFeature

/** Bounds are screen pixels, never WebView/CSS pixels or overlay LayoutParams offsets. */
data class OverlayDisplayFrame(val displayId: Int, val rotation: Int, val bounds: Rect)
data class OverlayFoldSnapshot(
    val bounds: Rect?,
    val orientation: String?,
    val frame: OverlayDisplayFrame,
    val observedAtNanos: Long = SystemClock.elapsedRealtimeNanos(),
) {
    fun inFrame(target: OverlayDisplayFrame): OverlayFoldSnapshot? {
        if (frame.displayId != target.displayId) return null
        var width = frame.bounds.width()
        var height = frame.bounds.height()
        val turns = (target.rotation - frame.rotation + 4) % 4
        var rotated = bounds?.let { Rect(it).apply { offset(-frame.bounds.left, -frame.bounds.top) } }
        repeat(turns) {
            rotated = rotated?.let { Rect(height - it.bottom, it.left, height - it.top, it.right) }
            val previousWidth = width
            width = height
            height = previousWidth
        }
        // A resized/folded display is not just a rotated copy. Do not rescale an old hinge.
        if (width != target.bounds.width() || height != target.bounds.height()) return null
        rotated?.offset(target.bounds.left, target.bounds.top)
        val direction = if (orientation != null && turns % 2 == 1) {
            if (orientation == "vertical") "horizontal" else "vertical"
        } else orientation
        return OverlayFoldSnapshot(rotated, direction, target, observedAtNanos)
    }
}

@Suppress("DEPRECATION")
fun overlayDisplayFrame(windows: WindowManager): OverlayDisplayFrame {
    val display = windows.defaultDisplay
    val bounds = if (Build.VERSION.SDK_INT >= 30) Rect(windows.maximumWindowMetrics.bounds)
        else Point().let { size ->
            display.getRealSize(size)
            Rect(0, 0, size.x.coerceAtLeast(1), size.y.coerceAtLeast(1))
        }
    return OverlayDisplayFrame(display.displayId, display.rotation, bounds)
}

/** Accept a separating line as well as a physical gap; Rect.isEmpty rejects valid zero-width folds. */
fun overlayFoldSnapshot(feature: FoldingFeature, area: Rect, frame: OverlayDisplayFrame,
    observedAtNanos: Long = SystemClock.elapsedRealtimeNanos()): OverlayFoldSnapshot? {
    if (area.isEmpty || !frame.bounds.contains(area)) return null
    val bounds = Rect(feature.bounds)
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > area.width() || bounds.bottom > area.height()
        || bounds.right < bounds.left || bounds.bottom < bounds.top) return null
    val vertical = when (feature.orientation) {
        FoldingFeature.Orientation.VERTICAL -> true
        FoldingFeature.Orientation.HORIZONTAL -> false
        else -> return null
    }
    val valid = if (vertical) bounds.top == 0 && bounds.bottom == area.height() && bounds.width() < area.width()
        else bounds.left == 0 && bounds.right == area.width() && bounds.height() < area.height()
    if (!valid) return null
    if (!feature.isSeparating) return OverlayFoldSnapshot(null, null, frame, observedAtNanos)
    bounds.offset(area.left, area.top)
    return OverlayFoldSnapshot(bounds, if (vertical) "vertical" else "horizontal", frame, observedAtNanos)
}
