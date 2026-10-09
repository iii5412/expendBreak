package com.iii5412.expendbreak

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import kotlin.math.abs

object SmsQueueStore {
    const val ACTION_PENDING_SMS = "com.iii5412.expendbreak.SMS_PENDING"
    const val CHANNEL_SMS_BROADCAST = "sms_broadcast"
    const val CHANNEL_INBOX = "inbox"
    const val CHANNEL_NOTIFICATION = "notification"

    private const val KEY_RECENT_CONTENT = "recent_message_content"
    private const val CROSS_CHANNEL_WINDOW_MS = 10L * 60L * 1000L
    // Inbox rescans reach back to when the feature was enabled.
    private const val RECENT_CONTENT_TTL_MS = 45L * 24L * 60L * 60L * 1000L
    private const val MAX_RECENT_CONTENT = 1_000

    private const val PREFS_NAME = "sms_import_private"
    private const val KEY_ACTIVE_PROFILE = "active_profile"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_QUEUE = "pending_messages"
    private const val KEY_SEEN_IDS = "seen_message_ids"
    private const val KEY_HANDLED_IDS = "handled_message_ids"
    private const val MAX_SEEN_IDS = 5_000
    private const val MAX_HANDLED_IDS = 20_000
    /** Bump when the candidate filter changes so the inbox is read again once. */
    private const val FILTER_VERSION = 2
    private val lock = Any()

    data class ScanState(
        val enabled: Boolean,
        val baselineAt: Long,
        val enabledAt: Long,
        val lastAttemptAt: Long,
        val lastSuccessAt: Long,
        val lastScannedCount: Int,
        val lastCandidateCount: Int,
        val lastError: String?,
    )

    fun configure(context: Context, profileKey: String, enabled: Boolean, startAtInstall: Boolean = false) {
        val normalizedProfile = profileKey.trim().take(160)
        val prefs = preferences(context)
        synchronized(lock) {
            val wasEnabled = prefs.getBoolean(KEY_ENABLED, false)
            val previousProfile = prefs.getString(KEY_ACTIVE_PROFILE, "").orEmpty()
            val editor = prefs.edit()
                .putString(KEY_ACTIVE_PROFILE, normalizedProfile)
                .putBoolean(KEY_ENABLED, enabled && normalizedProfile.isNotEmpty())

            if (normalizedProfile.isNotEmpty()) {
                val suffix = profileSuffix(normalizedProfile)
                if (!prefs.contains("baseline_at_$suffix")) {
                    editor.putLong("baseline_at_$suffix", packageUpdateTime(context))
                }
                if (enabled && (
                    !wasEnabled
                        || previousProfile != normalizedProfile
                        || (startAtInstall && !prefs.contains("enabled_at_$suffix"))
                )) {
                    val startAt = if (startAtInstall) {
                        prefs.getLong("baseline_at_$suffix", packageUpdateTime(context))
                    } else {
                        System.currentTimeMillis()
                    }
                    editor.putLong("enabled_at_$suffix", startAt)
                }
                if (!enabled && wasEnabled) editor.putLong("disabled_at_$suffix", System.currentTimeMillis())
            }
            editor.apply()
        }
    }

    fun activeProfile(context: Context): String {
        val prefs = preferences(context)
        if (!prefs.getBoolean(KEY_ENABLED, false)) return ""
        return prefs.getString(KEY_ACTIVE_PROFILE, "").orEmpty()
    }

    fun scanState(context: Context, profileKey: String): ScanState {
        val prefs = preferences(context)
        val suffix = profileSuffix(profileKey)
        return ScanState(
            enabled = prefs.getBoolean(KEY_ENABLED, false)
                && prefs.getString(KEY_ACTIVE_PROFILE, "") == profileKey,
            baselineAt = prefs.getLong("baseline_at_$suffix", packageUpdateTime(context)),
            enabledAt = prefs.getLong("enabled_at_$suffix", 0L),
            lastAttemptAt = prefs.getLong("last_attempt_at_$suffix", 0L),
            lastSuccessAt = prefs.getLong("last_success_at_$suffix", 0L),
            lastScannedCount = prefs.getInt("last_scanned_count_$suffix", 0),
            lastCandidateCount = prefs.getInt("last_candidate_count_$suffix", 0),
            lastError = prefs.getString("last_error_$suffix", null),
        )
    }

