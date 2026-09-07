package com.iii5412.expendbreak

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isEmpty()) return

        val sender = messages.firstNotNullOfOrNull { it.originatingAddress }.orEmpty()
        val body = messages.joinToString(separator = "") { it.messageBody.orEmpty() }
        val receivedAt = messages.minOfOrNull { it.timestampMillis } ?: System.currentTimeMillis()
        if (SmsQueueStore.enqueueIfFinancialCandidate(context, sender, body, receivedAt)) {
            context.sendBroadcast(
                Intent(SmsQueueStore.ACTION_PENDING_SMS).setPackage(context.packageName),
            )
        }
    }
}
