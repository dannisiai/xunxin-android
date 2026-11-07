package app.floatphone.shell

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.ByteArrayOutputStream

/**
 * ImageReader/row-stride bitmap extraction adapted from ScreenSeek (MIT).
 * Copyright (c) 2026 Hashier Holmes. See third-party/ScreenSeek-LICENSE.txt.
 * https://github.com/hashierholmes/ScreenSeek/blob/main/app/src/main/java/hh/screenseek/app/ScreenCaptureService.java
 * Unlike its one-shot session, keep ONE VirtualDisplay per consent and attach its
 * surface only for an explicit click. Android 14+ forbids reusing consent tokens.
 */
class CompanionScreenCapture(private val context: Context, private val onStopped: () -> Unit) {
    private val handler = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var completion: ((String?, String?) -> Unit)? = null
    private var closed = false
    private val timeout = Runnable {
        finish(null, "没有读到屏幕，请确认屏幕共享仍在进行，且当前页面允许截图。")
        reader?.close(); reader = null
    }
    private val callback = object : MediaProjection.Callback() {
        override fun onStop() { close(); onStopped() }
    }

    @Suppress("DEPRECATION")
    private fun metrics(): DisplayMetrics = DisplayMetrics().also {
        (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(it)
    }

    fun start(data: Intent) {
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val session = manager.getMediaProjection(Activity.RESULT_OK, data)
        projection = session
        session.registerCallback(callback, handler)
        val size = metrics()
        display = session.createVirtualDisplay("CompanionScreen", size.widthPixels, size.heightPixels,
            size.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, null, null, handler)
    }

    fun capture(done: (String?, String?) -> Unit) {
        if (closed || display == null) { done(null, "屏幕共享已结束，请返回小手机重新打开陪伴。"); return }
        if (completion != null) { done(null, "正在读取屏幕，请稍候。"); return }
        completion = done
        try {
            val size = metrics()
            display?.surface = null
            reader?.close()
            val frames = ImageReader.newInstance(size.widthPixels, size.heightPixels, PixelFormat.RGBA_8888, 2)
            reader = frames
            display?.resize(size.widthPixels, size.heightPixels, size.densityDpi)
            frames.setOnImageAvailableListener({ source ->
                val frame = runCatching { source.acquireLatestImage() }.getOrNull() ?: return@setOnImageAvailableListener
                var full: Bitmap? = null
                var cropped: Bitmap? = null
                var scaled: Bitmap? = null
                try {
                    if (completion == null) return@setOnImageAvailableListener
                    // Reused from ScreenSeek: remove ImageReader's row padding.
                    val plane = frame.planes[0]
                    val rowPadding = plane.rowStride - plane.pixelStride * frame.width
                    full = Bitmap.createBitmap(frame.width + rowPadding / plane.pixelStride, frame.height, Bitmap.Config.ARGB_8888)
                    full.copyPixelsFromBuffer(plane.buffer)
                    val screen = Bitmap.createBitmap(full, 0, 0, frame.width, frame.height)
                    cropped = screen
                    // FLAG_SECURE / protected video can yield a completely black frame.
                    val black = (1..8).all { x -> (1..8).all { y ->
                        val pixel = screen.getPixel(x * (screen.width - 1) / 9, y * (screen.height - 1) / 9)
                        Color.red(pixel) == 0 && Color.green(pixel) == 0 && Color.blue(pixel) == 0
                    } }
                    // The first frame can still be blank while the compositor starts.
                    // Keep waiting for a real frame until the capture timeout.
                    if (black) return@setOnImageAvailableListener
                    val ratio = minOf(1f, 1280f / maxOf(frame.width, frame.height))
                    val resized = Bitmap.createScaledBitmap(screen, maxOf(1, (frame.width * ratio).toInt()), maxOf(1, (frame.height * ratio).toInt()), true)
                    scaled = resized
                    val bytes = ByteArrayOutputStream().use { output ->
                        resized.compress(Bitmap.CompressFormat.JPEG, 85, output)
                        output.toByteArray()
                    }
                    finish("data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP), null)
                } catch (_: Exception) {
                    finish(null, "读取屏幕失败，请重新点击悬浮窗。")
                } finally {
                    frame.close()
                    if (scaled !== cropped) scaled?.recycle()
                    if (cropped !== full) cropped?.recycle()
                    full?.recycle()
                    if (completion == null && reader === source) { source.close(); reader = null }
                }
            }, handler)
            handler.postDelayed(timeout, 5000)
            display?.surface = frames.surface
        } catch (_: Exception) { finish(null, "屏幕共享不可用，请返回小手机重新打开陪伴。") }
    }

    private fun finish(data: String?, error: String?) {
        handler.removeCallbacks(timeout)
        runCatching { display?.surface = null }
        reader?.setOnImageAvailableListener(null, null)
        val done = completion
        completion = null
        done?.invoke(data, error)
    }

    fun close() {
        if (closed) return
        closed = true
        finish(null, "屏幕共享已结束。")
        display?.release(); display = null
        reader?.close(); reader = null
        projection?.unregisterCallback(callback)
        projection?.stop(); projection = null
    }
}
