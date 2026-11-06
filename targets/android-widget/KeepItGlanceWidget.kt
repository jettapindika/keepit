package com.keepit.app.widget

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.time.Duration
import java.time.Instant

data class GlanceWidgetSnapshot(
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

private object MochyGlanceColors {
  val canvas = ColorProvider(Color(0xFF000000))
  val surface = ColorProvider(Color(0xFF141416))
  val surfaceElevated = ColorProvider(Color(0xFF1E1E21))
  val ink = ColorProvider(Color(0xFFFFFFFF))
  val inkMuted = ColorProvider(Color(0xFF9A9AA0))
  val accent = ColorProvider(Color(0xFFE0E0E0))
  val accentSoft = ColorProvider(Color(0xFF282830))
  val success = ColorProvider(Color(0xFF34C759))
}

class KeepItGlanceWidget : GlanceAppWidget() {
  companion object {
    const val PREFS_NAME = "keepit_widget_prefs"
    const val SNAPSHOT_KEY = "widget_snapshot"

    private val SMALL_SQUARE = DpSize(110.dp, 110.dp)
    private val MEDIUM_WIDE = DpSize(250.dp, 110.dp)
  }

  override val sizeMode: SizeMode = SizeMode.Responsive(
    setOf(SMALL_SQUARE, MEDIUM_WIDE)
  )

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snapshot = readSnapshot(context)
    val bitmap = loadMomentBitmap(snapshot)

    provideContent {
      val size = LocalSize.current
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

      Box(
        modifier = GlanceModifier
          .fillMaxSize()
          .background(MochyGlanceColors.canvas)
          .cornerRadius(24.dp)
          .clickable(actionStartActivity(launchIntent))
      ) {
        if (size.width >= MEDIUM_WIDE.width) {
          MediumGlanceLayout(snapshot = snapshot, bitmap = bitmap)
        } else {
          SmallGlanceLayout(snapshot = snapshot, bitmap = bitmap)
        }
      }
    }
  }

  private fun readSnapshot(context: Context): GlanceWidgetSnapshot? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(SNAPSHOT_KEY, null) ?: return null
    return try {
      val json = JSONObject(raw)
      GlanceWidgetSnapshot(
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

  private suspend fun loadMomentBitmap(snapshot: GlanceWidgetSnapshot?): Bitmap? =
    withContext(Dispatchers.IO) {
      if (snapshot == null || snapshot.momentLocked) return@withContext null
      val uriStr = snapshot.momentPhotoUri ?: return@withContext null
      try {
        when {
          uriStr.startsWith("file://") -> {
            val path = Uri.parse(uriStr).path ?: return@withContext null
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

class KeepItGlanceWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = KeepItGlanceWidget()
}

@Composable
private fun SmallGlanceLayout(
  snapshot: GlanceWidgetSnapshot?,
  bitmap: Bitmap?,
) {
  if (snapshot == null) {
    UnpairedGlanceState(compact = true)
    return
  }

  val statusLabel = activeStatusText(snapshot)
  val relativeAge = formatTimeAgo(snapshot.momentPostedAt ?: snapshot.updatedAt)

  Box(modifier = GlanceModifier.fillMaxSize()) {
    if (!snapshot.momentLocked && bitmap != null) {
      Image(
        provider = ImageProvider(bitmap),
        contentDescription = "${snapshot.partnerName}'s Moment",
        contentScale = ContentScale.Crop,
        modifier = GlanceModifier.fillMaxSize()
      )
    }

    Column(
      modifier = GlanceModifier
        .fillMaxSize()
        .background(
          if (!snapshot.momentLocked && bitmap != null) {
            ColorProvider(Color(0x88000000))
          } else {
            MochyGlanceColors.surface
          }
        )
        .padding(12.dp)
    ) {
      Row(
        modifier = GlanceModifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
      ) {
        Text(
          text = snapshot.partnerName,
          maxLines = 1,
          style = TextStyle(
            color = MochyGlanceColors.ink,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold
          )
        )
        Spacer(modifier = GlanceModifier.defaultWeight())
        Text(
          text = relativeAge,
          maxLines = 1,
          style = TextStyle(
            color = MochyGlanceColors.inkMuted,
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium
          )
        )
      }

      Spacer(modifier = GlanceModifier.defaultWeight())

      when {
        snapshot.momentLocked -> {
          Text(
            text = "Moment locked",
            maxLines = 1,
            style = TextStyle(
              color = MochyGlanceColors.ink,
              fontSize = 13.sp,
              fontWeight = FontWeight.Bold
            )
          )
          Text(
            text = "Post yours to reveal",
            maxLines = 1,
            style = TextStyle(
              color = MochyGlanceColors.inkMuted,
              fontSize = 11.sp
            )
          )
        }
        statusLabel != null -> {
          Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = GlanceModifier
              .background(MochyGlanceColors.surfaceElevated)
              .cornerRadius(999.dp)
              .padding(horizontal = 8.dp, vertical = 4.dp)
          ) {
            Box(
              modifier = GlanceModifier
                .size(6.dp)
                .background(MochyGlanceColors.success)
                .cornerRadius(999.dp)
            ) {}
            Spacer(modifier = GlanceModifier.width(5.dp))
            Text(
              text = statusLabel,
              maxLines = 1,
              style = TextStyle(
                color = MochyGlanceColors.ink,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium
              )
            )
          }
        }
        !snapshot.momentCaption.isNullOrBlank() -> {
          Text(
            text = snapshot.momentCaption,
            maxLines = 2,
            style = TextStyle(
              color = MochyGlanceColors.ink,
              fontSize = 11.sp,
              fontWeight = FontWeight.Medium
            )
          )
        }
        else -> {
          Text(
            text = "No active status",
            maxLines = 1,
            style = TextStyle(
              color = MochyGlanceColors.inkMuted,
              fontSize = 11.sp
            )
          )
        }
      }
    }
  }
}

@Composable
private fun MediumGlanceLayout(
  snapshot: GlanceWidgetSnapshot?,
  bitmap: Bitmap?,
) {
  if (snapshot == null) {
    UnpairedGlanceState(compact = false)
    return
  }

  val statusLabel = activeStatusText(snapshot)
  val relativeAge = formatTimeAgo(snapshot.momentPostedAt ?: snapshot.updatedAt)

  Row(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(MochyGlanceColors.canvas)
      .padding(12.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    Box(
      modifier = GlanceModifier
        .width(96.dp)
        .fillMaxHeight()
        .background(MochyGlanceColors.surface)
        .cornerRadius(18.dp),
      contentAlignment = Alignment.Center
    ) {
      when {
        snapshot.momentLocked -> {
          Text(
            text = "Locked",
            style = TextStyle(
              color = MochyGlanceColors.accent,
              fontSize = 11.sp,
              fontWeight = FontWeight.Bold
            )
          )
        }
        bitmap != null -> {
          Image(
            provider = ImageProvider(bitmap),
            contentDescription = "${snapshot.partnerName}'s Moment",
            contentScale = ContentScale.Crop,
            modifier = GlanceModifier.fillMaxSize()
          )
        }
        else -> {
          Text(
            text = "No photo",
            style = TextStyle(
              color = MochyGlanceColors.inkMuted,
              fontSize = 10.sp
            )
          )
        }
      }
    }

    Spacer(modifier = GlanceModifier.width(12.dp))

    Column(
      modifier = GlanceModifier
        .defaultWeight()
        .fillMaxHeight()
    ) {
      Row(
        modifier = GlanceModifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
      ) {
        Text(
          text = snapshot.partnerName,
          maxLines = 1,
          style = TextStyle(
            color = MochyGlanceColors.ink,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold
          )
        )
        Spacer(modifier = GlanceModifier.defaultWeight())
        if (snapshot.streakCount > 0) {
          Text(
            text = "${snapshot.streakCount}d",
            style = TextStyle(
              color = MochyGlanceColors.accent,
              fontSize = 10.sp,
              fontWeight = FontWeight.Bold
            ),
            modifier = GlanceModifier
              .background(MochyGlanceColors.accentSoft)
              .cornerRadius(999.dp)
              .padding(horizontal = 7.dp, vertical = 2.dp)
          )
        }
      }

      Spacer(modifier = GlanceModifier.height(4.dp))

      if (statusLabel != null) {
        Row(
          verticalAlignment = Alignment.CenterVertically,
          modifier = GlanceModifier
            .background(MochyGlanceColors.surface)
            .cornerRadius(999.dp)
            .padding(horizontal = 8.dp, vertical = 4.dp)
        ) {
          Box(
            modifier = GlanceModifier
              .size(6.dp)
              .background(MochyGlanceColors.success)
              .cornerRadius(999.dp)
          ) {}
          Spacer(modifier = GlanceModifier.width(5.dp))
          Text(
            text = statusLabel,
            maxLines = 1,
            style = TextStyle(
              color = MochyGlanceColors.ink,
              fontSize = 11.sp,
              fontWeight = FontWeight.Medium
            )
          )
        }
      } else {
        Text(
          text = "No active status",
          maxLines = 1,
          style = TextStyle(
            color = MochyGlanceColors.inkMuted,
            fontSize = 11.sp
          )
        )
      }

      Spacer(modifier = GlanceModifier.defaultWeight())

      val detailLine = when {
        snapshot.momentLocked -> "Post your Moment to unlock ${snapshot.partnerName}'s photo."
        !snapshot.momentCaption.isNullOrBlank() -> snapshot.momentCaption
        snapshot.momentPostedAt != null -> "Captured today's Moment."
        else -> "Waiting for today's daily window."
      }

      Text(
        text = detailLine,
        maxLines = 1,
        style = TextStyle(
          color = if (snapshot.momentLocked) MochyGlanceColors.inkMuted else MochyGlanceColors.ink,
          fontSize = 11.sp
        )
      )

      Spacer(modifier = GlanceModifier.height(2.dp))

      Text(
        text = "$relativeAge · ${if (snapshot.momentLocked) "Tap to capture" else "Tap to open"}",
        maxLines = 1,
        style = TextStyle(
          color = MochyGlanceColors.inkMuted,
          fontSize = 10.sp,
          fontWeight = FontWeight.Medium
        )
      )
    }
  }
}

@Composable
private fun UnpairedGlanceState(compact: Boolean) {
  Column(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(MochyGlanceColors.surface)
      .padding(14.dp)
  ) {
    Text(
      text = "KeepIt",
      style = TextStyle(
        color = MochyGlanceColors.ink,
        fontSize = if (compact) 14.sp else 16.sp,
        fontWeight = FontWeight.Bold
      )
    )
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(
      text = "Open KeepIt to pair with your partner and sync Moments here.",
      maxLines = if (compact) 3 else 2,
      style = TextStyle(
        color = MochyGlanceColors.inkMuted,
        fontSize = 11.sp
      )
    )
  }
}

private fun JSONObject.optStringOrNull(key: String): String? {
  if (isNull(key)) return null
  val value = optString(key, "")
  return value.ifBlank { null }
}

private fun activeStatusText(snapshot: GlanceWidgetSnapshot): String? {
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
