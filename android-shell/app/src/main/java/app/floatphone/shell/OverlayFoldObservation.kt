package app.floatphone.shell

import android.app.Activity
import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.view.WindowManager
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowLayoutInfo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

fun overlayWindowArea(context: Context, windows: WindowManager): Rect {
    if (Build.VERSION.SDK_INT >= 30) return Rect(windows.currentWindowMetrics.bounds)
    if (context is Activity) {
        val decor = context.window.decorView
        val origin = IntArray(2).also { decor.getLocationOnScreen(it) }
        return Rect(origin[0], origin[1], origin[0] + decor.width, origin[1] + decor.height)
    }
    return overlayDisplayFrame(windows).bounds
}

/** Observation time belongs to the API emission, not a later WebView resize or cache rotation. */
data class OverlayFoldObservation(
    val layout: WindowLayoutInfo,
    val frame: OverlayDisplayFrame,
    val area: Rect,
    val confirmedEmpty: Boolean = false,
    val observedAtNanos: Long = SystemClock.elapsedRealtimeNanos(),
) {
    fun snapshot(): OverlayFoldSnapshot? {
        val folds = layout.displayFeatures.filterIsInstance<FoldingFeature>()
        val separating = folds.filter { it.isSeparating }
        return when {
            separating.size == 1 -> overlayFoldSnapshot(separating[0], area, frame, observedAtNanos)
            separating.isEmpty() && folds.size == 1 && area == frame.bounds ->
                overlayFoldSnapshot(folds[0], area, frame, observedAtNanos)
            confirmedEmpty && layout.displayFeatures.isEmpty() && area == frame.bounds ->
                OverlayFoldSnapshot(null, null, frame, observedAtNanos)
            else -> null
        }
    }
}

/** Reuse the same settling policy for Activity data and the independent WindowContext stream.
 * Empty is a valid AndroidX result, but an initial/partial/failed query is not enough to clear
 * a known hinge. Keep the primary listener alive while a bounded, cancellable fresh subscription
 * confirms a stable full-window empty result. This does not force an OEM hardware refresh.
 */
fun observeOverlayFolds(
    context: Context,
    windows: WindowManager,
    layouts: () -> Flow<WindowLayoutInfo>,
): Flow<OverlayFoldObservation> = channelFlow {
    var confirmation: Job? = null
    var confirmingFrame: OverlayDisplayFrame? = null
    var confirmingArea: Rect? = null
    var confirmedFrame: OverlayDisplayFrame? = null
    var confirmedArea: Rect? = null
    fun observe(info: WindowLayoutInfo) = OverlayFoldObservation(info, overlayDisplayFrame(windows), overlayWindowArea(context, windows))
    layouts().collect { info ->
        val observation = observe(info)
        val emptyFullWindow = info.displayFeatures.isEmpty() && !observation.area.isEmpty && observation.area == observation.frame.bounds
        if (!emptyFullWindow) {
            confirmation?.cancel()
            confirmation = null
            confirmedFrame = null
            confirmedArea = null
        }
        val alreadyConfirmed = emptyFullWindow && confirmedFrame == observation.frame && confirmedArea == observation.area
        send(observation.copy(confirmedEmpty = alreadyConfirmed))
        if (emptyFullWindow && !alreadyConfirmed && !(confirmation?.isActive == true
                && confirmingFrame == observation.frame && confirmingArea == observation.area)) {
            confirmation?.cancel()
            confirmingFrame = observation.frame
            confirmingArea = observation.area
            confirmation = launch {
                try {
                    delay(750)
                    repeat(2) { attempt ->
                        if (overlayDisplayFrame(windows) != observation.frame || overlayWindowArea(context, windows) != observation.area) return@launch
                        val fresh = try {
                            withTimeoutOrNull(1500) { layouts().first() }
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (failure: Throwable) {
                            if (failure !is Exception && failure !is LinkageError && failure !is NotImplementedError) throw failure
                            null
                        }
                        if (fresh != null) {
                            val next = observe(fresh)
                            if (next.frame != observation.frame || next.area != observation.area) return@launch
                            val confirmed = fresh.displayFeatures.isEmpty()
                            if (confirmed) { confirmedFrame = next.frame; confirmedArea = next.area }
                            send(next.copy(confirmedEmpty = confirmed))
                            return@launch
                        }
                        if (attempt == 0) delay(500)
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Throwable) {
                    if (failure !is Exception && failure !is LinkageError && failure !is NotImplementedError) throw failure
                    // A disappearing/reconfigured window is unknown, never evidence for no hinge.
                }
            }
        }
    }
}
