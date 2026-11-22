package com.getfamilyfi.watchsession

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * A watch's own id and its session, kept in its preferences with every value encrypted by an AES-GCM
 * key in the Android Keystore, which never leaves it. The session is the watch's own paired device's,
 * never the phone's. Each app names its own preferences file and key, so two apps never share one.
 */
open class FFSecureStore(context: Context, prefsName: String, private val keyAlias: String) : FFSessionStore {
  protected val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
  protected val lock = Any()

  /** This watch's own id, made once; the phone sets the watch up under it. */
  val watchId: String
    get() = synchronized(lock) {
      read("watchId") ?: UUID.randomUUID().toString().lowercase().also { write("watchId", it) }
    }

  override val session: FFDeviceSession?
    get() = synchronized(lock) { read("session")?.let { runCatching { FFDeviceSession.from(JSONObject(it)) }.getOrNull() } }

  fun saveSession(session: FFDeviceSession) = synchronized(lock) { write("session", session.toJson().toString()) }

  /** Keeps the session a provisioning gives (`FFDeviceSession.fromProvisioning`), or throws. */
  fun accept(json: String) = saveSession(FFDeviceSession.fromProvisioning(json, watchId))

  override fun updateSession(change: (FFDeviceSession) -> FFDeviceSession?) = synchronized(lock) {
    val current = session ?: return@synchronized
    change(current)?.let { saveSession(it) }
    Unit
  }

  /** Signed out: the household ended this session. The watch's id stays, so the phone can set it up again. */
  override fun clear() = synchronized(lock) {
    prefs.edit().remove("session").apply()
    Unit
  }

  protected fun read(name: String): String? {
    val stored = prefs.getString(name, null) ?: return null
    return runCatching {
      val bytes = Base64.decode(stored, Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_LENGTH))
      String(cipher.doFinal(bytes, IV_LENGTH, bytes.size - IV_LENGTH), Charsets.UTF_8)
    }.getOrNull()
  }

  protected fun write(name: String, value: String) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    prefs.edit().putString(name, Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()
  }

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(
        KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .build(),
      )
      generateKey()
    }
  }

  private companion object {
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val IV_LENGTH = 12
  }
}