    fun markScanStarted(context: Context, profileKey: String, attemptedAt: Long) {
        val suffix = profileSuffix(profileKey)
        preferences(context).edit()
            .putLong("last_attempt_at_$suffix", attemptedAt)
            .remove("last_error_$suffix")
            .apply()
    }

    fun markScanSucceeded(
        context: Context,
        profileKey: String,
        completedThrough: Long,
        scannedCount: Int,
        candidateCount: Int,
    ) {
        val suffix = profileSuffix(profileKey)
        preferences(context).edit()
            .putLong("last_success_at_$suffix", completedThrough)
            .putInt("last_scanned_count_$suffix", scannedCount)
            .putInt("last_candidate_count_$suffix", candidateCount)
            .remove("last_error_$suffix")
            .apply()
    }

    fun needsFilterRescan(context: Context, profileKey: String): Boolean =
        preferences(context).getInt("filter_version_${profileSuffix(profileKey)}", 1) < FILTER_VERSION

    fun markFilterRescanned(context: Context, profileKey: String) {
        preferences(context).edit().putInt("filter_version_${profileSuffix(profileKey)}", FILTER_VERSION).apply()
    }

    fun markScanFailed(context: Context, profileKey: String, errorCode: String) {
        preferences(context).edit()
            .putString("last_error_${profileSuffix(profileKey)}", errorCode.take(100))
            .apply()
    }

    fun enqueueIfFinancialCandidate(
        context: Context,
        sender: String,
        body: String,
        receivedAt: Long,
        channel: String,
    ): Boolean {
        val profileKey = activeProfile(context)
        if (profileKey.isBlank()) return false
        return enqueueIfFinancialCandidate(context, profileKey, sender, body, receivedAt, channel)
    }

    /**
     * [channel] names where the message was seen. The same message usually
     * reaches the app more than once (SMS broadcast, inbox scan, notification)
     * with a slightly different time and sender, so a copy from another channel
     * with the same text within a few minutes is treated as the same message.
     */
    fun enqueueIfFinancialCandidate(
        context: Context,
        profileKey: String,
        sender: String,
        body: String,
        receivedAt: Long,
        channel: String,
    ): Boolean {
        if (profileKey.isBlank()) return false
        val normalizedBody = body.replace("\u0000", "").trim().take(4_000)
        if (!isFinancialCandidate(normalizedBody)) return false
        val normalizedSender = sender.trim().take(80)
        val id = messageId(normalizedSender, normalizedBody, receivedAt)
        val item = JSONObject()
            .put("id", id)
            .put("profileKey", profileKey)
            .put("sender", normalizedSender)
            .put("body", normalizedBody)
            .put("receivedAt", receivedAt)

        val prefs = preferences(context)
        synchronized(lock) {
            val queue = readQueue(prefs.getString(KEY_QUEUE, null))
            val seenIds = readStringList(prefs.getString(KEY_SEEN_IDS, null))
            val handledIds = readStringList(prefs.getString(KEY_HANDLED_IDS, null))
            if (id in seenIds || id in handledIds || queue.any { it.optString("id") == id }) return false
            val nextSeenIds = (seenIds + id).takeLast(MAX_SEEN_IDS)

            val key = contentKey(normalizedBody)
            val recent = readQueue(prefs.getString(KEY_RECENT_CONTENT, null))
            // Each record can absorb one copy per other channel, so two real
            // purchases with identical text still pair up one-to-one.
            val twin = recent.firstOrNull {
                it.optString("k") == key
                    && it.optString("c") != channel
                    && channel !in it.optString("m").split(',')
                    && abs(it.optLong("t") - receivedAt) <= CROSS_CHANNEL_WINDOW_MS
            }
            if (twin != null) {
                twin.put("m", (twin.optString("m").split(',').filter(String::isNotBlank) + channel).joinToString(","))
                prefs.edit()
                    .putString(KEY_RECENT_CONTENT, JSONArray(recent).toString())
                    .putString(KEY_SEEN_IDS, JSONArray(nextSeenIds).toString())
                    .apply()
                return false
            }
            val cutoff = System.currentTimeMillis() - RECENT_CONTENT_TTL_MS
            val nextRecent = (recent.filter { it.optLong("t") >= cutoff } + JSONObject()
                .put("k", key)
                .put("c", channel)
                .put("t", receivedAt))
                .takeLast(MAX_RECENT_CONTENT)

            val updated = JSONArray()
            queue.forEach(updated::put)
            updated.put(item)
            prefs.edit()
                .putString(KEY_QUEUE, updated.toString())
                .putString(KEY_SEEN_IDS, JSONArray(nextSeenIds).toString())
                .putString(KEY_RECENT_CONTENT, JSONArray(nextRecent).toString())
                .apply()
        }
        return true
    }

