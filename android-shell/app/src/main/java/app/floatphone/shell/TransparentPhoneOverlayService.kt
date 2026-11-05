package app.floatphone.shell

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast

/** A decorative frame only; touches in its centre go to the app underneath. */
class TransparentPhoneOverlayService : Service() {
    // Adapted from Floating Ghost Image, FloatingImageService.kt, MIT (rvoidex7).
    // Original: https://github.com/rvoidex7/floating-ghost-image/tree/a0510368f7aaae4ec9d6ba4fe4fee1675f0c1ef1
    private val overlayType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    private val fullScreenFlags =
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
    private lateinit var windowManager: WindowManager
    private var imageRoot: FrameLayout? = null
    private var closeView: TextView? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val notifications = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        notifications.createNotificationChannel(NotificationChannel(CHANNEL_ID, "透明小手机外框", NotificationManager.IMPORTANCE_LOW))
        val closeIntent = Intent(this, TransparentPhoneOverlayService::class.java).setAction(ACTION_CLOSE)
        val closePending = PendingIntent.getService(this, 0, closeIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("小手机外框正在显示")
            .setContentText("透明区域可操作下方应用")
            .setOngoing(true)
            .addAction(0, "关闭外框", closePending)
            .build()
        startForeground(NOTIFICATION_ID, notification)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CLOSE) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (imageRoot != null) return START_NOT_STICKY
        try {
            showOverlay()
        } catch (error: Exception) {
            Toast.makeText(this, "无法显示外框，请检查悬浮窗权限", Toast.LENGTH_LONG).show()
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun showOverlay() {
        // Reused and adapted from Floating Ghost Image's setupImageWindow and setupFab.
        val root = FrameLayout(this)
        val imageView = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            alpha = 1.0f
            setImageResource(R.drawable.transparent_phone_frame)
        }
        root.addView(imageView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        ))
        val initialFlags = fullScreenFlags or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        val imageParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            overlayType,
            initialFlags,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 0
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
            // Android 12+ permits touch-through for one overlay at or below 0.8.
            alpha = 0.8f
        }
        windowManager.addView(root, imageParams)
        imageRoot = root

        val close = TextView(this).apply {
            text = "×"
            textSize = 24f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(31, 49, 68))
            contentDescription = "关闭透明小手机外框"
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.rgb(235, 246, 255))
                setStroke(dp(1), Color.rgb(133, 184, 218))
            }
            setOnClickListener { stopSelf() }
        }
        val closeParams = WindowManager.LayoutParams(
            dp(44), dp(44), overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dp(12)
            y = dp(58)
        }
        windowManager.addView(close, closeParams)
        closeView = close
    }

    override fun onDestroy() {
        closeView?.let { runCatching { windowManager.removeView(it) } }
        imageRoot?.let { runCatching { windowManager.removeView(it) } }
        closeView = null
        imageRoot = null
        super.onDestroy()
    }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics,
    ).toInt()

    companion object {
        private const val CHANNEL_ID = "transparent_phone_overlay"
        private const val NOTIFICATION_ID = 8204
        private const val ACTION_CLOSE = "app.floatphone.shell.CLOSE_TRANSPARENT_PHONE"
    }
}
