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
import android.media.MediaMetadataRetriever
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


    AsyncFunction("extractVideoThumbnailJpegAsync") Coroutine { videoUri: String ->
      if (videoUri.isBlank()) return@Coroutine null
      val retriever = MediaMetadataRetriever()
      try {
        if (videoUri.startsWith("file://")) {
          val path = Uri.parse(videoUri).path ?: return@Coroutine null
          retriever.setDataSource(path)
        } else {
          retriever.setDataSource(context, Uri.parse(videoUri))
        }
        val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        val firstFrame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
          ?: retriever.frameAtTime
          ?: return@Coroutine null
        val endTimestampUs = if (durationMs > 800L) (durationMs - 300L) * 1000L else (durationMs * 500L)
        val lastFrame = retriever.getFrameAtTime(endTimestampUs, MediaMetadataRetriever.OPTION_CLOSEST)
          ?: firstFrame

        fun saveScaledJpeg(bmp: Bitmap, tag: String): String {
          val maxDim = 960
          val scale = minOf(1f, maxDim.toFloat() / maxOf(bmp.width, bmp.height).coerceAtLeast(1))
          val scaled = if (scale < 1f) {
            Bitmap.createScaledBitmap(
              bmp,
              (bmp.width * scale).toInt().coerceAtLeast(1),
              (bmp.height * scale).toInt().coerceAtLeast(1),
              true
            )
          } else {
            bmp
          }
          val outFile = File(context.cacheDir, "keepit-vthumb-$tag-${System.currentTimeMillis()}.jpg")
          FileOutputStream(outFile).use { fos ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 82, fos)
          }
          if (scaled !== bmp) scaled.recycle()
          return Uri.fromFile(outFile).toString()
        }

        val startUri = saveScaledJpeg(firstFrame, "start")
        val endUri = if (lastFrame !== firstFrame) saveScaledJpeg(lastFrame, "end") else startUri
        if (lastFrame !== firstFrame) lastFrame.recycle()
        firstFrame.recycle()
        org.json.JSONObject().apply {
          put("startUri", startUri)
          put("endUri", endUri)
        }.toString()
      } catch (_: Throwable) {
        null
      } finally {
        runCatching { retriever.release() }
      }
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

      // Permanent BeReal-style #keepit SVG + timestamp watermark embedded on bottom-left of photo
      val wmX = cardRect.left + 42f
      drawKeepItWatermarkSvgPath(canvas, wmX, cardRect.bottom - 116f, 3.52f)
      val wmTimePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(235, 255, 255, 255)
        textSize = 22f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlign = Paint.Align.LEFT
        setShadowLayer(6f, 0f, 2f, Color.argb(210, 0, 0, 0))
      }
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

  private fun decodeUriToBitmap(uriStr: String, maxDimension: Int = 1280): Bitmap? {
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
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
          val sample = computeInSampleSize(bounds.outWidth, bounds.outHeight, maxDimension)
          BitmapFactory.decodeByteArray(
            bytes,
            0,
            bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample }
          )
        }
        uriStr.startsWith("file://") -> {
          val path = Uri.parse(uriStr).path ?: return null
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeFile(path, bounds)
          val sample = computeInSampleSize(bounds.outWidth, bounds.outHeight, maxDimension)
          BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
        }
        uriStr.startsWith("http://") || uriStr.startsWith("https://") -> {
          val bytes = URL(uriStr).openStream().use { it.readBytes() }
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
          val sample = computeInSampleSize(bounds.outWidth, bounds.outHeight, maxDimension)
          BitmapFactory.decodeByteArray(
            bytes,
            0,
            bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample }
          )
        }
        else -> null
      }
    }.getOrNull()
  }

  private fun computeInSampleSize(width: Int, height: Int, maxDimension: Int): Int {
    var sample = 1
    val largest = maxOf(width, height)
    while (largest / sample > maxDimension) {
      sample *= 2
    }
    return sample
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

  private fun drawKeepItWatermarkSvgPath(canvas: Canvas, originX: Float, originY: Float, scale: Float) {
    val tokens = Regex("[A-Za-z]|[-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?")
      .findAll(KEEPIT_WATERMARK_PATH_D)
      .map { it.value }
      .toList()

    val path = Path()
    var i = 0
    var cmd = ""
    var curX = 0f
    var curY = 0f

    fun nextFloat(): Float {
      if (i >= tokens.size) return 0f
      val v = tokens[i].toFloatOrNull() ?: 0f
      i += 1
      return v
    }

    while (i < tokens.size) {
      val tok = tokens[i]
      if (tok.isNotEmpty() && tok[0].isLetter()) {
        cmd = tok
        i += 1
      }
      when (cmd) {
        "M" -> {
          curX = nextFloat()
          curY = nextFloat()
          path.moveTo(originX + curX * scale, originY + curY * scale)
        }
        "L" -> {
          curX = nextFloat()
          curY = nextFloat()
          path.lineTo(originX + curX * scale, originY + curY * scale)
        }
        "H" -> {
          curX = nextFloat()
          path.lineTo(originX + curX * scale, originY + curY * scale)
        }
        "V" -> {
          curY = nextFloat()
          path.lineTo(originX + curX * scale, originY + curY * scale)
        }
        "C" -> {
          val x1 = nextFloat()
          val y1 = nextFloat()
          val x2 = nextFloat()
          val y2 = nextFloat()
          curX = nextFloat()
          curY = nextFloat()
          path.cubicTo(
            originX + x1 * scale, originY + y1 * scale,
            originX + x2 * scale, originY + y2 * scale,
            originX + curX * scale, originY + curY * scale
          )
        }
        "Z", "z" -> {
          path.close()
        }
        else -> {
          i += 1
        }
      }
    }

    val logoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      color = Color.WHITE
      setShadowLayer(8f, 0f, 3f, Color.argb(210, 0, 0, 0))
    }
    canvas.drawPath(path, logoPaint)
  }

  companion object {
    const val PREFS_NAME = "keepit_widget_prefs"
    const val SNAPSHOT_KEY = "widget_snapshot"
    const val KEEPIT_WATERMARK_PATH_D = "M4.20738 8.50945L7.35848 0.233129H9.53048L6.36738 8.50945H4.20738ZM0.829146 6.86584L1.50226 5.09401H8.49826L7.82515 6.86584H0.829146ZM1.00338 8.50945L4.15448 0.233129H6.32648L3.16338 8.50945H1.00338ZM2.02195 3.75348L2.69506 1.98165H9.67906L9.00595 3.75348H2.02195ZM8.91241 8.50945L10.9355 0.233129H13.2635L12.2776 4.26638L14.6991 2.21478H17.4111L14.2939 4.75596L15.9204 8.50945H13.4484L12.5096 5.96827L11.6963 6.64436L11.2404 8.50945H8.91241ZM19.2418 8.64933C18.5458 8.64933 17.9711 8.51334 17.5175 8.24134C17.064 7.96935 16.7531 7.58856 16.5848 7.09898C16.4184 6.60162 16.4159 6.02267 16.5773 5.36212C16.7388 4.70157 17.0234 4.1265 17.4311 3.63691C17.8387 3.14733 18.3358 2.76654 18.9223 2.49455C19.5107 2.21478 20.1529 2.0749 20.8489 2.0749C21.5449 2.0749 22.1097 2.21867 22.5435 2.5062C22.9871 2.78597 23.2812 3.18618 23.426 3.70685C23.5707 4.22752 23.5566 4.84145 23.3838 5.54863L23.2869 5.94496H18.8349C18.7578 6.32574 18.7965 6.60939 18.9509 6.7959C19.1152 6.97464 19.3573 7.06401 19.6773 7.06401C19.9093 7.06401 20.1158 7.02127 20.2967 6.93578C20.4856 6.8503 20.6426 6.69876 20.7678 6.48117L23.0433 6.59774C22.702 7.27383 22.1927 7.78673 21.5152 8.13643C20.8396 8.47837 20.0818 8.64933 19.2418 8.64933ZM19.1312 4.73265H21.2552C21.3365 4.3674 21.3039 4.09153 21.1575 3.90502C21.013 3.71074 20.7848 3.6136 20.4728 3.6136C20.1768 3.6136 19.9041 3.71462 19.6547 3.91668C19.4133 4.11873 19.2388 4.39072 19.1312 4.73265ZM26.7418 8.64933C26.0458 8.64933 25.4711 8.51334 25.0175 8.24134C24.564 7.96935 24.2531 7.58856 24.0848 7.09898C23.9184 6.60162 23.9159 6.02267 24.0773 5.36212C24.2388 4.70157 24.5234 4.1265 24.9311 3.63691C25.3387 3.14733 25.8358 2.76654 26.4223 2.49455C27.0107 2.21478 27.6529 2.0749 28.3489 2.0749C29.0449 2.0749 29.6097 2.21867 30.0435 2.5062C30.4871 2.78597 30.7812 3.18618 30.926 3.70685C31.0707 4.22752 31.0566 4.84145 30.8838 5.54863L30.7869 5.94496H26.3349C26.2578 6.32574 26.2965 6.60939 26.4509 6.7959C26.6152 6.97464 26.8573 7.06401 27.1773 7.06401C27.4093 7.06401 27.6158 7.02127 27.7967 6.93578C27.9856 6.8503 28.1426 6.69876 28.2678 6.48117L30.5433 6.59774C30.202 7.27383 29.6927 7.78673 29.0152 8.13643C28.3396 8.47837 27.5818 8.64933 26.7418 8.64933ZM26.6312 4.73265H28.7552C28.8365 4.3674 28.8039 4.09153 28.6575 3.90502C28.513 3.71074 28.2848 3.6136 27.9728 3.6136C27.6768 3.6136 27.4041 3.71462 27.1547 3.91668C26.9133 4.11873 26.7388 4.39072 26.6312 4.73265ZM30.6686 10.258L32.6347 2.21478H34.9027L34.6287 3.532L34.487 3.47372C34.7571 3.02299 35.0977 2.67717 35.5086 2.43626C35.9194 2.19536 36.3649 2.0749 36.8449 2.0749C37.4209 2.0749 37.8747 2.21478 38.2063 2.49455C38.5379 2.77431 38.7469 3.16287 38.8334 3.66023C38.9217 4.14981 38.887 4.71711 38.7293 5.36212C38.5736 5.99936 38.3269 6.56665 37.9893 7.06401C37.6598 7.56136 37.2568 7.94992 36.7804 8.22969C36.312 8.50945 35.7898 8.64933 35.2138 8.64933C34.9098 8.64933 34.6391 8.59493 34.4017 8.48614C34.1662 8.36957 33.9741 8.20637 33.8254 7.99655C33.6847 7.78673 33.6015 7.53805 33.5757 7.25052L33.7431 7.20389L32.9966 10.258H30.6686ZM34.8539 7.02904C35.1899 7.02904 35.49 6.88139 35.7542 6.58608C36.0202 6.283 36.216 5.87502 36.3413 5.36212C36.4667 4.84922 36.4695 4.44512 36.3497 4.14981C36.2318 3.84673 36.0048 3.6952 35.6688 3.6952C35.4448 3.6952 35.2376 3.75737 35.0472 3.8817C34.8568 4.00604 34.6872 4.19255 34.5385 4.44123C34.3977 4.68991 34.2826 4.99687 34.1933 5.36212C34.1041 5.72736 34.069 6.03432 34.0882 6.283C34.1155 6.53168 34.1939 6.71819 34.3235 6.84253C34.4531 6.96687 34.6299 7.02904 34.8539 7.02904ZM38.9007 8.50945L40.4394 2.21478H42.7674L41.2287 8.50945H38.9007ZM40.5573 1.58532L40.9448 -6.10651e-06H43.3448L42.9573 1.58532H40.5573ZM45.2031 8.50945C44.4751 8.50945 43.983 8.34625 43.7268 8.01987C43.4725 7.6857 43.4337 7.15726 43.6103 6.43454L45.0037 0.734371H47.3317L46.0181 6.10815C45.9421 6.419 45.9539 6.63271 46.0534 6.74927C46.1628 6.85807 46.3535 6.91247 46.6255 6.91247H47.5135L47.1231 8.50945H45.2031ZM43.1475 3.81176L43.5378 2.21478H48.6618L48.2715 3.81176H43.1475Z"
  }
}
