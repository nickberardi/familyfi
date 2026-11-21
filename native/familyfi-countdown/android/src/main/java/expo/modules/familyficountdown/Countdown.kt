package expo.modules.familyficountdown

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * The countdown both apps show outside the app on Android, the counterpart of the iPhone's Live
 * Activity (whose views are `apple/CountdownViews.swift`): an ongoing notification whose timer the
 * system keeps running to `until`, with the FamilyFi pause mark in the block colour and the
 * buttons the app's card has (the FamilyFi app's More time and Unblock, FamilyFi Me's Ask for more
 * time). It asks to be promoted to a Live Update, so Android 16 and later show it on the lock
 * screen and as a status bar chip counting down; before that, and when the person turns Live
 * Updates off for the app, it stays an ordinary ongoing notification.
 *
 * Its channel is silent but not low: Android hides low-importance notifications from the lock
 * screen, where a countdown is most use. Every word comes from the app, written with familyfi's
 * display functions. The FamilyFi app posts it through its pause module for a timed block made on
 * the phone; FamilyFi Me posts it from an alarm before a block starts.
 */
object Countdown {
  /** The channel every countdown is posted on, in either app. */
  const val CHANNEL = "countdown"
  /** One countdown per tag (a group, or a block's start): the tag tells them apart. */
  const val ID = 1
  /** The block colour, light (familyfi `src/ui/palette.ts`, `paused`): the icon's tint and the chip's. */
  private const val PAUSED = 0xFFC04C00.toInt()

  /** A button on the countdown: its label and the app link it opens. */
  data class Action(val label: String, val url: String)

  data class Spec(
    /** Which countdown this is; posting the same tag again updates it in place. */
    val tag: String,
    val title: String,
    val text: String,
    /** The end, in milliseconds since the epoch: the timer counts down to it, and it goes then. */
    val until: Long,
    /** The app link a tap on the countdown opens. */
    val url: String?,
    val actions: List<Action>,
  )

  /** Whether the app may post notifications (Android 13 asks first). */
  fun enabled(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

  /**
   * Shows the countdown, or updates the one with the same tag. `channelName` and
   * `channelDescription` are what the system's notification settings call the channel.
   */
  fun post(context: Context, spec: Spec, channelName: String, channelDescription: String) {
    val manager = NotificationManagerCompat.from(context)
    val left = spec.until - System.currentTimeMillis()
    if (!manager.areNotificationsEnabled() || left <= 0) return
    ensureChannel(context, channelName, channelDescription)
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.familyfi_countdown_pause)
      // A tint, not a colourised notification: Android does not promote a colourised one.
      .setColor(PAUSED)
      .setContentTitle(spec.title)
      .setContentText(spec.text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(spec.text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setWhen(spec.until)
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setTimeoutAfter(left)
      // Android 16+: a Live Update, whose chip counts down from `when` (ignored before).
      .setRequestPromotedOngoing(true)
    spec.url?.let { builder.setContentIntent(link(context, it, requestCode(spec.tag, 0))) }
    spec.actions.forEachIndexed { index, action ->
      builder.addAction(0, action.label, link(context, action.url, requestCode(spec.tag, index + 1)))
    }
    try {
      manager.notify(spec.tag, ID, builder.build())
    } catch (_: SecurityException) {
      // Notifications were turned off since the check: nothing to show.
    }
  }

  fun cancel(context: Context, tag: String) {
    NotificationManagerCompat.from(context).cancel(tag, ID)
  }

  /** The tags with a countdown showing: the system's own list, so a restart of the app loses none. */
  fun running(context: Context): List<String> =
    context.getSystemService(NotificationManager::class.java).activeNotifications
      // Channels came in Android 8.0; before it, id and tag alone tell a countdown apart.
      .filter { it.id == ID && it.tag != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || it.notification.channelId == CHANNEL) }
      .mapNotNull { it.tag }

  /** Removes a channel an earlier version posted countdowns on, so settings show only this one. */
  fun retireChannel(context: Context, id: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || id == CHANNEL) return
    context.getSystemService(NotificationManager::class.java).deleteNotificationChannel(id)
  }

  private fun ensureChannel(context: Context, name: String, description: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) != null) return
    // Default importance, so it shows on the lock screen; each countdown is posted silent.
    manager.createNotificationChannel(NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_DEFAULT).apply {
      this.description = description
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
    })
  }

  private fun link(context: Context, url: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  /** A distinct request code per countdown and button, so one countdown's links never replace another's. */
  private fun requestCode(tag: String, slot: Int): Int = 31 * tag.hashCode() + slot
}
