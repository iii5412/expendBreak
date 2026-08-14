package com.iii5412.expendbreak

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

@CapacitorPlugin(name = "AppUpdater")
class AppUpdaterPlugin : Plugin() {
    companion object {
        private const val MAX_APK_BYTES = 250L * 1024L * 1024L
        private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    }

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val urlText = call.getString("url")?.trim().orEmpty()
        val expectedSha256 = call.getString("sha256")?.trim()?.lowercase().orEmpty()
        val parsedUrl = runCatching { URL(urlText) }.getOrNull()
        if (parsedUrl == null || parsedUrl.protocol != "https" || !expectedSha256.matches(Regex("^[a-f0-9]{64}$"))) {
            call.reject("Invalid secure update request")
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            val settingsIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}"),
            )
            activity.startActivity(settingsIntent)
            call.resolve(JSObject().put("started", false).put("permissionRequired", true))
            return
        }

        Thread {
            try {
                val updateDir = File(context.cacheDir, "app-updates").apply { mkdirs() }
                val pendingFile = File(updateDir, "pending.apk")
                downloadVerifiedApk(parsedUrl, pendingFile, expectedSha256)
                activity.runOnUiThread {
                    try {
                        openInstaller(pendingFile)
                        call.resolve(JSObject().put("started", true))
                    } catch (error: Exception) {
                        pendingFile.delete()
                        call.reject("Unable to open Android package installer", error)
                    }
                }
            } catch (error: Exception) {
                call.reject(error.message ?: "Unable to download app update", error)
            }
        }.start()
    }

    private fun downloadVerifiedApk(url: URL, target: File, expectedSha256: String) {
        var connection: HttpURLConnection? = null
        val temporary = File(target.parentFile, "${target.name}.download")
        temporary.delete()
        try {
            connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 45_000
                instanceFollowRedirects = true
                requestMethod = "GET"
                setRequestProperty("Accept", APK_MIME_TYPE)
                connect()
            }
            val responseCode = connection.responseCode
            if (connection.url.protocol != "https" || responseCode !in 200..299) {
                throw IllegalStateException("Update server returned $responseCode")
            }
            val totalBytes = connection.contentLengthLong
            if (totalBytes <= 0 || totalBytes > MAX_APK_BYTES) {
                throw IllegalStateException("Invalid update file size")
            }

            val digest = MessageDigest.getInstance("SHA-256")
            var downloaded = 0L
            var lastPercent = -1
            connection.inputStream.use { input ->
                FileOutputStream(temporary).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        downloaded += count
                        if (downloaded > MAX_APK_BYTES || downloaded > totalBytes) {
                            throw IllegalStateException("Update file exceeded its declared size")
                        }
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        val percent = ((downloaded * 100) / totalBytes).toInt()
                        if (percent != lastPercent) {
                            lastPercent = percent
                            notifyListeners(
                                "downloadProgress",
                                JSObject()
                                    .put("percent", percent)
                                    .put("downloadedBytes", downloaded)
                                    .put("totalBytes", totalBytes),
                            )
                        }
                    }
                    output.fd.sync()
                }
            }
            if (downloaded != totalBytes) throw IllegalStateException("Update download was incomplete")
            val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
            if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
                throw SecurityException("Update file checksum mismatch")
            }
            target.delete()
            if (!temporary.renameTo(target)) throw IllegalStateException("Unable to prepare update file")
        } finally {
            connection?.disconnect()
            temporary.delete()
        }
    }

    private fun openInstaller(apkFile: File) {
        val apkUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile,
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, APK_MIME_TYPE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(intent)
    }
}
