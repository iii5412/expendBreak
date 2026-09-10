package com.iii5412.expendbreak

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import java.util.concurrent.Executors

@CapacitorPlugin(
    name = "SmsBridge",
    permissions = [
        Permission(alias = "receiveSms", strings = [Manifest.permission.RECEIVE_SMS]),
        Permission(alias = "readSms", strings = [Manifest.permission.READ_SMS]),
    ],
)
class SmsBridgePlugin : Plugin() {
    private var receiverRegistered = false
    private val scanExecutor = Executors.newSingleThreadExecutor()
    private val pendingReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == SmsQueueStore.ACTION_PENDING_SMS) notifyListeners("smsPending", JSObject())
        }
    }

    override fun load() {
        super.load()
        ContextCompat.registerReceiver(
            context,
            pendingReceiver,
            IntentFilter(SmsQueueStore.ACTION_PENDING_SMS),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        receiverRegistered = true
    }

    override fun handleOnDestroy() {
        if (receiverRegistered) {
            runCatching { context.unregisterReceiver(pendingReceiver) }
            receiverRegistered = false
        }
        scanExecutor.shutdownNow()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun setActiveProfile(call: PluginCall) {
        val profileKey = call.getString("profileKey").orEmpty()
        val enabled = call.getBoolean("enabled", false) == true
        val startAtInstall = call.getBoolean("startAtInstall", false) == true
        if (profileKey.length > 160) {
            call.reject("Invalid SMS profile key", "INVALID_PROFILE")
            return
        }
        SmsQueueStore.configure(context, profileKey, enabled, startAtInstall)
        call.resolve(statusPayload(profileKey))
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(statusPayload(call.getString("profileKey").orEmpty()))
    }

    @PluginMethod
    fun scanInbox(call: PluginCall) {
        val profileKey = call.getString("profileKey").orEmpty()
        val force = call.getBoolean("force", false) == true
        if (profileKey.isBlank() || profileKey.length > 160) {
            call.reject("Invalid SMS profile key", "INVALID_PROFILE")
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            call.reject("SMS inbox permission is required", "READ_SMS_REQUIRED")
            return
        }

        scanExecutor.execute {
            val state = SmsQueueStore.scanState(context, profileKey)
            if (!state.enabled) {
                call.reject("SMS import is disabled", "SMS_IMPORT_DISABLED")
                return@execute
            }
            val now = System.currentTimeMillis()
            if (!force && state.lastSuccessAt > 0 && now - state.lastSuccessAt < 30_000L) {
                call.resolve(statusPayload(profileKey).put("skipped", true))
                return@execute
            }

            SmsQueueStore.markScanStarted(context, profileKey, now)
            val overlapStart = if (state.lastSuccessAt > 0) state.lastSuccessAt - 24L * 60L * 60L * 1000L else 0L
            val startAt = if (force) {
                maxOf(state.baselineAt, state.enabledAt)
            } else {
                maxOf(state.baselineAt, state.enabledAt, overlapStart)
            }
            var scannedCount = 0
            var candidateCount = 0

            try {
                val projection = arrayOf(
                    Telephony.Sms._ID,
                    Telephony.Sms.ADDRESS,
                    Telephony.Sms.BODY,
                    Telephony.Sms.DATE,
                )
                val selection = "${Telephony.Sms.DATE} >= ? AND ${Telephony.Sms.DATE} <= ?"
                val args = arrayOf(startAt.toString(), now.toString())
                context.contentResolver.query(
                    Telephony.Sms.Inbox.CONTENT_URI,
                    projection,
                    selection,
                    args,
                    "${Telephony.Sms.DATE} ASC, ${Telephony.Sms._ID} ASC",
                )?.use { cursor ->
                    val senderIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
                    val bodyIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
                    val dateIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
                    while (cursor.moveToNext()) {
                        scannedCount += 1
                        val sender = cursor.getString(senderIndex).orEmpty()
                        val body = cursor.getString(bodyIndex).orEmpty()
                        val receivedAt = cursor.getLong(dateIndex)
                        if (SmsQueueStore.enqueueIfFinancialCandidate(context, profileKey, sender, body, receivedAt)) {
                            candidateCount += 1
                        }
                    }
                }
                SmsQueueStore.markScanSucceeded(context, profileKey, now, scannedCount, candidateCount)
                if (candidateCount > 0) {
                    context.sendBroadcast(Intent(SmsQueueStore.ACTION_PENDING_SMS).setPackage(context.packageName))
                }
                call.resolve(statusPayload(profileKey).put("skipped", false))
            } catch (error: SecurityException) {
                SmsQueueStore.markScanFailed(context, profileKey, "READ_SMS_REQUIRED")
                call.reject("SMS inbox permission was revoked", "READ_SMS_REQUIRED", error)
            } catch (error: Exception) {
                SmsQueueStore.markScanFailed(context, profileKey, "INBOX_QUERY_FAILED")
                call.reject("Unable to scan SMS inbox", "INBOX_QUERY_FAILED", error)
            }
        }
    }

    @PluginMethod
    fun readPending(call: PluginCall) {
        val profileKey = call.getString("profileKey").orEmpty()
        val messages = JSArray()
        SmsQueueStore.readPending(context, profileKey).forEach { item ->
            messages.put(
                JSObject()
                    .put("id", item.optString("id"))
                    .put("sender", item.optString("sender"))
                    .put("body", item.optString("body"))
                    .put("receivedAt", item.optLong("receivedAt")),
            )
        }
        call.resolve(JSObject().put("messages", messages))
    }

    @PluginMethod
    fun acknowledge(call: PluginCall) {
        val idsArray = call.getArray("ids") ?: JSArray()
        val ids = buildSet {
            for (index in 0 until idsArray.length()) idsArray.optString(index).takeIf(String::isNotBlank)?.let(::add)
        }
        SmsQueueStore.acknowledge(context, call.getString("profileKey").orEmpty(), ids)
        call.resolve()
    }

    @PluginMethod
    fun clearPending(call: PluginCall) {
        SmsQueueStore.clear(context, call.getString("profileKey").orEmpty())
        call.resolve()
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    private fun statusPayload(profileKey: String): JSObject {
        val state = SmsQueueStore.scanState(context, profileKey)
        return JSObject()
            .put("enabled", state.enabled)
            .put("baselineAt", state.baselineAt)
            .put("enabledAt", state.enabledAt)
            .put("lastAttemptAt", state.lastAttemptAt)
            .put("lastSuccessAt", state.lastSuccessAt)
            .put("lastScannedCount", state.lastScannedCount)
            .put("lastCandidateCount", state.lastCandidateCount)
            .put("lastError", state.lastError)
            .put("pendingCount", SmsQueueStore.readPending(context, profileKey).size)
    }
}
