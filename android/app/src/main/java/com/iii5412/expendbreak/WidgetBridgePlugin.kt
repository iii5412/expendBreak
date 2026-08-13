package com.iii5412.expendbreak

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.iii5412.expendbreak.widget.ExpendBreakWidgetReceiver
import com.iii5412.expendbreak.widget.WidgetStore
import com.iii5412.expendbreak.widget.WidgetUpdater

@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {
    @PluginMethod
    fun publishSnapshot(call: PluginCall) {
        val snapshot = call.getObject("snapshot")
        if (snapshot == null || !WidgetStore.isValidSnapshot(snapshot)) {
            call.reject("Invalid widget snapshot")
            return
        }

        try {
            WidgetStore.write(context, snapshot, locked = false)
            WidgetUpdater.updateAll(context)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Unable to store widget snapshot", error)
        }
    }

    @PluginMethod
    fun setLocked(call: PluginCall) {
        try {
            WidgetStore.setLocked(context, call.getBoolean("locked", true) == true)
            WidgetUpdater.updateAll(context)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Unable to update widget lock state", error)
        }
    }

    @PluginMethod
    fun refresh(call: PluginCall) {
        WidgetUpdater.updateAll(context)
        call.resolve()
    }

    @PluginMethod
    fun requestPin(call: PluginCall) {
        val manager = AppWidgetManager.getInstance(context)
        val supported = manager.isRequestPinAppWidgetSupported
        val requested = supported && manager.requestPinAppWidget(
            ComponentName(context, ExpendBreakWidgetReceiver::class.java),
            null,
            null,
        )
        call.resolve(JSObject().put("supported", supported).put("requested", requested))
    }
}
