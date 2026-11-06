package com.keepit.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.time.Duration
import java.time.Instant
import kotlin.concurrent.thread

data class WidgetSnapshotData(
  val coupleId: String,
  val partnerName: String,
  val statusEmoji: String?,
  val statusText: String?,
  val statusExpiresAt: String?,
  val momentPhotoUri: String?,
  val momentCaption: String?,
  val momentPostedAt: String?,
  val momentLocked: Boolean,
  val streakCount: Int,
  val deepLinkUrl: String,
  val updatedAt: String,
)

class KeepItGlanceWidgetReceiver : AppWidgetProvider() {
  companion object {
    const val PREFS_NAME = "keepit_widget_prefs"
    const val SNAPSHOT_KEY = "widget_snapshot"

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, KeepItGlanceWidgetReceiver::class.java)
      val ids = manager.getAppWidgetIds(component)
      if (ids.isNotEmpty()) {
        val intent = Intent(context, KeepItGlanceWidgetReceiver::class.java).apply {
          action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        }
        context.sendBroadcast(intent)
      }
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    for (widgetId in appWidgetIds) {
      val options = appWidgetManager.getAppWidgetOptions(widgetId)
      renderWidgetAsync(context, appWidgetManager, widgetId, options)
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle
  ) {
    renderWidgetAsync(context, appWidgetManager, appWidgetId, newOptions)
  }

  private fun renderWidgetAsync(
    context: Context,
    appWidgetManager: AppWidgetManager,
    widgetId: Int,
    options: Bundle?
  ) {
    val minWidthDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 160) ?: 160
    val minHeightDp = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 150) ?: 150
    val isMedium = minWidthDp >= 220

    thread(start = true) {
      val snapshot = readSnapshot(context)
      val photoBitmap = loadMomentBitmap(snapshot)
      val cardBitmap = drawMochyWidgetBitmap(
        context = context,
        snapshot = snapshot,
        photo = photoBitmap,
        isMedium = isMedium,
        widthDp = if (isMedium) 320 else 160,
        heightDp = minHeightDp.coerceIn(140, 180)
      )

      val targetUri = when {
        snapshot == null -> "keepit://"
        snapshot.momentLocked -> "keepit://camera"
        snapshot.deepLinkUrl.isNotBlank() -> snapshot.deepLinkUrl
        else -> "keepit://"
      }

      val launchIntent = Intent(Intent.ACTION_VIEW, Uri.parse(targetUri)).apply {
        setPackage(context.packageName)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }

      val pendingIntent = PendingIntent.getActivity(
        context,
        widgetId,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val views = RemoteViews(context.packageName, android.R.layout.activity_list_item).apply {
        setImageViewBitmap(android.R.id.icon, cardBitmap)
        setTextViewText(
          android.R.id.text1,
          snapshot?.let { "${it.partnerName} · ${activeStatusText(it) ?: formatTimeAgo(it.momentPostedAt ?: it.updatedAt)}" }
            ?: "KeepIt · Tap to pair"
        )
        setOnClickPendingIntent(android.R.id.icon, pendingIntent)
        setOnClickPendingIntent(android.R.id.text1, pendingIntent)
      }

      appWidgetManager.updateAppWidget(widgetId, views)
    }
  }

  private fun drawMochyWidgetBitmap(
    context: Context,
    snapshot: WidgetSnapshotData?,
    photo: Bitmap?,
    isMedium: Boolean,
    widthDp: Int,
    heightDp: Int
  ): Bitmap {
    val metrics = context.resources.displayMetrics
    val w = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, widthDp.toFloat(), metrics).toInt().coerceAtLeast(240)
    val h = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, heightDp.toFloat(), metrics).toInt().coerceAtLeast(240)
    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)

    val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#141416")
    }
    val radius = 24f * metrics.density
    canvas.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), radius, radius, bgPaint)

    if (photo != null && snapshot != null && !snapshot.momentLocked) {
      val dst = RectF(0f, 0f, w.toFloat(), h.toFloat())
      canvas.drawBitmap(photo, null, dst, null)
    }

    val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = 15f * metrics.scaledDensity
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }
    val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#9A9AA0")
      textSize = 12f * metrics.scaledDensity
    }

    val pad = 16f * metrics.density
    val title = snapshot?.partnerName ?: "KeepIt"
    val subtitle = when {
      snapshot == null -> "Tap to pair with your partner"
      snapshot.momentLocked -> "Moment locked · Post yours to reveal"
      else -> activeStatusText(snapshot) ?: snapshot.momentCaption ?: "Captured today's Moment"
    }

    canvas.drawText(title, pad, pad + titlePaint.textSize, titlePaint)
    canvas.drawText(subtitle, pad, h - pad, subPaint)
    return out
  }

  private fun readSnapshot(context: Context): WidgetSnapshotData? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(SNAPSHOT_KEY, null) ?: return null
    return try {
      val json = JSONObject(raw)
      WidgetSnapshotData(
        coupleId = json.optString("coupleId", ""),
        partnerName = json.optString("partnerName", "Your partner"),
        statusEmoji = json.optStringOrNull("statusEmoji"),
        statusText = json.optStringOrNull("statusText"),
        statusExpiresAt = json.optStringOrNull("statusExpiresAt"),
        momentPhotoUri = json.optStringOrNull("momentPhotoUri"),
        momentCaption = json.optStringOrNull("momentCaption"),
        momentPostedAt = json.optStringOrNull("momentPostedAt"),
        momentLocked = json.optBoolean("momentLocked", false),
        streakCount = json.optInt("streakCount", 0),
        deepLinkUrl = json.optString("deepLinkUrl", "keepit://"),
        updatedAt = json.optString("updatedAt", ""),
      )
    } catch (_: Throwable) {
      null
    }
  }

  private fun loadMomentBitmap(snapshot: WidgetSnapshotData?): Bitmap? {
    if (snapshot == null || snapshot.momentLocked) return null
    val uriStr = snapshot.momentPhotoUri ?: return null
    return try {
      when {
        uriStr.startsWith("file://") -> {
          val path = Uri.parse(uriStr).path ?: return null
          val file = File(path)
          if (file.exists()) BitmapFactory.decodeFile(file.absolutePath) else null
        }
        uriStr.startsWith("http://") || uriStr.startsWith("https://") -> {
          URL(uriStr).openStream().use { stream ->
            BitmapFactory.decodeStream(stream)
          }
        }
        else -> null
      }
    } catch (_: Throwable) {
      null
    }
  }
}

