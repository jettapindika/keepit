package expo.modules.keepitwidgetbridge

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.TextPaint
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.net.URL
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KeepItWidgetBridgeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("KeepItWidgetBridge")

    AsyncFunction("syncWidgetSnapshotAsync") Coroutine { snapshotJson: String ->
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit()
        .putString(SNAPSHOT_KEY, snapshotJson)
        .apply()
      notifyWidgetUpdate()
    }

    AsyncFunction("clearWidgetSnapshotAsync") Coroutine { ->
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit()
        .remove(SNAPSHOT_KEY)
        .apply()
      notifyWidgetUpdate()
    }

    AsyncFunction("getLastSyncedWidgetSnapshotAsync") {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.getString(SNAPSHOT_KEY, null)
    }

    AsyncFunction("requestPinWidgetAsync") Coroutine { ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        return@Coroutine false
      }
      val receiverClass = runCatching {
        Class.forName("com.keepit.app.widget.KeepItGlanceWidgetReceiver")
      }.getOrNull() ?: return@Coroutine false

      val appWidgetManager = AppWidgetManager.getInstance(context)
      if (!appWidgetManager.isRequestPinAppWidgetSupported) {
        return@Coroutine false
      }

      val componentName = ComponentName(context, receiverClass)
      notifyWidgetUpdate()
      appWidgetManager.requestPinAppWidget(componentName, null, null)
    }

    AsyncFunction("exportCompositeMomentJpegAsync") Coroutine { payloadJson: String ->
      val json = org.json.JSONObject(payloadJson)
      val aspect = json.optString("aspect", "3:4")
      val backUri = json.optString("backUri", "")
      val frontUri = json.optString("frontUri", "")
      val authorName = json.optString("authorName", "KeepIt")
      val timestampLabel = json.optString("timestampLabel", "").ifBlank {
        java.text.SimpleDateFormat("MMM d · hh:mm a", java.util.Locale.getDefault()).format(java.util.Date())
      }
      val caption = json.optString("caption", "")
      val filterHex = json.optString("filterHex", "#D95D39")
      val filterActive = json.optBoolean("filterActive", false)
      val themeTop = json.optString("themeTop", "#191418")
      val themeBottom = json.optString("themeBottom", "#070709")
      val filename = json.optString("filename", "keepit-moment.jpg").replace(Regex("[^a-zA-Z0-9._-]"), "_")
      val saveToGallery = json.optBoolean("saveToGallery", true)

      val outW = if (aspect == "9:16") 1080 else 900
      val outH = if (aspect == "9:16") 1920 else 1200
      val outBitmap = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(outBitmap)

      val backBmp = decodeUriToBitmap(backUri)
      val frontBmp = decodeUriToBitmap(frontUri)

      if (aspect == "9:16") {
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          shader = LinearGradient(
            0f, 0f, 0f, outH.toFloat(),
            Color.parseColor(themeTop),
            Color.parseColor(themeBottom),
            Shader.TileMode.CLAMP
          )
        }
        canvas.drawRect(0f, 0f, outW.toFloat(), outH.toFloat(), bgPaint)
      } else {
        canvas.drawColor(Color.parseColor("#141416"))
      }

      val cardRect = if (aspect == "9:16") RectF(90f, 230f, 990f, 1430f) else RectF(0f, 0f, 900f, 1200f)
      val clipPath = Path().apply {
        addRoundRect(cardRect, 48f, 48f, Path.Direction.CW)
      }
      canvas.save()
      canvas.clipPath(clipPath)

      if (backBmp != null) {
        drawCenterCrop(canvas, backBmp, cardRect)
      } else {
        val fallbackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          shader = LinearGradient(
            cardRect.left, cardRect.top, cardRect.left, cardRect.bottom,
            Color.parseColor("#EBD8C8"), Color.parseColor("#231E1B"), Shader.TileMode.CLAMP
          )
        }
        canvas.drawRect(cardRect, fallbackPaint)
      }

      if (filterActive) {
        val tintPaint = Paint().apply {
          color = Color.parseColor(filterHex)
          alpha = 52
        }
        canvas.drawRect(cardRect, tintPaint)
      }

      // Always draw the top-left secondary PIP photo frame (even when source is SVG / simulated)
      val pipRect = RectF(cardRect.left + 38f, cardRect.top + 38f, cardRect.left + 278f, cardRect.top + 358f)
      val pipPath = Path().apply { addRoundRect(pipRect, 34f, 34f, Path.Direction.CW) }
      canvas.save()
      canvas.clipPath(pipPath)
      if (frontBmp != null) {
        drawCenterCrop(canvas, frontBmp, pipRect)
      } else {
        val pipBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          shader = LinearGradient(
            pipRect.left, pipRect.top, pipRect.left, pipRect.bottom,
            Color.parseColor("#2A221E"), Color.parseColor("#181412"), Shader.TileMode.CLAMP
          )
        }
        canvas.drawRect(pipRect, pipBgPaint)
        val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E3B99B") }
        canvas.drawCircle(pipRect.centerX(), pipRect.top + 120f, 48f, headPaint)
        val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor(filterHex) }
        canvas.drawRoundRect(
          RectF(pipRect.left + 44f, pipRect.top + 182f, pipRect.right - 44f, pipRect.bottom - 18f),
          42f, 42f, bodyPaint
        )
      }
      canvas.restore()
      val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 6f
        color = Color.parseColor("#FAF7F2")
      }
      canvas.drawRoundRect(pipRect, 34f, 34f, strokePaint)
      // Overlays
      val overlaysArr = json.optJSONArray("overlays")
      if (overlaysArr != null) {
        val ovPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.WHITE
          textSize = 44f
          typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
          textAlign = Paint.Align.CENTER
        }
        for (i in 0 until overlaysArr.length()) {
          val ov = overlaysArr.optJSONObject(i) ?: continue
          val content = ov.optString("content", "")
          val xPct = ov.optDouble("xPct", 50.0).toFloat()
          val yPct = ov.optDouble("yPct", 50.0).toFloat()
          val ox = cardRect.left + (xPct / 100f) * cardRect.width()
          val oy = cardRect.top + (yPct / 100f) * cardRect.height()
          canvas.drawText(content, ox, oy, ovPaint)
        }
      }

      // Permanent BeReal-style #keepit + timestamp watermark on bottom-left of photo
      val wmX = cardRect.left + 40f
      val wmTitlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 38f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlign = Paint.Align.LEFT
        setShadowLayer(8f, 0f, 3f, Color.argb(210, 0, 0, 0))
      }
      val wmTimePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(235, 255, 255, 255)
        textSize = 22f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlign = Paint.Align.LEFT
        setShadowLayer(6f, 0f, 2f, Color.argb(210, 0, 0, 0))
      }
      canvas.drawText("#keepit", wmX, cardRect.bottom - 80f, wmTitlePaint)
      canvas.drawText(timestampLabel, wmX, cardRect.bottom - 44f, wmTimePaint)
      canvas.restore()
      if (aspect == "9:16") {
        val footerPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.WHITE
          textSize = 34f
          typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
          textAlign = Paint.Align.CENTER
        }
        val label = if (caption.isNotBlank()) "“$caption”" else "$authorName’s KeepIt Moment"
        canvas.drawText(label, outW / 2f, 1560f, footerPaint)
      }

      val outFile = File(context.cacheDir, filename)
      FileOutputStream(outFile).use { fos ->
        outBitmap.compress(Bitmap.CompressFormat.JPEG, 92, fos)
      }

      var gallerySaved = false
      if (saveToGallery && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        runCatching {
          val resolver = context.contentResolver
          val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/KeepIt")
          }
          val itemUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
          if (itemUri != null) {
            resolver.openOutputStream(itemUri)?.use { os ->
              outBitmap.compress(Bitmap.CompressFormat.JPEG, 92, os)
            }
            gallerySaved = true
          }
        }
      }

      org.json.JSONObject().apply {
        put("fileUri", Uri.fromFile(outFile).toString())
        put("savedToGallery", gallerySaved)
      }.toString()
    }
  }
  private fun notifyWidgetUpdate() {
    val receiverClass = runCatching {
      Class.forName("com.keepit.app.widget.KeepItGlanceWidgetReceiver")
    }.getOrNull() ?: return

    val appWidgetManager = AppWidgetManager.getInstance(context)
    val componentName = ComponentName(context, receiverClass)
    val ids = appWidgetManager.getAppWidgetIds(componentName)
    if (ids.isNotEmpty()) {
      val intent = Intent(context, receiverClass).apply {
        action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      }
      context.sendBroadcast(intent)
    }
  }

  private fun decodeUriToBitmap(uriStr: String): Bitmap? {
    if (uriStr.isBlank()) return null
    return runCatching {
      when {
        uriStr.startsWith("data:image/jpeg;base64,") ||
          uriStr.startsWith("data:image/jpg;base64,") ||
          uriStr.startsWith("data:image/png;base64,") ||
          uriStr.startsWith("data:image/webp;base64,") -> {
          val comma = uriStr.indexOf(',')
          if (comma < 0) return null
          val bytes = Base64.decode(uriStr.substring(comma + 1), Base64.DEFAULT)
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
        uriStr.startsWith("file://") -> {
          val path = Uri.parse(uriStr).path ?: return null
          BitmapFactory.decodeFile(path)
        }
        uriStr.startsWith("http://") || uriStr.startsWith("https://") -> {
          URL(uriStr).openStream().use { BitmapFactory.decodeStream(it) }
        }
        else -> null
      }
    }.getOrNull()
  }

  private fun drawCenterCrop(canvas: Canvas, source: Bitmap, dst: RectF) {
    val srcW = source.width.toFloat().coerceAtLeast(1f)
    val srcH = source.height.toFloat().coerceAtLeast(1f)
    val scale = maxOf(dst.width() / srcW, dst.height() / srcH)
    val scaledW = srcW * scale
    val scaledH = srcH * scale
    val left = dst.left + (dst.width() - scaledW) / 2f
    val top = dst.top + (dst.height() - scaledH) / 2f
    val target = RectF(left, top, left + scaledW, top + scaledH)
    canvas.drawBitmap(source, null, target, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
  }

  companion object {
    const val PREFS_NAME = "keepit_widget_prefs"
    const val SNAPSHOT_KEY = "widget_snapshot"
  }
}
