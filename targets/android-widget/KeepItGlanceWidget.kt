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
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.TextPaint
import android.text.TextUtils
import android.util.Base64
import android.util.TypedValue
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.time.Duration
import java.time.Instant
import kotlin.concurrent.thread
import kotlin.math.min
import kotlin.math.sin

data class WidgetSnapshotData(
  val coupleId: String,
  val partnerName: String,
  val statusEmoji: String?,
  val statusText: String?,
  val statusExpiresAt: String?,
  val momentPhotoUri: String?,
  val momentFrontPhotoUri: String?,
  val momentCaption: String?,
  val momentPostedAt: String?,
  val momentLocked: Boolean,
  val streakCount: Int,
  val deepLinkUrl: String,
  val updatedAt: String,
  val locationLabel: String?,
  val musicTitle: String?,
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
      try {
        val snapshot = readSnapshot(context)
        val photoBitmap = loadMomentBitmap(snapshot)
        val cardBitmap = drawMochyWidgetBitmap(
          context = context,
          snapshot = snapshot,
          photo = photoBitmap,
          isMedium = isMedium,
          widthDp = if (isMedium) 300 else 155,
          heightDp = minHeightDp.coerceIn(135, 165)
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

        val resolvedLayoutId = context.resources.getIdentifier(
          "keepit_appwidget",
          "layout",
          context.packageName
        )
        val resolvedImageId = context.resources.getIdentifier(
          "widget_canvas_image",
          "id",
          context.packageName
        )

        val useCustomLayout = resolvedLayoutId != 0 && resolvedImageId != 0
        val layoutId = if (useCustomLayout) resolvedLayoutId else android.R.layout.activity_list_item
        val imageViewId = if (useCustomLayout) resolvedImageId else android.R.id.icon

        val views = RemoteViews(context.packageName, layoutId).apply {
          setImageViewBitmap(imageViewId, cardBitmap)
          setOnClickPendingIntent(imageViewId, pendingIntent)
          if (!useCustomLayout) {
            setTextViewText(
              android.R.id.text1,
              snapshot?.let {
                "${it.partnerName} · ${activeStatusText(it) ?: formatTimeAgo(it.momentPostedAt ?: it.updatedAt)}"
              } ?: "KeepIt · Tap to open"
            )
            setOnClickPendingIntent(android.R.id.text1, pendingIntent)
          }
        }

        appWidgetManager.updateAppWidget(widgetId, views)
      } catch (_: Throwable) {
        // Guard against RemoteViews / Binder IPC exceptions crashing the app process
      }
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
    // Cap pixel dimensions so ARGB_8888 bitmap stays well under Android's 1MB Binder IPC transaction limit
    val maxW = if (isMedium) 520 else 300
    val maxH = 300
    val w = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, widthDp.toFloat(), metrics)
      .toInt()
      .coerceIn(200, maxW)
    val h = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, heightDp.toFloat(), metrics)
      .toInt()
      .coerceIn(180, maxH)
    val scaleFactor = w.toFloat() / widthDp.toFloat().coerceAtLeast(1f)
    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val density = scaleFactor.coerceIn(1.2f, 2.0f)
    val scaledDensity = density

    val radius = 24f * density
    val cardRect = RectF(0f, 0f, w.toFloat(), h.toFloat())
    val clipPath = Path().apply {
      addRoundRect(cardRect, radius, radius, Path.Direction.CW)
    }
    canvas.save()
    canvas.clipPath(clipPath)

    val isLocked = snapshot?.momentLocked == true

    if (photo != null && !isLocked) {
      drawCenterCropBitmap(canvas, photo, cardRect)
      val scrimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        shader = LinearGradient(
          0f,
          0f,
          0f,
          h.toFloat(),
          intArrayOf(
            Color.argb(145, 10, 10, 14),
            Color.argb(40, 10, 10, 14),
            Color.argb(195, 10, 10, 14)
          ),
          floatArrayOf(0f, 0.45f, 1f),
          Shader.TileMode.CLAMP
        )
      }
      canvas.drawRect(cardRect, scrimPaint)
    } else if (isLocked) {
      val lockedBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        shader = LinearGradient(
          0f,
          0f,
          w.toFloat(),
          h.toFloat(),
          intArrayOf(
            Color.parseColor("#18181F"),
            Color.parseColor("#241F2E"),
            Color.parseColor("#141418")
          ),
          floatArrayOf(0f, 0.55f, 1f),
          Shader.TileMode.CLAMP
        )
      }
      canvas.drawRect(cardRect, lockedBgPaint)
      drawLockedMotif(canvas, w.toFloat(), h.toFloat(), density)
    } else {
      // Rich stylized warm coffee / sunlight illustration when photo is null & unlocked
      drawWarmSunlightCoffeeScene(canvas, w.toFloat(), h.toFloat(), density, isMedium)
    }

    val pad = 14f * density
    val titleText = snapshot?.partnerName?.takeIf { it.isNotBlank() } ?: "KeepIt"
    val streakCount = snapshot?.streakCount ?: 0
    val statusLine = snapshot?.let { activeStatusText(it) }
    val timeLabel = snapshot?.let { formatTimeAgo(it.momentPostedAt ?: it.updatedAt) } ?: "Live"

    // Top row: Partner Name + Streak pill (or time ago)
    val streakBadgeWidth = if (streakCount > 0) {
      drawStreakPill(canvas, "${streakCount}d 🔥", w - pad, pad, density, scaledDensity)
    } else {
      drawTimePill(canvas, timeLabel, w - pad, pad, density, scaledDensity)
    }

    val maxTitleWidth = (w - pad * 2f - streakBadgeWidth - 8f * density).coerceAtLeast(60f * density)
    val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = (if (isMedium) 16f else 14.5f) * scaledDensity
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      setShadowLayer(6f * density, 0f, 2f * density, Color.argb(120, 0, 0, 0))
    }
    val ellipsizedTitle = TextUtils.ellipsize(
      titleText,
      titlePaint,
      maxTitleWidth,
      TextUtils.TruncateAt.END
    ).toString()
    canvas.drawText(ellipsizedTitle, pad, pad + titlePaint.textSize * 0.92f, titlePaint)

    // Optional live status chip below title
    if (!statusLine.isNullOrBlank() && !isLocked) {
      drawStatusChip(
        canvas = canvas,
        text = statusLine,
        left = pad,
        top = pad + titlePaint.textSize + 8f * density,
        maxWidth = (w - pad * 2f).coerceAtLeast(80f * density),
        density = density,
        scaledDensity = scaledDensity
      )
    }

    // Bottom row: #KeepIt watermark bottom-left + caption/subtitle above or alongside
    val watermarkPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(235, 255, 248, 236)
      textSize = 11f * scaledDensity
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      letterSpacing = 0.03f
      setShadowLayer(4f * density, 0f, 1.5f * density, Color.argb(140, 0, 0, 0))
    }
    val watermarkText = "#KeepIt"
    val watermarkBadgePadH = 7f * density
    val watermarkBadgePadV = 3.5f * density
    val wmTextWidth = watermarkPaint.measureText(watermarkText)
    val wmHeight = watermarkPaint.textSize + watermarkBadgePadV * 2f
    val wmRect = RectF(
      pad,
      h - pad - wmHeight,
      pad + wmTextWidth + watermarkBadgePadH * 2f,
      h - pad
    )
    val wmBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(128, 16, 14, 18)
    }
    val wmStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 1f * density
      color = Color.argb(72, 255, 255, 255)
    }
    canvas.drawRoundRect(wmRect, wmHeight / 2f, wmHeight / 2f, wmBgPaint)
    canvas.drawRoundRect(wmRect, wmHeight / 2f, wmHeight / 2f, wmStrokePaint)
    canvas.drawText(
      watermarkText,
      wmRect.left + watermarkBadgePadH,
      wmRect.bottom - watermarkBadgePadV - watermarkPaint.descent() * 0.5f,
      watermarkPaint
    )

    val subtitle = when {
      snapshot == null -> "Tap to pair & share Moments"
      isLocked -> "Moment locked · Tap to post yours"
      !snapshot.momentCaption.isNullOrBlank() -> snapshot.momentCaption
      !snapshot.locationLabel.isNullOrBlank() -> "📍 ${snapshot.locationLabel}"
      else -> "Captured today's Moment ✨"
    }

    val subPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(235, 255, 255, 255)
      textSize = (if (isMedium) 12.5f else 11.5f) * scaledDensity
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
      setShadowLayer(5f * density, 0f, 1.5f * density, Color.argb(140, 0, 0, 0))
    }

    if (isMedium) {
      val subLeft = wmRect.right + 10f * density
      val availSubWidth = (w - pad - subLeft).coerceAtLeast(60f * density)
      val ellipsizedSub = TextUtils.ellipsize(
        subtitle,
        subPaint,
        availSubWidth,
        TextUtils.TruncateAt.END
      ).toString()
      canvas.drawText(
        ellipsizedSub,
        subLeft,
        wmRect.centerY() + subPaint.textSize * 0.36f,
        subPaint
      )
    } else {
      val availSubWidth = (w - pad * 2f).coerceAtLeast(60f * density)
      val ellipsizedSub = TextUtils.ellipsize(
        subtitle,
        subPaint,
        availSubWidth,
        TextUtils.TruncateAt.END
      ).toString()
      canvas.drawText(
        ellipsizedSub,
        pad,
        wmRect.top - 6f * density,
        subPaint
      )
    }

    // Subtle glass border around card
    val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 1.2f * density
      color = Color.argb(56, 255, 255, 255)
    }
    val inset = borderPaint.strokeWidth / 2f
    canvas.drawRoundRect(
      RectF(inset, inset, w - inset, h - inset),
      radius,
      radius,
      borderPaint
    )

    canvas.restore()
    return out
  }

  private fun drawCenterCropBitmap(canvas: Canvas, source: Bitmap, dst: RectF) {
    val srcW = source.width.toFloat().coerceAtLeast(1f)
    val srcH = source.height.toFloat().coerceAtLeast(1f)
    val dstW = dst.width()
    val dstH = dst.height()
    val scale = maxOf(dstW / srcW, dstH / srcH)
    val scaledW = srcW * scale
    val scaledH = srcH * scale
    val left = dst.left + (dstW - scaledW) / 2f
    val top = dst.top + (dstH - scaledH) / 2f
    val target = RectF(left, top, left + scaledW, top + scaledH)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    canvas.drawBitmap(source, null, target, paint)
  }

  private fun drawWarmSunlightCoffeeScene(
    canvas: Canvas,
    w: Float,
    h: Float,
    density: Float,
    isMedium: Boolean
  ) {
    // Rich golden-hour amber -> terracotta -> espresso gradient
    val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(
        0f,
        0f,
        w,
        h,
        intArrayOf(
          Color.parseColor("#F6B26B"),
          Color.parseColor("#D97742"),
          Color.parseColor("#6E3B2B"),
          Color.parseColor("#241715")
        ),
        floatArrayOf(0f, 0.36f, 0.74f, 1f),
        Shader.TileMode.CLAMP
      )
    }
    canvas.drawRect(0f, 0f, w, h, bgPaint)

    // Warm morning sunbeam radial glow in upper-right
    val sunX = w * 0.76f
    val sunY = h * 0.28f
    val sunRadius = min(w, h) * 0.62f
    val sunGlowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = RadialGradient(
        sunX,
        sunY,
        sunRadius,
        intArrayOf(
          Color.argb(190, 255, 244, 214),
          Color.argb(95, 255, 212, 140),
          Color.argb(0, 255, 180, 100)
        ),
        floatArrayOf(0f, 0.45f, 1f),
        Shader.TileMode.CLAMP
      )
    }
    canvas.drawCircle(sunX, sunY, sunRadius, sunGlowPaint)

    // Diagonal window-blind sun rays
    val rayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(28, 255, 248, 230)
    }
    for (i in 0..2) {
      val offset = i * 28f * density
      val rayPath = Path().apply {
        moveTo(w * 0.45f + offset, 0f)
        lineTo(w * 0.62f + offset, 0f)
        lineTo(w * 0.22f + offset, h)
        lineTo(w * 0.06f + offset, h)
        close()
      }
      canvas.drawPath(rayPath, rayPaint)
    }

    // Subtle tabletop horizon curve
    val tablePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(75, 24, 14, 12)
    }
    canvas.drawOval(
      RectF(-w * 0.15f, h * 0.64f, w * 1.15f, h * 1.25f),
      tablePaint
    )

    // Stylized warm ceramic coffee cup + saucer + steam wisps
    val cupCenterX = if (isMedium) w * 0.72f else w * 0.66f
    val cupCenterY = h * 0.60f
    val cupScale = (min(w, h) / 220f).coerceIn(0.75f, 1.35f)
    val cupW = 46f * cupScale
    val cupH = 34f * cupScale

    // Saucer
    val saucerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(215, 250, 236, 218)
    }
    canvas.drawOval(
      RectF(
        cupCenterX - cupW * 0.78f,
        cupCenterY + cupH * 0.36f,
        cupCenterX + cupW * 0.78f,
        cupCenterY + cupH * 0.68f
      ),
      saucerPaint
    )

    // Cup handle
    val handlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 4.2f * cupScale
      color = Color.argb(230, 255, 244, 230)
    }
    canvas.drawArc(
      RectF(
        cupCenterX + cupW * 0.28f,
        cupCenterY - cupH * 0.28f,
        cupCenterX + cupW * 0.72f,
        cupCenterY + cupH * 0.28f
      ),
      -70f,
      150f,
      false,
      handlePaint
    )

    // Cup body
    val cupBodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(
        cupCenterX - cupW / 2f,
        cupCenterY - cupH / 2f,
        cupCenterX + cupW / 2f,
        cupCenterY + cupH / 2f,
        Color.parseColor("#FFF7EC"),
        Color.parseColor("#E6CDB3"),
        Shader.TileMode.CLAMP
      )
    }
    val cupRect = RectF(
      cupCenterX - cupW / 2f,
      cupCenterY - cupH * 0.45f,
      cupCenterX + cupW / 2f,
      cupCenterY + cupH * 0.48f
    )
    canvas.drawRoundRect(cupRect, 12f * cupScale, 14f * cupScale, cupBodyPaint)

    // Rich espresso crema rim
    val espressoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#5C301E")
    }
    canvas.drawOval(
      RectF(
        cupRect.left + 4f * cupScale,
        cupRect.top - 4f * cupScale,
        cupRect.right - 4f * cupScale,
        cupRect.top + 8f * cupScale
      ),
      espressoPaint
    )

    // Gentle rising steam wisps
    val steamPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeCap = Paint.Cap.ROUND
      strokeWidth = 2.2f * cupScale
      color = Color.argb(155, 255, 248, 236)
    }
    for (wisp in -1..1) {
      val baseX = cupCenterX + wisp * 9f * cupScale
      val baseY = cupRect.top - 6f * cupScale
      val steamPath = Path().apply {
        moveTo(baseX, baseY)
        for (step in 1..10) {
          val t = step / 10f
          val dx = sin((t * 4.5 + wisp).toDouble()).toFloat() * 4.5f * cupScale
          lineTo(baseX + dx, baseY - t * 22f * cupScale)
        }
      }
      canvas.drawPath(steamPath, steamPaint)
    }
  }

  private fun drawLockedMotif(canvas: Canvas, w: Float, h: Float, density: Float) {
    val cx = w * 0.5f
    val cy = h * 0.48f
    val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = RadialGradient(
        cx,
        cy,
        min(w, h) * 0.4f,
        Color.argb(70, 224, 224, 240),
        Color.argb(0, 224, 224, 240),
        Shader.TileMode.CLAMP
      )
    }
    canvas.drawCircle(cx, cy, min(w, h) * 0.4f, glowPaint)

    val lockPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 2.2f * density
      color = Color.argb(190, 230, 230, 240)
    }
    val bodyW = 22f * density
    val bodyH = 18f * density
    canvas.drawRoundRect(
      RectF(cx - bodyW / 2f, cy - bodyH * 0.2f, cx + bodyW / 2f, cy + bodyH * 0.8f),
      5f * density,
      5f * density,
      lockPaint
    )
    canvas.drawArc(
      RectF(cx - 7f * density, cy - bodyH * 0.85f, cx + 7f * density, cy + bodyH * 0.1f),
      180f,
      180f,
      false,
      lockPaint
    )
  }

  private fun drawStreakPill(
    canvas: Canvas,
    label: String,
    rightEdge: Float,
    topEdge: Float,
    density: Float,
    scaledDensity: Float
  ): Float {
    val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#FFE8C2")
      textSize = 11f * scaledDensity
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }
    val padH = 8f * density
    val padV = 4f * density
    val textW = textPaint.measureText(label)
    val pillW = textW + padH * 2f
    val pillH = textPaint.textSize + padV * 2f
    val rect = RectF(rightEdge - pillW, topEdge, rightEdge, topEdge + pillH)

    val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(150, 28, 20, 16)
    }
    val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 1f * density
      color = Color.argb(95, 255, 210, 145)
    }
    canvas.drawRoundRect(rect, pillH / 2f, pillH / 2f, bgPaint)
    canvas.drawRoundRect(rect, pillH / 2f, pillH / 2f, borderPaint)
    canvas.drawText(
      label,
      rect.left + padH,
      rect.bottom - padV - textPaint.descent() * 0.45f,
      textPaint
    )
    return pillW
  }

  private fun drawTimePill(
    canvas: Canvas,
    label: String,
    rightEdge: Float,
    topEdge: Float,
    density: Float,
    scaledDensity: Float
  ): Float {
    val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(220, 255, 255, 255)
      textSize = 10.5f * scaledDensity
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }
    val padH = 7f * density
    val padV = 3.5f * density
    val pillW = textPaint.measureText(label) + padH * 2f
    val pillH = textPaint.textSize + padV * 2f
    val rect = RectF(rightEdge - pillW, topEdge, rightEdge, topEdge + pillH)
    val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(115, 18, 18, 22)
    }
    canvas.drawRoundRect(rect, pillH / 2f, pillH / 2f, bgPaint)
    canvas.drawText(
      label,
      rect.left + padH,
      rect.bottom - padV - textPaint.descent() * 0.45f,
      textPaint
    )
    return pillW
  }

  private fun drawStatusChip(
    canvas: Canvas,
    text: String,
    left: Float,
    top: Float,
    maxWidth: Float,
    density: Float,
    scaledDensity: Float
  ) {
    val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = 11f * scaledDensity
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }
    val padH = 8.5f * density
    val padV = 4f * density
    val dotR = 3f * density
    val dotGap = 5.5f * density
    val availTextW = (maxWidth - padH * 2f - dotR * 2f - dotGap).coerceAtLeast(36f * density)
    val clipped = TextUtils.ellipsize(text, textPaint, availTextW, TextUtils.TruncateAt.END).toString()
    val textW = textPaint.measureText(clipped)
    val chipW = textW + padH * 2f + dotR * 2f + dotGap
    val chipH = textPaint.textSize + padV * 2f
    val rect = RectF(left, top, left + chipW, top + chipH)

    val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(155, 20, 20, 24)
    }
    val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 1f * density
      color = Color.argb(70, 255, 255, 255)
    }
    canvas.drawRoundRect(rect, chipH / 2f, chipH / 2f, bgPaint)
    canvas.drawRoundRect(rect, chipH / 2f, chipH / 2f, strokePaint)

    val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#34C759")
    }
    val dotCx = rect.left + padH + dotR
    val dotCy = rect.centerY()
    canvas.drawCircle(dotCx, dotCy, dotR, dotPaint)

    canvas.drawText(
      clipped,
      dotCx + dotR + dotGap,
      rect.bottom - padV - textPaint.descent() * 0.45f,
      textPaint
    )
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
        momentFrontPhotoUri = json.optStringOrNull("momentFrontPhotoUri"),
        momentCaption = json.optStringOrNull("momentCaption"),
        momentPostedAt = json.optStringOrNull("momentPostedAt"),
        momentLocked = json.optBoolean("momentLocked", false),
        streakCount = json.optInt("streakCount", 0),
        deepLinkUrl = json.optString("deepLinkUrl", "keepit://"),
        updatedAt = json.optString("updatedAt", ""),
        locationLabel = json.optStringOrNull("locationLabel"),
        musicTitle = json.optStringOrNull("musicTitle"),
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
        uriStr.startsWith("data:image/jpeg;base64,") ||
          uriStr.startsWith("data:image/jpg;base64,") ||
          uriStr.startsWith("data:image/png;base64,") ||
          uriStr.startsWith("data:image/webp;base64,") -> {
          val commaIndex = uriStr.indexOf(',')
          if (commaIndex < 0 || commaIndex + 1 >= uriStr.length) return null
          val base64Payload = uriStr.substring(commaIndex + 1)
          val bytes = Base64.decode(base64Payload, Base64.DEFAULT)
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
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
        uriStr.startsWith("data:image/svg+xml") -> {
          renderSimulatedSvgDataUriToBitmap(uriStr)
        }
        else -> null
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun renderSimulatedSvgDataUriToBitmap(svgDataUri: String): Bitmap {
    val decoded = runCatching { Uri.decode(svgDataUri) }.getOrDefault(svgDataUri)
    val hexMatches = Regex("#[0-9A-Fa-f]{6}")
      .findAll(decoded)
      .map { it.value }
      .toList()
    val topColor = runCatching { Color.parseColor(hexMatches.getOrNull(0) ?: "#EBD8C8") }.getOrDefault(Color.parseColor("#EBD8C8"))
    val midColor = runCatching { Color.parseColor(hexMatches.getOrNull(1) ?: "#D7B49E") }.getOrDefault(Color.parseColor("#D7B49E"))
    val accentColor = runCatching { Color.parseColor(hexMatches.getOrNull(3) ?: "#D95D39") }.getOrDefault(Color.parseColor("#D95D39"))

    val bmp = Bitmap.createBitmap(450, 600, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val skyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(
        0f, 0f, 0f, 600f,
        intArrayOf(topColor, midColor, Color.parseColor("#1E1B18")),
        floatArrayOf(0f, 0.55f, 1f),
        Shader.TileMode.CLAMP
      )
    }
    c.drawRect(0f, 0f, 450f, 600f, skyPaint)
    val orbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = accentColor
      alpha = 210
    }
    c.drawCircle(335f, 140f, 58f, orbPaint)
    return bmp
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
