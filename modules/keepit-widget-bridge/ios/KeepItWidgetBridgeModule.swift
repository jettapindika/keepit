import ExpoModulesCore
import Foundation
import UIKit
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

    AsyncFunction("exportCompositeMomentJpegAsync") { (payloadJson: String) -> String in
      guard
        let data = payloadJson.data(using: .utf8),
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      else {
        return "{}"
      }

      let aspect = (obj["aspect"] as? String) ?? "3:4"
      let backUri = (obj["backUri"] as? String) ?? ""
      let frontUri = (obj["frontUri"] as? String) ?? ""
      let authorName = (obj["authorName"] as? String) ?? "KeepIt"
      let caption = (obj["caption"] as? String) ?? ""
      let filename = ((obj["filename"] as? String) ?? "keepit-moment.jpg")
        .replacingOccurrences(of: "/", with: "_")
      let saveToGallery = (obj["saveToGallery"] as? Bool) ?? true

      let size = aspect == "9:16" ? CGSize(width: 1080, height: 1920) : CGSize(width: 900, height: 1200)
      let renderer = UIGraphicsImageRenderer(size: size)
      let backImage = Self.loadUIImage(from: backUri)
      let frontImage = Self.loadUIImage(from: frontUri)

      let composed = renderer.image { ctx in
        UIColor(red: 0.08, green: 0.08, blue: 0.09, alpha: 1.0).setFill()
        ctx.fill(CGRect(origin: .zero, size: size))

        let cardRect = aspect == "9:16"
          ? CGRect(x: 90, y: 230, width: 900, height: 1200)
          : CGRect(x: 0, y: 0, width: 900, height: 1200)

        ctx.cgContext.saveGState()
        UIBezierPath(roundedRect: cardRect, cornerRadius: 48).addClip()
        if let backImage = backImage {
          backImage.draw(in: cardRect)
        } else {
          UIColor(red: 0.85, green: 0.55, blue: 0.35, alpha: 1.0).setFill()
          ctx.fill(cardRect)
        }

        if let frontImage = frontImage {
          let pipRect = CGRect(x: cardRect.minX + 38, y: cardRect.minY + 38, width: 240, height: 320)
          ctx.cgContext.saveGState()
          UIBezierPath(roundedRect: pipRect, cornerRadius: 34).addClip()
          frontImage.draw(in: pipRect)
          ctx.cgContext.restoreGState()
          UIColor.white.setStroke()
          let border = UIBezierPath(roundedRect: pipRect, cornerRadius: 34)
          border.lineWidth = 6
          border.stroke()
        }

        // #KeepIt Watermark
        let wmRect = CGRect(x: cardRect.minX + 36, y: cardRect.maxY - 92, width: 180, height: 58)
        UIColor(white: 0.05, alpha: 0.84).setFill()
        UIBezierPath(roundedRect: wmRect, cornerRadius: 29).fill()
        let wmAttrs: [NSAttributedString.Key: Any] = [
          .font: UIFont.systemFont(ofSize: 28, weight: .heavy),
          .foregroundColor: UIColor.white,
        ]
        ("#KeepIt" as NSString).draw(at: CGPoint(x: wmRect.minX + 34, y: wmRect.minY + 12), withAttributes: wmAttrs)
        ctx.cgContext.restoreGState()

        if aspect == "9:16" {
          let footer = caption.isEmpty ? "\(authorName)’s KeepIt Moment" : "“\(caption)”"
          let footerAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 34, weight: .bold),
            .foregroundColor: UIColor.white,
          ]
          (footer as NSString).draw(at: CGPoint(x: 110, y: 1520), withAttributes: footerAttrs)
        }
      }

      let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
      if let jpegData = composed.jpegData(compressionQuality: 0.92) {
        try? jpegData.write(to: tempUrl, options: .atomic)
      }
      if saveToGallery {
        UIImageWriteToSavedPhotosAlbum(composed, nil, nil, nil)
      }

      let response: [String: Any] = [
        "fileUri": tempUrl.absoluteString,
        "savedToGallery": saveToGallery,
      ]
      if let resData = try? JSONSerialization.data(withJSONObject: response),
         let resStr = String(data: resData, encoding: .utf8) {
        return resStr
      }
      return "{}"
    }
  }

  private static func loadUIImage(from uriString: String) -> UIImage? {
    if uriString.hasPrefix("data:image/"),
       let comma = uriString.firstIndex(of: ",") {
      let b64 = String(uriString[uriString.index(after: comma)...])
      if let decoded = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) {
        return UIImage(data: decoded)
      }
    }
    guard let url = URL(string: uriString) else { return nil }
    if let data = try? Data(contentsOf: url) {
      return UIImage(data: data)
    }
    return nil
  }
}
