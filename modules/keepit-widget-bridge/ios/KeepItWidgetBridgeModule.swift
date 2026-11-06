import ExpoModulesCore
import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

public final class KeepItWidgetBridgeModule: Module {
  private static let appGroupSuite = "group.com.keepit.shared"
  private static let snapshotKey = "widget_snapshot"

  public func definition() -> ModuleDefinition {
    Name("KeepItWidgetBridge")

    AsyncFunction("syncWidgetSnapshotAsync") { (snapshotJson: String) in
      guard let sharedDefaults = UserDefaults(suiteName: Self.appGroupSuite) else {
        return
      }
      sharedDefaults.set(snapshotJson, forKey: Self.snapshotKey)
      sharedDefaults.synchronize()

      #if canImport(WidgetKit)
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
      #endif
    }

    AsyncFunction("clearWidgetSnapshotAsync") {
      if let sharedDefaults = UserDefaults(suiteName: Self.appGroupSuite) {
        sharedDefaults.removeObject(forKey: Self.snapshotKey)
        sharedDefaults.synchronize()
      }

      #if canImport(WidgetKit)
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
      #endif
    }

    AsyncFunction("getLastSyncedWidgetSnapshotAsync") { () -> String? in
      guard let sharedDefaults = UserDefaults(suiteName: Self.appGroupSuite) else {
        return nil
      }
      return sharedDefaults.string(forKey: Self.snapshotKey)
    }
  }
}
