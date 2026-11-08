import ExpoModulesCore
import Foundation
import UIKit
import AVFoundation
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

    AsyncFunction("extractVideoThumbnailJpegAsync") { (videoUri: String) -> String? in
      guard let url = URL(string: videoUri) else { return nil }
      let asset = AVURLAsset(url: url)
      let generator = AVAssetImageGenerator(asset: asset)
      generator.appliesPreferredTrackTransform = true
      generator.maximumSize = CGSize(width: 960, height: 960)
      guard let startCg = try? generator.copyCGImage(at: .zero, actualTime: nil) else {
        return nil
      }
      let durationSec = CMTimeGetSeconds(asset.duration)
      let endTime = durationSec > 0.8
        ? CMTime(seconds: max(0, durationSec - 0.3), preferredTimescale: 600)
        : .zero
      let endCg = (try? generator.copyCGImage(at: endTime, actualTime: nil)) ?? startCg
      let stamp = Int(Date().timeIntervalSince1970 * 1000)
      let startUrl = FileManager.default.temporaryDirectory.appendingPathComponent("keepit-vthumb-start-\(stamp).jpg")
      let endUrl = FileManager.default.temporaryDirectory.appendingPathComponent("keepit-vthumb-end-\(stamp).jpg")
      guard let startJpeg = UIImage(cgImage: startCg).jpegData(compressionQuality: 0.82),
            let endJpeg = UIImage(cgImage: endCg).jpegData(compressionQuality: 0.82) else {
        return nil
      }
      try? startJpeg.write(to: startUrl, options: .atomic)
      try? endJpeg.write(to: endUrl, options: .atomic)
      let payload: [String: String] = [
        "startUri": startUrl.absoluteString,
        "endUri": endUrl.absoluteString,
      ]
      if let data = try? JSONSerialization.data(withJSONObject: payload),
         let str = String(data: data, encoding: .utf8) {
        return str
      }
      return startUrl.absoluteString
    }
    AsyncFunction("compressImageToDataUriAsync") { (uriStr: String, maxDimension: Int, quality: Int) -> String? in
      guard !uriStr.isEmpty, let image = Self.loadUIImage(from: uriStr) else {
        return nil
      }
      let targetMax = CGFloat(min(max(maxDimension, 128), 1280))
      let maxEdge = max(image.size.width, image.size.height, 1)
      let scale = min(1.0, targetMax / maxEdge)
      let targetSize = CGSize(
        width: max(1, round(image.size.width * scale)),
        height: max(1, round(image.size.height * scale))
      )
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1.0
      let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
      let scaledImage = renderer.image { _ in
        image.draw(in: CGRect(origin: .zero, size: targetSize))
      }
      var q = CGFloat(min(max(quality, 30), 92)) / 100.0
      guard var jpegData = scaledImage.jpegData(compressionQuality: q) else {
        return nil
      }
      while jpegData.count > 56_000 && q > 0.34 {
        q -= 0.12
        if let nextData = scaledImage.jpegData(compressionQuality: max(0.30, q)) {
          jpegData = nextData
        } else {
          break
        }
      }
      return "data:image/jpeg;base64," + jpegData.base64EncodedString()
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
      let rawTimestamp = (obj["timestampLabel"] as? String) ?? ""
      let timestampLabel: String = {
        if !rawTimestamp.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          return rawTimestamp
        }
        let df = DateFormatter()
        df.dateFormat = "MMM d · hh:mm a"
        return df.string(from: Date())
      }()
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

        // Always draw the top-left secondary PIP photo frame
        let pipRect = CGRect(x: cardRect.minX + 38, y: cardRect.minY + 38, width: 240, height: 320)
        ctx.cgContext.saveGState()
        UIBezierPath(roundedRect: pipRect, cornerRadius: 34).addClip()
        if let frontImage = frontImage {
          frontImage.draw(in: pipRect)
        } else {
          UIColor(red: 0.14, green: 0.11, blue: 0.10, alpha: 1.0).setFill()
          ctx.fill(pipRect)
          UIColor(red: 0.89, green: 0.73, blue: 0.61, alpha: 1.0).setFill()
          UIBezierPath(ovalIn: CGRect(x: pipRect.midX - 48, y: pipRect.minY + 72, width: 96, height: 96)).fill()
          UIColor(red: 0.85, green: 0.36, blue: 0.22, alpha: 1.0).setFill()
          UIBezierPath(roundedRect: CGRect(x: pipRect.minX + 44, y: pipRect.minY + 182, width: pipRect.width - 88, height: 120), cornerRadius: 42).fill()
        }
        ctx.cgContext.restoreGState()
        UIColor.white.setStroke()
        let border = UIBezierPath(roundedRect: pipRect, cornerRadius: 34)
        border.lineWidth = 6
        border.stroke()
        // #keepit SVG + Timestamp Watermark directly embedded on photo (bottom-left)
        let wmTimeAttrs: [NSAttributedString.Key: Any] = [
          .font: UIFont.systemFont(ofSize: 22, weight: .bold),
          .foregroundColor: UIColor(white: 1.0, alpha: 0.92),
        ]
        Self.drawKeepItWatermarkSvgPath(
          in: ctx.cgContext,
          origin: CGPoint(x: cardRect.minX + 42, y: cardRect.maxY - 116),
          scale: 3.52
        )
        (timestampLabel as NSString).draw(at: CGPoint(x: cardRect.minX + 42, y: cardRect.maxY - 68), withAttributes: wmTimeAttrs)
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

  private static let keepItWatermarkPathD = "M4.20738 8.50945L7.35848 0.233129H9.53048L6.36738 8.50945H4.20738ZM0.829146 6.86584L1.50226 5.09401H8.49826L7.82515 6.86584H0.829146ZM1.00338 8.50945L4.15448 0.233129H6.32648L3.16338 8.50945H1.00338ZM2.02195 3.75348L2.69506 1.98165H9.67906L9.00595 3.75348H2.02195ZM8.91241 8.50945L10.9355 0.233129H13.2635L12.2776 4.26638L14.6991 2.21478H17.4111L14.2939 4.75596L15.9204 8.50945H13.4484L12.5096 5.96827L11.6963 6.64436L11.2404 8.50945H8.91241ZM19.2418 8.64933C18.5458 8.64933 17.9711 8.51334 17.5175 8.24134C17.064 7.96935 16.7531 7.58856 16.5848 7.09898C16.4184 6.60162 16.4159 6.02267 16.5773 5.36212C16.7388 4.70157 17.0234 4.1265 17.4311 3.63691C17.8387 3.14733 18.3358 2.76654 18.9223 2.49455C19.5107 2.21478 20.1529 2.0749 20.8489 2.0749C21.5449 2.0749 22.1097 2.21867 22.5435 2.5062C22.9871 2.78597 23.2812 3.18618 23.426 3.70685C23.5707 4.22752 23.5566 4.84145 23.3838 5.54863L23.2869 5.94496H18.8349C18.7578 6.32574 18.7965 6.60939 18.9509 6.7959C19.1152 6.97464 19.3573 7.06401 19.6773 7.06401C19.9093 7.06401 20.1158 7.02127 20.2967 6.93578C20.4856 6.8503 20.6426 6.69876 20.7678 6.48117L23.0433 6.59774C22.702 7.27383 22.1927 7.78673 21.5152 8.13643C20.8396 8.47837 20.0818 8.64933 19.2418 8.64933ZM19.1312 4.73265H21.2552C21.3365 4.3674 21.3039 4.09153 21.1575 3.90502C21.013 3.71074 20.7848 3.6136 20.4728 3.6136C20.1768 3.6136 19.9041 3.71462 19.6547 3.91668C19.4133 4.11873 19.2388 4.39072 19.1312 4.73265ZM26.7418 8.64933C26.0458 8.64933 25.4711 8.51334 25.0175 8.24134C24.564 7.96935 24.2531 7.58856 24.0848 7.09898C23.9184 6.60162 23.9159 6.02267 24.0773 5.36212C24.2388 4.70157 24.5234 4.1265 24.9311 3.63691C25.3387 3.14733 25.8358 2.76654 26.4223 2.49455C27.0107 2.21478 27.6529 2.0749 28.3489 2.0749C29.0449 2.0749 29.6097 2.21867 30.0435 2.5062C30.4871 2.78597 30.7812 3.18618 30.926 3.70685C31.0707 4.22752 31.0566 4.84145 30.8838 5.54863L30.7869 5.94496H26.3349C26.2578 6.32574 26.2965 6.60939 26.4509 6.7959C26.6152 6.97464 26.8573 7.06401 27.1773 7.06401C27.4093 7.06401 27.6158 7.02127 27.7967 6.93578C27.9856 6.8503 28.1426 6.69876 28.2678 6.48117L30.5433 6.59774C30.202 7.27383 29.6927 7.78673 29.0152 8.13643C28.3396 8.47837 27.5818 8.64933 26.7418 8.64933ZM26.6312 4.73265H28.7552C28.8365 4.3674 28.8039 4.09153 28.6575 3.90502C28.513 3.71074 28.2848 3.6136 27.9728 3.6136C27.6768 3.6136 27.4041 3.71462 27.1547 3.91668C26.9133 4.11873 26.7388 4.39072 26.6312 4.73265ZM30.6686 10.258L32.6347 2.21478H34.9027L34.6287 3.532L34.487 3.47372C34.7571 3.02299 35.0977 2.67717 35.5086 2.43626C35.9194 2.19536 36.3649 2.0749 36.8449 2.0749C37.4209 2.0749 37.8747 2.21478 38.2063 2.49455C38.5379 2.77431 38.7469 3.16287 38.8334 3.66023C38.9217 4.14981 38.887 4.71711 38.7293 5.36212C38.5736 5.99936 38.3269 6.56665 37.9893 7.06401C37.6598 7.56136 37.2568 7.94992 36.7804 8.22969C36.312 8.50945 35.7898 8.64933 35.2138 8.64933C34.9098 8.64933 34.6391 8.59493 34.4017 8.48614C34.1662 8.36957 33.9741 8.20637 33.8254 7.99655C33.6847 7.78673 33.6015 7.53805 33.5757 7.25052L33.7431 7.20389L32.9966 10.258H30.6686ZM34.8539 7.02904C35.1899 7.02904 35.49 6.88139 35.7542 6.58608C36.0202 6.283 36.216 5.87502 36.3413 5.36212C36.4667 4.84922 36.4695 4.44512 36.3497 4.14981C36.2318 3.84673 36.0048 3.6952 35.6688 3.6952C35.4448 3.6952 35.2376 3.75737 35.0472 3.8817C34.8568 4.00604 34.6872 4.19255 34.5385 4.44123C34.3977 4.68991 34.2826 4.99687 34.1933 5.36212C34.1041 5.72736 34.069 6.03432 34.0882 6.283C34.1155 6.53168 34.1939 6.71819 34.3235 6.84253C34.4531 6.96687 34.6299 7.02904 34.8539 7.02904ZM38.9007 8.50945L40.4394 2.21478H42.7674L41.2287 8.50945H38.9007ZM40.5573 1.58532L40.9448 -6.10651e-06H43.3448L42.9573 1.58532H40.5573ZM45.2031 8.50945C44.4751 8.50945 43.983 8.34625 43.7268 8.01987C43.4725 7.6857 43.4337 7.15726 43.6103 6.43454L45.0037 0.734371H47.3317L46.0181 6.10815C45.9421 6.419 45.9539 6.63271 46.0534 6.74927C46.1628 6.85807 46.3535 6.91247 46.6255 6.91247H47.5135L47.1231 8.50945H45.2031ZM43.1475 3.81176L43.5378 2.21478H48.6618L48.2715 3.81176H43.1475Z"

  private static func drawKeepItWatermarkSvgPath(in cgContext: CGContext, origin: CGPoint, scale: CGFloat) {
    guard let regex = try? NSRegularExpression(pattern: "[A-Za-z]|[-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?") else { return }
    let nsStr = keepItWatermarkPathD as NSString
    let matches = regex.matches(in: keepItWatermarkPathD, range: NSRange(location: 0, length: nsStr.length))
    let tokens = matches.map { nsStr.substring(with: $0.range) }

    let path = CGMutablePath()
    var i = 0
    var cmd = ""
    var curX: CGFloat = 0
    var curY: CGFloat = 0

    func nextFloat() -> CGFloat {
      guard i < tokens.count, let val = Double(tokens[i]) else {
        i += 1
        return 0
      }
      i += 1
      return CGFloat(val)
    }

    while i < tokens.count {
      let tok = tokens[i]
      if let first = tok.first, first.isLetter {
        cmd = tok
        i += 1
      }
      switch cmd {
      case "M":
        curX = nextFloat()
        curY = nextFloat()
        path.move(to: CGPoint(x: origin.x + curX * scale, y: origin.y + curY * scale))
      case "L":
        curX = nextFloat()
        curY = nextFloat()
        path.addLine(to: CGPoint(x: origin.x + curX * scale, y: origin.y + curY * scale))
      case "H":
        curX = nextFloat()
        path.addLine(to: CGPoint(x: origin.x + curX * scale, y: origin.y + curY * scale))
      case "V":
        curY = nextFloat()
        path.addLine(to: CGPoint(x: origin.x + curX * scale, y: origin.y + curY * scale))
      case "C":
        let x1 = nextFloat()
        let y1 = nextFloat()
        let x2 = nextFloat()
        let y2 = nextFloat()
        curX = nextFloat()
        curY = nextFloat()
        path.addCurve(
          to: CGPoint(x: origin.x + curX * scale, y: origin.y + curY * scale),
          control1: CGPoint(x: origin.x + x1 * scale, y: origin.y + y1 * scale),
          control2: CGPoint(x: origin.x + x2 * scale, y: origin.y + y2 * scale)
        )
      case "Z", "z":
        path.closeSubpath()
      default:
        i += 1
      }
    }

    cgContext.saveGState()
    cgContext.setShadow(offset: CGSize(width: 0, height: 2), blur: 6, color: UIColor(white: 0.0, alpha: 0.85).cgColor)
    cgContext.setFillColor(UIColor.white.cgColor)
    cgContext.addPath(path)
    cgContext.fillPath()
    cgContext.restoreGState()
  }
}
