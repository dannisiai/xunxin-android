package app.floatphone.shell

import android.content.ComponentCallbacks
import android.content.Context
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.WindowManager
import androidx.window.WindowSdkExtensions
import androidx.window.layout.WindowInfoTracker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.launch

/** Reuses AndroidX's non-Activity window API for the lifetime of the overlay service. */
class OverlayFoldMonitor(
    private val service: Context,
    private val onFold: (OverlayFoldSnapshot) -> Unit,
    private val onUnavailable: () -> Unit,
    private val onConfiguration: () -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val displays = service.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
    val uiContext: Context = if (Build.VERSION.SDK_INT >= 30) {
        runCatching {
            val display = displays.getDisplay(Display.DEFAULT_DISPLAY) ?: error("No default display")
            service.createDisplayContext(display).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
        }.getOrDefault(service)
    } else service
    val windows = uiContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    private var started = false
    private var closed = false
    private var callbacksRegistered = false
    private var displayListenerRegistered = false
    private var generation = 0
    private val refresh = Runnable {
        if (!closed) {
            try {
                onConfiguration()
                subscribe()
            } catch (failure: Throwable) {
                if (!recoverable(failure)) throw failure
                onUnavailable()
            }
        }
    }
    private val configurationCallbacks = object : ComponentCallbacks {
        override fun onConfigurationChanged(newConfig: Configuration) = configurationChanged()
        override fun onLowMemory() = Unit
    }
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = Unit
        override fun onDisplayRemoved(displayId: Int) {
            if (displayId == Display.DEFAULT_DISPLAY) configurationChanged()
        }
        override fun onDisplayChanged(displayId: Int) {
            if (displayId == Display.DEFAULT_DISPLAY) configurationChanged()
        }
    }

    /** Call after the first view has been attached with this UI context. */
    fun start() {
        if (closed || started) return
        started = true
        displayListenerRegistered = runCatching { displays.registerDisplayListener(displayListener, handler) }.isSuccess
        if (Build.VERSION.SDK_INT >= 31 && uiContext !== service) {
            callbacksRegistered = runCatching { uiContext.registerComponentCallbacks(configurationCallbacks) }.isSuccess
        }
        configurationChanged()
    }

    fun configurationChanged() {
        if (!started || closed) return
        // Invalidate immediately; an OEM callback from the old registration can already be queued.
        generation++
        job?.cancel()
        job = null
        onUnavailable()
        handler.removeCallbacks(refresh)
        handler.post(refresh)
    }

    private fun subscribe() {
        job?.cancel()
        job = null
        // Unsupported devices emit empty geometry; do not mistake that for a removed hinge.
        val supported = Build.VERSION.SDK_INT >= 30 && uiContext !== service
            && runCatching { WindowSdkExtensions.getInstance().extensionVersion >= 2 }.getOrDefault(false)
        if (!supported) {
            onUnavailable()
            return
        }
        val subscription = generation
        val frame = overlayDisplayFrame(windows)
        val area = android.graphics.Rect(windows.currentWindowMetrics.bounds)
        job = scope.launch {
            try {
                // Tracker creation belongs upstream too, so transient registration failures can retry.
                observeOverlayFolds(uiContext, windows) { WindowInfoTracker.getOrCreate(uiContext).windowLayoutInfo(uiContext) }
                    .retryWhen { cause, attempt ->
                        if (!closed && subscription == generation) onUnavailable()
                        val retry = attempt < 2 && cause is Exception && cause !is SecurityException
                            && cause !is UnsupportedOperationException
                        if (retry) delay(250L shl attempt.toInt())
                        retry
                    }.collect { observation ->
                        if (closed || subscription != generation) return@collect
                        if (frame != observation.frame || area != observation.area
                            || frame != overlayDisplayFrame(windows) || area != windows.currentWindowMetrics.bounds) {
                            configurationChanged()
                            return@collect
                        }
                        val snapshot = observation.snapshot()
                        if (snapshot != null) onFold(snapshot) else onUnavailable()
                    }
                if (!closed && subscription == generation) onUnavailable()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                if (!recoverable(failure)) throw failure
                if (!closed && subscription == generation) onUnavailable()
            }
        }
    }

    private fun recoverable(failure: Throwable) = failure is Exception || failure is LinkageError || failure is NotImplementedError

    fun close() {
        if (closed) return
        closed = true
        generation++
        handler.removeCallbacks(refresh)
        scope.cancel()
        if (displayListenerRegistered) runCatching { displays.unregisterDisplayListener(displayListener) }
        if (callbacksRegistered) runCatching { uiContext.unregisterComponentCallbacks(configurationCallbacks) }
    }
}
