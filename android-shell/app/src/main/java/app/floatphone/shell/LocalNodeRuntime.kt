package app.floatphone.shell

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.zip.ZipInputStream
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.concurrent.thread

/** Runs a single Node.js Mobile instance for the lifetime of this Android process. */
object LocalNodeRuntime {
    private const val TAG = "XunxinLocal"
    private const val PORT = 18471
    private var started = false
    private val main = Handler(Looper.getMainLooper())
    private external fun startNodeWithArguments(args: Array<String>): Int

    @Synchronized
    fun start(context: Context, onReady: (String?, String?) -> Unit) {
        val app = context.applicationContext
        thread(name = "xunxin-startup") {
            try {
                val secretFile = File(app.filesDir, "local-server-secret")
                val secret = synchronized(this) {
                    if (secretFile.exists()) secretFile.readText().trim()
                    else {
                        val value = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
                        secretFile.writeText(value)
                        value
                    }
                }
                synchronized(this) {
                    if (!started) {
                        val runtime = unpackBundle(app)
                        System.loadLibrary("node")
                        System.loadLibrary("xunxin_node")
                        started = true
                        thread(name = "xunxin-node") {
                            val exit = startNodeWithArguments(arrayOf("node", File(runtime, "android-bootstrap.cjs").absolutePath, secretFile.absolutePath, app.cacheDir.absolutePath))
                            Log.e(TAG, "Local runtime stopped ($exit)")
                        }
                    }
                }
                var ready = false
                repeat(180) {
                    if (!ready) {
                        if (verifyServer(secret)) ready = true else Thread.sleep(1000)
                    }
                }
                main.post {
                    if (ready) onReady("http://localhost:$PORT/?xunxin_start=$secret", null)
                    else onReady(null, "本地服务启动失败，请重启应用后重试。")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Unable to start local runtime", e)
                main.post { onReady(null, "本地服务启动失败，请重启应用后重试。") }
            } catch (e: UnsatisfiedLinkError) {
                Log.e(TAG, "Unable to load Node.js Mobile", e)
                main.post { onReady(null, "此设备无法加载本地运行环境。") }
            }
        }
    }

    private fun verifyServer(secret: String): Boolean {
        return try {
            val nonce = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
            val expected = mac.doFinal(nonce.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
            val connection = URL("http://localhost:$PORT/__xunxin_health?nonce=$nonce").openConnection() as HttpURLConnection
            connection.connectTimeout = 800
            connection.readTimeout = 800
            try { connection.responseCode == 200 && connection.inputStream.bufferedReader().use { it.readText() } == expected }
            finally { connection.disconnect() }
        } catch (_: Exception) { false }
    }

    private fun unpackBundle(context: Context): File {
        val version = context.assets.open("xunxin-bundle-version.txt").bufferedReader().use { it.readText().trim() }
        require(version.matches(Regex("[a-f0-9]{16,64}")))
        val destination = File(context.filesDir, "xunxin-runtime-$version")
        val marker = File(destination, ".complete")
        if (marker.exists()) return destination
        destination.mkdirs()
        val root = destination.canonicalPath + File.separator
        context.assets.open("xunxin-server.zip").use { input ->
            ZipInputStream(input.buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val file = File(destination, entry.name)
                    require(file.canonicalPath.startsWith(root)) { "Invalid asset path" }
                    if (entry.isDirectory) file.mkdirs()
                    else {
                        file.parentFile?.mkdirs()
                        file.outputStream().buffered().use { zip.copyTo(it) }
                    }
                    zip.closeEntry()
                }
            }
        }
        marker.writeText("ok")
        return destination
    }
}
