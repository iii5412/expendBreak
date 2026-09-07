package com.iii5412.expendbreak

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

@CapacitorPlugin(
    name = "SmsBridge",
    permissions = [
        Permission(alias = "receiveSms", strings = [Manifest.permission.RECEIVE_SMS]),
    ],
)
class SmsBridgePlugin : Plugin() {
    private var receiverRegistered = false
    private val pendingReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == SmsQueueStore.ACTION_PENDING_SMS) {
                notifyListeners("smsPending", JSObject())
            }
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
        super.handleOnDestroy()
    }

    @PluginMethod
    fun setActiveProfile(call: PluginCall) {
        val profileKey = call.getString("profileKey").orEmpty()
        val enabled = call.getBoolean("enabled", false) == true
        if (profileKey.length > 160) {
            call.reject("Invalid SMS profile key")
            return
        }
        SmsQueueStore.configure(context, profileKey, enabled)
        call.resolve()
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
            for (index in 0 until idsArray.length()) {
                idsArray.optString(index).takeIf(String::isNotBlank)?.let(::add)
            }
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
}
