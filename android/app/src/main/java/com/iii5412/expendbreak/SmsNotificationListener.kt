package com.iii5412.expendbreak

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat

/**
 * Reads card approvals from messaging-app notifications. RCS business messages
 * ("알림" bubbles from verified senders) are kept in the messaging app's own
 * store: they never fire SMS_RECEIVED and are absent from the SMS/MMS
 * providers, so their notification is the only place the app can see them.
 *
 * Only notifications from messaging apps are looked at, and only bodies that
 * pass the same card-approval filter as SMS are queued; nothing else is kept.
 */
class SmsNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in MESSAGING_PACKAGES) return
        val notification = sbn.notification ?: return
        if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val profileKey = SmsQueueStore.activeProfile(this)
        if (profileKey.isBlank()) return
        val enabledAt = SmsQueueStore.scanState(this, profileKey).enabledAt

        var queued = false
        readMessages(notification, sbn.postTime).forEach { message ->
            if (message.receivedAt < enabledAt) return@forEach
            if (SmsQueueStore.enqueueIfFinancialCandidate(
                    this,
                    profileKey,
                    message.sender,
                    message.body,
                    message.receivedAt,
                    SmsQueueStore.CHANNEL_NOTIFICATION,
                )
            ) {
                queued = true
            }
        }
        if (queued) {
            sendBroadcast(Intent(SmsQueueStore.ACTION_PENDING_SMS).setPackage(packageName))
        }
    }

    private data class Message(val sender: String, val body: String, val receivedAt: Long)

    private fun readMessages(notification: Notification, postedAt: Long): List<Message> = runCatching {
        val extras = notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
        val styled = style?.messages.orEmpty().mapNotNull { message ->
            val text = message.text?.toString().orEmpty()
            if (text.isBlank()) return@mapNotNull null
            val sender = message.person?.name?.toString() ?: style?.conversationTitle?.toString() ?: title
            Message(sender, text, message.timestamp.takeIf { it > 0 } ?: postedAt)
        }
        if (styled.isNotEmpty()) return@runCatching styled

        // A stable time keeps a re-posted notification from being queued twice.
        val body = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
        if (body.isBlank()) emptyList()
        else listOf(Message(title, body, notification.`when`.takeIf { it > 0 } ?: postedAt))
    }.getOrDefault(emptyList())

    companion object {
        private val MESSAGING_PACKAGES = setOf(
            "com.samsung.android.messaging",
            "com.google.android.apps.messaging",
            "com.android.mms",
            "com.android.messaging",
        )
    }
}
