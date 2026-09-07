package com.iii5412.expendbreak

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

object SmsQueueStore {
    const val ACTION_PENDING_SMS = "com.iii5412.expendbreak.SMS_PENDING"

    private const val PREFS_NAME = "sms_import_private"
    private const val KEY_ACTIVE_PROFILE = "active_profile"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_QUEUE = "pending_messages"
    private const val KEY_SEEN_IDS = "seen_message_ids"
    private const val MAX_QUEUE_SIZE = 100
    private const val MAX_AGE_MS = 7L * 24L * 60L * 60L * 1000L
    private val lock = Any()

    fun configure(context: Context, profileKey: String, enabled: Boolean) {
        val normalizedProfile = profileKey.trim().take(160)
        synchronized(lock) {
            context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_ACTIVE_PROFILE, normalizedProfile)
                .putBoolean(KEY_ENABLED, enabled && normalizedProfile.isNotEmpty())
                .apply()
        }
    }

    fun enqueueIfFinancialCandidate(
        context: Context,
        sender: String,
        body: String,
        receivedAt: Long,
    ): Boolean {
        val appContext = context.applicationContext
        val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val profileKey = prefs.getString(KEY_ACTIVE_PROFILE, "").orEmpty()
        if (!prefs.getBoolean(KEY_ENABLED, false) || profileKey.isBlank()) return false

        val normalizedBody = body.replace("\u0000", "").trim().take(4_000)
        if (!isFinancialCandidate(normalizedBody)) return false
        val normalizedSender = sender.trim().take(80)
        val id = sha256("$normalizedSender|$normalizedBody|${receivedAt / 60_000L}")
        val item = JSONObject()
            .put("id", id)
            .put("profileKey", profileKey)
            .put("sender", normalizedSender)
            .put("body", normalizedBody)
            .put("receivedAt", receivedAt)

        synchronized(lock) {
            val queue = readQueue(prefs.getString(KEY_QUEUE, null))
            val seenIds = readStringList(prefs.getString(KEY_SEEN_IDS, null))
            if (id in seenIds) return false
            val now = System.currentTimeMillis()
            val retained = queue.filter { candidate ->
                candidate.optLong("receivedAt", 0L) >= now - MAX_AGE_MS && candidate.optString("id") != id
            }.takeLast(MAX_QUEUE_SIZE - 1)
            val updated = JSONArray()
            retained.forEach(updated::put)
            updated.put(item)
            val nextSeenIds = (seenIds + id).takeLast(500)
            prefs.edit()
                .putString(KEY_QUEUE, updated.toString())
                .putString(KEY_SEEN_IDS, JSONArray(nextSeenIds).toString())
                .apply()
        }
        return true
    }

    fun readPending(context: Context, profileKey: String): List<JSONObject> {
        if (profileKey.isBlank()) return emptyList()
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        synchronized(lock) {
            val now = System.currentTimeMillis()
            val pending = mutableListOf<JSONObject>()
            val retained = JSONArray()
            readQueue(prefs.getString(KEY_QUEUE, null)).forEach { item ->
                val fresh = item.optLong("receivedAt", 0L) >= now - MAX_AGE_MS
                if (fresh) {
                    retained.put(item)
                    if (item.optString("profileKey") == profileKey) pending.add(item)
                }
            }
            prefs.edit().putString(KEY_QUEUE, retained.toString()).apply()
            return pending
        }
    }

    fun acknowledge(context: Context, profileKey: String, ids: Set<String>) {
        if (profileKey.isBlank() || ids.isEmpty()) return
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        synchronized(lock) {
            val retained = JSONArray()
            readQueue(prefs.getString(KEY_QUEUE, null))
                .filterNot { it.optString("profileKey") == profileKey && it.optString("id") in ids }
                .forEach(retained::put)
            prefs.edit().putString(KEY_QUEUE, retained.toString()).apply()
        }
    }

    fun clear(context: Context, profileKey: String) {
        if (profileKey.isBlank()) return
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        synchronized(lock) {
            val retained = JSONArray()
            readQueue(prefs.getString(KEY_QUEUE, null))
                .filter { it.optString("profileKey") != profileKey }
                .forEach(retained::put)
            prefs.edit().putString(KEY_QUEUE, retained.toString()).apply()
        }
    }

    private fun isFinancialCandidate(body: String): Boolean {
        if (!Regex("(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\s*원").containsMatchIn(body)) return false
        if (!Regex("승인|결제\\s*완료|카드\\s*사용|체크\\s*사용|승인\\s*취소|결제\\s*취소|매입\\s*취소|취소\\s*완료|환불\\s*완료").containsMatchIn(body)) return false
        return !Regex("결제예정|결제일|청구(?:금액|예정)?|명세서|이용대금|납부|한도(?:초과|안내)?|광고|이벤트|포인트|혜택|발급|배송").containsMatchIn(body)
    }

    private fun readQueue(raw: String?): List<JSONObject> = try {
        val array = JSONArray(raw ?: "[]")
        buildList {
            for (index in 0 until array.length()) {
                array.optJSONObject(index)?.let(::add)
            }
        }
    } catch (_: Exception) {
        emptyList()
    }

    private fun readStringList(raw: String?): List<String> = try {
        val array = JSONArray(raw ?: "[]")
        buildList {
            for (index in 0 until array.length()) {
                array.optString(index).takeIf(String::isNotBlank)?.let(::add)
            }
        }
    } catch (_: Exception) {
        emptyList()
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
