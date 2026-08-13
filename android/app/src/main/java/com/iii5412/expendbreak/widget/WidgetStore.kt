package com.iii5412.expendbreak.widget

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class StoredWidgetPayload(val snapshot: JSONObject, val locked: Boolean)

object WidgetStore {
    private const val PREFS = "expend_break_widget_store"
    private const val CIPHERTEXT = "ciphertext"
    private const val IV = "iv"
    private const val KEY_ALIAS = "expend_break_widget_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    fun isValidSnapshot(snapshot: JSObject): Boolean = try {
        snapshot.getInt("schemaVersion") == 1 &&
            snapshot.optString("periodYM").matches(Regex("^\\d{4}-\\d{2}$")) &&
            snapshot.optString("periodEndDate").matches(Regex("^\\d{4}-\\d{2}-\\d{2}$")) &&
            snapshot.getLong("remainingAllowance") in -9_000_000_000_000L..9_000_000_000_000L &&
            snapshot.getLong("dailySafeAllowance") in 0L..9_000_000_000_000L &&
            snapshot.getInt("daysRemaining") in 0..366 &&
            snapshot.getString("alertLevel") in setOf("safe", "caution", "warning", "danger") &&
            snapshot.getString("privacyMode") in setOf("unlock_required", "always_show", "amounts_hidden")
    } catch (_: Exception) {
        false
    }

    fun write(context: Context, snapshot: JSONObject, locked: Boolean) {
        val payload = JSONObject().put("snapshot", snapshot).put("locked", locked)
        encryptAndSave(context, payload.toString())
    }

    fun setLocked(context: Context, locked: Boolean) {
        val current = read(context) ?: return
        write(context, current.snapshot, locked)
    }

    fun read(context: Context): StoredWidgetPayload? {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val encrypted = preferences.getString(CIPHERTEXT, null) ?: return null
        val iv = preferences.getString(IV, null) ?: return null
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
            )
            val plain = cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP))
            val payload = JSONObject(String(plain, Charsets.UTF_8))
            StoredWidgetPayload(payload.getJSONObject("snapshot"), payload.optBoolean("locked", true))
        } catch (_: Exception) {
            preferences.edit().clear().apply()
            null
        }
    }

    private fun encryptAndSave(context: Context, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }
}
