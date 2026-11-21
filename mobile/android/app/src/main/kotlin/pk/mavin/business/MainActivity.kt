package pk.mavin.business

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Sends an invoice PDF straight into a WhatsApp chat (lib/ui/invoice_share.dart):
 * - "apps": which of WhatsApp / WhatsApp Business are installed.
 * - "sendFile": opens that app with the PDF and message attached, on the
 *   customer's chat when the number is known. The person presses Send there;
 *   nothing is sent by this app.
 * The PDF is in the app's cache (cache/share_plus/), served through
 * share_plus's FileProvider, readable only by the app it is handed to.
 */
class MainActivity : FlutterActivity() {
    private val whatsApps = listOf("com.whatsapp", "com.whatsapp.w4b")

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "pk.mavin.business/whatsapp").setMethodCallHandler { call, result ->
            when (call.method) {
                "apps" -> result.success(whatsApps.filter(::installed))
                "sendFile" -> {
                    val path = call.argument<String>("path")
                    val pkg = call.argument<String>("package")
                    val phone = call.argument<String>("phone")
                    val text = call.argument<String>("text")
                    if (path == null || pkg == null || pkg !in whatsApps) {
                        result.error("bad_args", "Missing file or app.", null)
                        return@setMethodCallHandler
                    }
                    try {
                        val uri = FileProvider.getUriForFile(this, "$packageName.flutter.share_provider", File(path))
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = "application/pdf"
                            setPackage(pkg)
                            putExtra(Intent.EXTRA_STREAM, uri)
                            if (!text.isNullOrBlank()) putExtra(Intent.EXTRA_TEXT, text)
                            // Opens the customer's chat directly (WhatsApp's own extra); without it WhatsApp asks for the chat.
                            if (!phone.isNullOrBlank() && phone.all(Char::isDigit)) putExtra("jid", "$phone@s.whatsapp.net")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        startActivity(intent)
                        result.success(true)
                    } catch (e: ActivityNotFoundException) {
                        result.error("not_installed", "WhatsApp is not installed on this phone.", null)
                    } catch (e: IllegalArgumentException) {
                        result.error("bad_file", "The PDF could not be attached.", null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun installed(pkg: String): Boolean = try {
        packageManager.getPackageInfo(pkg, 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }
}
