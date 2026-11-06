package expo.modules.keepitwidgetbridge

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
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

  companion object {
    const val PREFS_NAME = "keepit_widget_prefs"
    const val SNAPSHOT_KEY = "widget_snapshot"
  }
}
