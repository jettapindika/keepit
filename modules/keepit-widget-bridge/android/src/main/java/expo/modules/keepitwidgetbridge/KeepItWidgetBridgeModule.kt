package expo.modules.keepitwidgetbridge

import android.content.Context
import com.keepit.app.widget.KeepItGlanceWidget
import androidx.glance.appwidget.updateAll
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

      KeepItGlanceWidget().updateAll(context)
    }

    AsyncFunction("clearWidgetSnapshotAsync") Coroutine { ->
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit()
        .remove(SNAPSHOT_KEY)
        .apply()

      KeepItGlanceWidget().updateAll(context)
    }

    AsyncFunction("getLastSyncedWidgetSnapshotAsync") {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.getString(SNAPSHOT_KEY, null)
    }
  }

  companion object {
    const val PREFS_NAME = "keepit_widget_prefs"
    const val SNAPSHOT_KEY = "widget_snapshot"
  }
}