    fun readPending(context: Context, profileKey: String): List<JSONObject> {
        if (profileKey.isBlank()) return emptyList()
        val prefs = preferences(context)
        synchronized(lock) {
            return readQueue(prefs.getString(KEY_QUEUE, null))
                .filter { it.optString("profileKey") == profileKey }
        }
    }

    fun acknowledge(context: Context, profileKey: String, ids: Set<String>) {
        if (profileKey.isBlank() || ids.isEmpty()) return
        val prefs = preferences(context)
        synchronized(lock) {
            val retained = JSONArray()
            readQueue(prefs.getString(KEY_QUEUE, null))
                .filterNot { it.optString("profileKey") == profileKey && it.optString("id") in ids }
                .forEach(retained::put)
            val handled = (readStringList(prefs.getString(KEY_HANDLED_IDS, null)) + ids)
                .distinct()
                .takeLast(MAX_HANDLED_IDS)
            prefs.edit()
                .putString(KEY_QUEUE, retained.toString())
                .putString(KEY_HANDLED_IDS, JSONArray(handled).toString())
                .apply()
        }
    }

    fun clear(context: Context, profileKey: String) {
        if (profileKey.isBlank()) return
        val prefs = preferences(context)
        synchronized(lock) {
            val removedIds = mutableListOf<String>()
            val retained = JSONArray()
            readQueue(prefs.getString(KEY_QUEUE, null)).forEach { item ->
                if (item.optString("profileKey") == profileKey) removedIds.add(item.optString("id"))
                else retained.put(item)
            }
            val handled = (readStringList(prefs.getString(KEY_HANDLED_IDS, null)) + removedIds)
                .filter(String::isNotBlank)
                .distinct()
                .takeLast(MAX_HANDLED_IDS)
            prefs.edit()
                .putString(KEY_QUEUE, retained.toString())
                .putString(KEY_HANDLED_IDS, JSONArray(handled).toString())
                .apply()
        }
    }

    private fun preferences(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun packageUpdateTime(context: Context): Long = try {
        context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
    } catch (_: Exception) {
        System.currentTimeMillis()
    }

    private fun profileSuffix(profileKey: String): String = sha256(profileKey).take(24)

    private fun messageId(sender: String, body: String, receivedAt: Long): String =
        sha256("$sender|$body|$receivedAt")

    /** Notifications may drop "[Web발신]", add an "알림" title or rewrap lines. */
    private fun contentKey(body: String): String = sha256(
        body.replace(Regex("\\[?Web발신\\]?", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^\\s*알림"), "")
            .replace(Regex("\\s+"), ""),
    ).take(32)

    // Must stay in step with IGNORE_TRANSACTION / APPROVAL in src/utils/smsImport.ts.
    // Approvals often mention 잔여한도, 포인트 적립 or 결제일, so only clear ads
    // and billing notices are dropped; an approval keyword is still required.
    private fun isFinancialCandidate(body: String): Boolean {
        if (!Regex("(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\s*원").containsMatchIn(body)) return false
        if (!Regex("승인|결제\\s*완료|카드\\s*사용|체크\\s*사용|승인\\s*취소|결제\\s*취소|매입\\s*취소|취소\\s*완료|환불\\s*완료").containsMatchIn(body)) return false
        return !Regex("\\(광고\\)|무료\\s*수신\\s*거부|수신\\s*거부|결제\\s*예정|청구\\s*(?:금액|예정|안내)|명세서|이용\\s*대금|납부\\s*(?:예정|안내)|자동\\s*이체").containsMatchIn(body)
    }

    private fun readQueue(raw: String?): List<JSONObject> = try {
        val array = JSONArray(raw ?: "[]")
        buildList {
            for (index in 0 until array.length()) array.optJSONObject(index)?.let(::add)
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
