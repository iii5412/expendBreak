package com.iii5412.expendbreak

import android.content.Context
import android.net.Uri
import android.provider.Telephony
import java.nio.charset.Charset

/**
 * Reads text from the MMS inbox. Korean card approvals ("[Web발신]") are often
 * long enough to arrive as LMS, which Android stores with MMS, not SMS, and
 * which never fires SMS_RECEIVED. Without this they are invisible to the app.
 */
object MmsReader {
    data class Message(val sender: String, val body: String, val receivedAt: Long)

    // IANA MIBenum values the MMS provider stores in "chset".
    private const val MIB_UTF8 = 106
    private const val MIB_EUC_KR = 38
    private const val MAX_MESSAGES = 2_000

    /** MMS dates are stored in seconds, unlike SMS. */
    fun readInbox(context: Context, fromMillis: Long, toMillis: Long): List<Message> {
        val result = mutableListOf<Message>()
        context.contentResolver.query(
            Telephony.Mms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Mms._ID, Telephony.Mms.DATE),
            "${Telephony.Mms.DATE} >= ? AND ${Telephony.Mms.DATE} <= ?",
            arrayOf((fromMillis / 1000L).toString(), (toMillis / 1000L + 1L).toString()),
            "${Telephony.Mms.DATE} ASC",
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(Telephony.Mms._ID)
            val dateIndex = cursor.getColumnIndexOrThrow(Telephony.Mms.DATE)
            while (cursor.moveToNext() && result.size < MAX_MESSAGES) {
                val id = cursor.getLong(idIndex)
                val body = readText(context, id)
                if (body.isBlank()) continue
                result.add(Message(readSender(context, id), body, cursor.getLong(dateIndex) * 1000L))
            }
        }
        return result
    }

    private fun readText(context: Context, mmsId: Long): String {
        val text = StringBuilder()
        context.contentResolver.query(
            Uri.parse("content://mms/part"),
            arrayOf("_id", "ct", "_data", "text", "chset"),
            "mid = ?",
            arrayOf(mmsId.toString()),
            null,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                if (cursor.getString(cursor.getColumnIndexOrThrow("ct")) != "text/plain") continue
                val partId = cursor.getLong(cursor.getColumnIndexOrThrow("_id"))
                val dataPath = cursor.getString(cursor.getColumnIndexOrThrow("_data"))
                val chset = cursor.getInt(cursor.getColumnIndexOrThrow("chset"))
                val part = if (dataPath != null) {
                    readPartStream(context, partId, chset)
                } else {
                    cursor.getString(cursor.getColumnIndexOrThrow("text")).orEmpty()
                }
                if (part.isNotBlank()) {
                    if (text.isNotEmpty()) text.append('\n')
                    text.append(part)
                }
            }
        }
        return text.toString().take(4_000)
    }

    private fun readPartStream(context: Context, partId: Long, chset: Int): String = runCatching {
        val charset = when (chset) {
            MIB_EUC_KR -> Charset.forName("EUC-KR")
            MIB_UTF8, 0 -> Charsets.UTF_8
            else -> Charsets.UTF_8
        }
        context.contentResolver.openInputStream(Uri.parse("content://mms/part/$partId"))?.use { stream ->
            String(stream.readBytes().take(16_000).toByteArray(), charset)
        }.orEmpty()
    }.getOrDefault("")

    private fun readSender(context: Context, mmsId: Long): String = runCatching {
        context.contentResolver.query(
            Uri.parse("content://mms/$mmsId/addr"),
            arrayOf("address", "type"),
            // 137 = PduHeaders.FROM
            "type = 137",
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(cursor.getColumnIndexOrThrow("address")).orEmpty() else ""
        }.orEmpty()
    }.getOrDefault("")
}