private fun JSONObject.optStringOrNull(key: String): String? {
  if (isNull(key)) return null
  val value = optString(key, "")
  return value.ifBlank { null }
}

private fun activeStatusText(snapshot: WidgetSnapshotData): String? {
  val text = snapshot.statusText?.takeIf { it.isNotBlank() } ?: return null
  val expiresIso = snapshot.statusExpiresAt
  if (!expiresIso.isNullOrBlank()) {
    try {
      if (Instant.parse(expiresIso).isBefore(Instant.now())) {
        return null
      }
    } catch (_: Throwable) {
      // Keep status visible if timestamp cannot be parsed
    }
  }
  val emoji = snapshot.statusEmoji?.takeIf { it.isNotBlank() }
  return if (emoji != null) "$emoji $text" else text
}

private fun formatTimeAgo(isoTimestamp: String?): String {
  if (isoTimestamp.isNullOrBlank()) return "Waiting"
  return try {
    val instant = Instant.parse(isoTimestamp)
    val seconds = Duration.between(instant, Instant.now()).seconds.coerceAtLeast(0)
    when {
      seconds < 60 -> "Just now"
      seconds < 3600 -> "${seconds / 60}m ago"
      seconds < 86400 -> "${seconds / 3600}h ago"
      else -> "${seconds / 86400}d ago"
    }
  } catch (_: Throwable) {
    "Just now"
  }
}
