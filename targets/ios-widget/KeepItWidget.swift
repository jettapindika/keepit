import SwiftUI
import UIKit
import WidgetKit

// MARK: - Shared Snapshot Model

struct KeepItWidgetSnapshot: Codable {
  let coupleId: String
  let partnerName: String
  let statusEmoji: String?
  let statusText: String?
  let statusExpiresAt: String?
  let momentPhotoUri: String?
  let momentFrontPhotoUri: String?
  let momentCaption: String?
  let momentPostedAt: String?
  let momentLocked: Bool
  let streakCount: Int
  let deepLinkUrl: String
  let updatedAt: String
  let locationLabel: String?
  let musicTitle: String?
}

struct KeepItWidgetEntry: TimelineEntry {
  let date: Date
  let snapshot: KeepItWidgetSnapshot?
  let momentImage: UIImage?

  var deepLinkUrl: String {
    guard let snapshot = snapshot else {
      return "keepit://"
    }
    if snapshot.momentLocked {
      return "keepit://camera"
    }
    return snapshot.deepLinkUrl.isEmpty ? "keepit://" : snapshot.deepLinkUrl
  }
}

// MARK: - Mochy-Music Obsidian Palette

private enum MochyWidgetTheme {
  static let canvas = Color(red: 0, green: 0, blue: 0) // #000000
  static let surface = Color(red: 20.0 / 255.0, green: 20.0 / 255.0, blue: 22.0 / 255.0) // #141416
  static let surfaceElevated = Color(red: 30.0 / 255.0, green: 30.0 / 255.0, blue: 33.0 / 255.0) // #1E1E21
  static let border = Color(red: 35.0 / 255.0, green: 35.0 / 255.0, blue: 38.0 / 255.0) // #232326
  static let ink = Color.white // #FFFFFF
  static let inkMuted = Color(red: 154.0 / 255.0, green: 154.0 / 255.0, blue: 160.0 / 255.0) // #9A9AA0
  static let accent = Color(red: 224.0 / 255.0, green: 224.0 / 255.0, blue: 224.0 / 255.0) // #E0E0E0
  static let accentSoft = Color(red: 40.0 / 255.0, green: 40.0 / 255.0, blue: 48.0 / 255.0) // #282830
  static let success = Color(red: 52.0 / 255.0, green: 199.0 / 255.0, blue: 89.0 / 255.0) // #34C759
}

// MARK: - Timeline Provider

struct KeepItTimelineProvider: TimelineProvider {
  private static let appGroupSuite = "group.com.keepit.shared"
  private static let snapshotKey = "widget_snapshot"

  func placeholder(in context: Context) -> KeepItWidgetEntry {
    KeepItWidgetEntry(
      date: Date(),
      snapshot: KeepItWidgetSnapshot(
        coupleId: "preview",
        partnerName: "Your partner",
        statusEmoji: "☕",
        statusText: "Coffee run",
        statusExpiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600)),
        momentPhotoUri: nil,
        momentFrontPhotoUri: nil,
        momentCaption: "Morning walk before work",
        momentPostedAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-720)),
        momentLocked: false,
        streakCount: 7,
        deepLinkUrl: "keepit://",
        updatedAt: ISO8601DateFormatter().string(from: Date()),
        locationLabel: "Blue Bottle Coffee",
        musicTitle: "Sunset Lover"
      ),
      momentImage: nil
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (KeepItWidgetEntry) -> Void) {
    if context.isPreview && loadSnapshot() == nil {
      completion(placeholder(in: context))
      return
    }
    let snapshot = loadSnapshot()
    let image = loadLocalOrCachedImage(from: snapshot)
    completion(KeepItWidgetEntry(date: Date(), snapshot: snapshot, momentImage: image))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<KeepItWidgetEntry>) -> Void) {
    let now = Date()
    let snapshot = loadSnapshot()
    let image = loadLocalOrCachedImage(from: snapshot)

    // Schedule periodic timeline ticks over the next hour so relative "12m ago" stays fresh
    var entries: [KeepItWidgetEntry] = []
    for minuteOffset in stride(from: 0, through: 45, by: 15) {
      if let entryDate = Calendar.current.date(byAdding: .minute, value: minuteOffset, to: now) {
        entries.append(KeepItWidgetEntry(date: entryDate, snapshot: snapshot, momentImage: image))
      }
    }

    let refreshAfter = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now.addingTimeInterval(1800)
    completion(Timeline(entries: entries, policy: .after(refreshAfter)))
  }

  private func loadSnapshot() -> KeepItWidgetSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: Self.appGroupSuite),
      let json = defaults.string(forKey: Self.snapshotKey),
      let data = json.data(using: .utf8)
    else {
      return nil
    }
    return try? JSONDecoder().decode(KeepItWidgetSnapshot.self, from: data)
  }

  private func loadLocalOrCachedImage(from snapshot: KeepItWidgetSnapshot?) -> UIImage? {
    guard
      let snapshot = snapshot,
      !snapshot.momentLocked,
      let uriString = snapshot.momentPhotoUri
    else {
      return nil
    }

    if uriString.hasPrefix("data:image/"),
       let commaIndex = uriString.firstIndex(of: ",") {
      let base64Part = String(uriString[uriString.index(after: commaIndex)...])
      if let decoded = Data(base64Encoded: base64Part, options: .ignoreUnknownCharacters) {
        return UIImage(data: decoded)
      }
    }

    guard let url = URL(string: uriString) else {
      return nil
    }

    if url.isFileURL, let data = try? Data(contentsOf: url) {
      return UIImage(data: data)
    }

    if (url.scheme == "http" || url.scheme == "https"),
       let data = try? Data(contentsOf: url) {
      return UIImage(data: data)
    }

    return nil
  }
}

// MARK: - Formatting Helpers

private enum KeepItWidgetFormatters {
  private static let isoWithFractional: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let isoStandard = ISO8601DateFormatter()

  static func parseDate(_ iso: String?) -> Date? {
    guard let iso = iso, !iso.isEmpty else { return nil }
    return isoWithFractional.date(from: iso) ?? isoStandard.date(from: iso)
  }

  static func timeAgoLabel(since iso: String?, now: Date) -> String {
    guard let postedDate = parseDate(iso) else {
      return "Waiting"
    }
    let elapsed = max(0, Int(now.timeIntervalSince(postedDate)))
    if elapsed < 60 {
      return "Just now"
    }
    let minutes = elapsed / 60
    if minutes < 60 {
      return "\(minutes)m ago"
    }
    let hours = minutes / 60
    if hours < 24 {
      return "\(hours)h ago"
    }
    let days = hours / 24
    return "\(days)d ago"
  }

  private static let watermarkDateFormatter: DateFormatter = {
    let df = DateFormatter()
    df.dateFormat = "MMM d · hh:mm a"
    return df
  }()

  static func watermarkTimestampLabel(for iso: String?, fallback: Date) -> String {
    let date = parseDate(iso) ?? fallback
    return watermarkDateFormatter.string(from: date)
  }

  static func activeStatusLine(snapshot: KeepItWidgetSnapshot, now: Date) -> (emoji: String?, text: String)? {
    guard let text = snapshot.statusText, !text.isEmpty else {
      return nil
    }
    if let expiresDate = parseDate(snapshot.statusExpiresAt), expiresDate <= now {
      return nil
    }
    return (snapshot.statusEmoji, text)
  }
}

// MARK: - Entry View

struct KeepItWidgetEntryView: View {
  var entry: KeepItTimelineProvider.Entry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    Group {
      switch family {
      case .systemMedium:
        MediumWidgetLayout(entry: entry)
      default:
        SmallWidgetLayout(entry: entry)
      }
    }
    .widgetURL(URL(string: entry.deepLinkUrl))
  }
}

// MARK: - Small 2x2 Layout

private struct SmallWidgetLayout: View {
  let entry: KeepItWidgetEntry

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      MochyWidgetTheme.canvas

      if let snapshot = entry.snapshot {
        if snapshot.momentLocked {
          LockedPhotoBackdrop(compact: true)
        } else if let uiImage = entry.momentImage {
          Image(uiImage: uiImage)
            .resizable()
            .scaledToFill()
            .overlay(
              LinearGradient(
                colors: [Color.black.opacity(0.18), Color.black.opacity(0.84)],
                startPoint: .top,
                endPoint: .bottom
              )
            )
        } else {
          AmbientSurfaceBackdrop()
        }

        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 6) {
            Text(snapshot.partnerName)
              .font(.system(size: 12, weight: .bold))
              .tracking(-0.3)
              .foregroundColor(MochyWidgetTheme.ink)
              .lineLimit(1)

            Spacer(minLength: 4)

            Text(
              KeepItWidgetFormatters.timeAgoLabel(
                since: snapshot.momentPostedAt ?? snapshot.updatedAt,
                now: entry.date
              )
            )
            .font(.system(size: 10, weight: .semibold))
            .monospacedDigit()
            .foregroundColor(MochyWidgetTheme.inkMuted)
          }

          Spacer()

          if snapshot.momentLocked {
            VStack(alignment: .leading, spacing: 3) {
              Text("Moment locked")
                .font(.system(size: 13, weight: .bold))
                .tracking(-0.35)
                .foregroundColor(MochyWidgetTheme.ink)
              Text("Post yours to reveal")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(MochyWidgetTheme.inkMuted)
                .lineLimit(1)
            }
          } else if let status = KeepItWidgetFormatters.activeStatusLine(snapshot: snapshot, now: entry.date) {
            HStack(spacing: 5) {
              Circle()
                .fill(MochyWidgetTheme.success)
                .frame(width: 6, height: 6)
              Text([status.emoji, status.text].compactMap { $0 }.joined(separator: " "))
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(MochyWidgetTheme.ink)
                .lineLimit(1)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(MochyWidgetTheme.surface.opacity(0.92))
            .clipShape(Capsule())
          } else if let caption = snapshot.momentCaption, !caption.isEmpty {
            Text(caption)
              .font(.system(size: 11, weight: .semibold))
              .foregroundColor(MochyWidgetTheme.ink)
              .lineLimit(2)
          } else {
            Text("No active status")
              .font(.system(size: 11, weight: .medium))
              .foregroundColor(MochyWidgetTheme.inkMuted)
          }

          KeepItWatermarkBadge(
            width: 46,
            timestamp: KeepItWidgetFormatters.watermarkTimestampLabel(
              for: snapshot.momentPostedAt ?? snapshot.updatedAt,
              fallback: entry.date
            )
          )
        }
        .padding(12)
      } else {
        UnpairedPlaceholder(compact: true)
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
  }
}

// MARK: - Medium 4x2 Layout

private struct MediumWidgetLayout: View {
  let entry: KeepItWidgetEntry

  var body: some View {
    ZStack {
      MochyWidgetTheme.canvas

      if let snapshot = entry.snapshot {
        HStack(spacing: 12) {
          // Left squircle Moment tile
          ZStack(alignment: .bottomLeading) {
            MochyWidgetTheme.surface

            if snapshot.momentLocked {
              LockedPhotoBackdrop(compact: false)
            } else if let uiImage = entry.momentImage {
              Image(uiImage: uiImage)
                .resizable()
                .scaledToFill()
            } else {
              VStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                  .stroke(MochyWidgetTheme.border, lineWidth: 1.5)
                  .frame(width: 26, height: 32)
                Text("No Moment")
                  .font(.system(size: 10, weight: .semibold))
                  .foregroundColor(MochyWidgetTheme.inkMuted)
              }
            }

            if !snapshot.momentLocked {
              KeepItWatermarkBadge(
                width: 40,
                timestamp: KeepItWidgetFormatters.watermarkTimestampLabel(
                  for: snapshot.momentPostedAt ?? snapshot.updatedAt,
                  fallback: entry.date
                )
              )
              .padding(6)
            }
          }
          .frame(width: 112)
          .frame(maxHeight: .infinity)
          .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
          .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
              .stroke(MochyWidgetTheme.border, lineWidth: 1)
          )

          // Right metadata column
          VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 6) {
              Text(snapshot.partnerName)
                .font(.system(size: 15, weight: .bold))
                .tracking(-0.4)
                .foregroundColor(MochyWidgetTheme.ink)
                .lineLimit(1)

              Spacer(minLength: 4)

              if snapshot.streakCount > 0 {
                Text("\(snapshot.streakCount)d")
                  .font(.system(size: 10, weight: .bold))
                  .monospacedDigit()
                  .foregroundColor(MochyWidgetTheme.accent)
                  .padding(.horizontal, 7)
                  .padding(.vertical, 3)
                  .background(MochyWidgetTheme.accentSoft)
                  .clipShape(Capsule())
              }
            }

            if let status = KeepItWidgetFormatters.activeStatusLine(snapshot: snapshot, now: entry.date) {
              HStack(spacing: 6) {
                Circle()
                  .fill(MochyWidgetTheme.success)
                  .frame(width: 6, height: 6)
                Text([status.emoji, status.text].compactMap { $0 }.joined(separator: " "))
                  .font(.system(size: 12, weight: .semibold))
                  .foregroundColor(MochyWidgetTheme.ink)
                  .lineLimit(1)
              }
              .padding(.horizontal, 9)
              .padding(.vertical, 5)
              .background(MochyWidgetTheme.surface)
              .clipShape(Capsule())
            } else {
              Text("No active status")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(MochyWidgetTheme.inkMuted)
            }

            Spacer(minLength: 2)

            if snapshot.momentLocked {
              Text("Post your Moment to unlock \(snapshot.partnerName)'s photo.")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(MochyWidgetTheme.inkMuted)
                .lineLimit(2)
            } else if let caption = snapshot.momentCaption, !caption.isEmpty {
              Text(caption)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(MochyWidgetTheme.ink)
                .lineLimit(2)
            } else if snapshot.momentPostedAt != nil {
              Text("Captured today's Moment.")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(MochyWidgetTheme.inkMuted)
            } else {
              Text("Waiting for today's daily window.")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(MochyWidgetTheme.inkMuted)
            }

            HStack(spacing: 4) {
              Text(
                KeepItWidgetFormatters.timeAgoLabel(
                  since: snapshot.momentPostedAt ?? snapshot.updatedAt,
                  now: entry.date
                )
              )
              .font(.system(size: 10, weight: .semibold))
              .monospacedDigit()
              .foregroundColor(MochyWidgetTheme.inkMuted)

              Text("·")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(MochyWidgetTheme.inkMuted)

              Text(snapshot.momentLocked ? "Tap to capture" : "Tap to open")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(MochyWidgetTheme.accent)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
      } else {
        UnpairedPlaceholder(compact: false)
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
  }
}

// MARK: - Subviews

private struct KeepItWatermarkShape: Shape {
  private static let pathD = "M4.20738 8.50945L7.35848 0.233129H9.53048L6.36738 8.50945H4.20738ZM0.829146 6.86584L1.50226 5.09401H8.49826L7.82515 6.86584H0.829146ZM1.00338 8.50945L4.15448 0.233129H6.32648L3.16338 8.50945H1.00338ZM2.02195 3.75348L2.69506 1.98165H9.67906L9.00595 3.75348H2.02195ZM8.91241 8.50945L10.9355 0.233129H13.2635L12.2776 4.26638L14.6991 2.21478H17.4111L14.2939 4.75596L15.9204 8.50945H13.4484L12.5096 5.96827L11.6963 6.64436L11.2404 8.50945H8.91241ZM19.2418 8.64933C18.5458 8.64933 17.9711 8.51334 17.5175 8.24134C17.064 7.96935 16.7531 7.58856 16.5848 7.09898C16.4184 6.60162 16.4159 6.02267 16.5773 5.36212C16.7388 4.70157 17.0234 4.1265 17.4311 3.63691C17.8387 3.14733 18.3358 2.76654 18.9223 2.49455C19.5107 2.21478 20.1529 2.0749 20.8489 2.0749C21.5449 2.0749 22.1097 2.21867 22.5435 2.5062C22.9871 2.78597 23.2812 3.18618 23.426 3.70685C23.5707 4.22752 23.5566 4.84145 23.3838 5.54863L23.2869 5.94496H18.8349C18.7578 6.32574 18.7965 6.60939 18.9509 6.7959C19.1152 6.97464 19.3573 7.06401 19.6773 7.06401C19.9093 7.06401 20.1158 7.02127 20.2967 6.93578C20.4856 6.8503 20.6426 6.69876 20.7678 6.48117L23.0433 6.59774C22.702 7.27383 22.1927 7.78673 21.5152 8.13643C20.8396 8.47837 20.0818 8.64933 19.2418 8.64933ZM19.1312 4.73265H21.2552C21.3365 4.3674 21.3039 4.09153 21.1575 3.90502C21.013 3.71074 20.7848 3.6136 20.4728 3.6136C20.1768 3.6136 19.9041 3.71462 19.6547 3.91668C19.4133 4.11873 19.2388 4.39072 19.1312 4.73265ZM26.7418 8.64933C26.0458 8.64933 25.4711 8.51334 25.0175 8.24134C24.564 7.96935 24.2531 7.58856 24.0848 7.09898C23.9184 6.60162 23.9159 6.02267 24.0773 5.36212C24.2388 4.70157 24.5234 4.1265 24.9311 3.63691C25.3387 3.14733 25.8358 2.76654 26.4223 2.49455C27.0107 2.21478 27.6529 2.0749 28.3489 2.0749C29.0449 2.0749 29.6097 2.21867 30.0435 2.5062C30.4871 2.78597 30.7812 3.18618 30.926 3.70685C31.0707 4.22752 31.0566 4.84145 30.8838 5.54863L30.7869 5.94496H26.3349C26.2578 6.32574 26.2965 6.60939 26.4509 6.7959C26.6152 6.97464 26.8573 7.06401 27.1773 7.06401C27.4093 7.06401 27.6158 7.02127 27.7967 6.93578C27.9856 6.8503 28.1426 6.69876 28.2678 6.48117L30.5433 6.59774C30.202 7.27383 29.6927 7.78673 29.0152 8.13643C28.3396 8.47837 27.5818 8.64933 26.7418 8.64933ZM26.6312 4.73265H28.7552C28.8365 4.3674 28.8039 4.09153 28.6575 3.90502C28.513 3.71074 28.2848 3.6136 27.9728 3.6136C27.6768 3.6136 27.4041 3.71462 27.1547 3.91668C26.9133 4.11873 26.7388 4.39072 26.6312 4.73265ZM30.6686 10.258L32.6347 2.21478H34.9027L34.6287 3.532L34.487 3.47372C34.7571 3.02299 35.0977 2.67717 35.5086 2.43626C35.9194 2.19536 36.3649 2.0749 36.8449 2.0749C37.4209 2.0749 37.8747 2.21478 38.2063 2.49455C38.5379 2.77431 38.7469 3.16287 38.8334 3.66023C38.9217 4.14981 38.887 4.71711 38.7293 5.36212C38.5736 5.99936 38.3269 6.56665 37.9893 7.06401C37.6598 7.56136 37.2568 7.94992 36.7804 8.22969C36.312 8.50945 35.7898 8.64933 35.2138 8.64933C34.9098 8.64933 34.6391 8.59493 34.4017 8.48614C34.1662 8.36957 33.9741 8.20637 33.8254 7.99655C33.6847 7.78673 33.6015 7.53805 33.5757 7.25052L33.7431 7.20389L32.9966 10.258H30.6686ZM34.8539 7.02904C35.1899 7.02904 35.49 6.88139 35.7542 6.58608C36.0202 6.283 36.216 5.87502 36.3413 5.36212C36.4667 4.84922 36.4695 4.44512 36.3497 4.14981C36.2318 3.84673 36.0048 3.6952 35.6688 3.6952C35.4448 3.6952 35.2376 3.75737 35.0472 3.8817C34.8568 4.00604 34.6872 4.19255 34.5385 4.44123C34.3977 4.68991 34.2826 4.99687 34.1933 5.36212C34.1041 5.72736 34.069 6.03432 34.0882 6.283C34.1155 6.53168 34.1939 6.71819 34.3235 6.84253C34.4531 6.96687 34.6299 7.02904 34.8539 7.02904ZM38.9007 8.50945L40.4394 2.21478H42.7674L41.2287 8.50945H38.9007ZM40.5573 1.58532L40.9448 -6.10651e-06H43.3448L42.9573 1.58532H40.5573ZM45.2031 8.50945C44.4751 8.50945 43.983 8.34625 43.7268 8.01987C43.4725 7.6857 43.4337 7.15726 43.6103 6.43454L45.0037 0.734371H47.3317L46.0181 6.10815C45.9421 6.419 45.9539 6.63271 46.0534 6.74927C46.1628 6.85807 46.3535 6.91247 46.6255 6.91247H47.5135L47.1231 8.50945H45.2031ZM43.1475 3.81176L43.5378 2.21478H48.6618L48.2715 3.81176H43.1475Z"

  func path(in rect: CGRect) -> Path {
    var p = Path()
    guard let regex = try? NSRegularExpression(pattern: "[A-Za-z]|[-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?") else { return p }
    let nsStr = Self.pathD as NSString
    let matches = regex.matches(in: Self.pathD, range: NSRange(location: 0, length: nsStr.length))
    let tokens = matches.map { nsStr.substring(with: $0.range) }

    let sx = rect.width / 50.0
    let sy = rect.height / 11.0
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
        p.move(to: CGPoint(x: rect.minX + curX * sx, y: rect.minY + curY * sy))
      case "L":
        curX = nextFloat()
        curY = nextFloat()
        p.addLine(to: CGPoint(x: rect.minX + curX * sx, y: rect.minY + curY * sy))
      case "H":
        curX = nextFloat()
        p.addLine(to: CGPoint(x: rect.minX + curX * sx, y: rect.minY + curY * sy))
      case "V":
        curY = nextFloat()
        p.addLine(to: CGPoint(x: rect.minX + curX * sx, y: rect.minY + curY * sy))
      case "C":
        let x1 = nextFloat()
        let y1 = nextFloat()
        let x2 = nextFloat()
        let y2 = nextFloat()
        curX = nextFloat()
        curY = nextFloat()
        p.addCurve(
          to: CGPoint(x: rect.minX + curX * sx, y: rect.minY + curY * sy),
          control1: CGPoint(x: rect.minX + x1 * sx, y: rect.minY + y1 * sy),
          control2: CGPoint(x: rect.minX + x2 * sx, y: rect.minY + y2 * sy)
        )
      case "Z", "z":
        p.closeSubpath()
      default:
        i += 1
      }
    }
    return p
  }
}

private struct KeepItWatermarkBadge: View {
  let width: CGFloat
  let timestamp: String

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      KeepItWatermarkShape()
        .fill(MochyWidgetTheme.ink)
        .frame(width: width, height: width * (11.0 / 50.0))
      Text(timestamp)
        .font(.system(size: 8.5, weight: .bold))
        .monospacedDigit()
        .foregroundColor(MochyWidgetTheme.ink.opacity(0.92))
        .lineLimit(1)
    }
    .padding(.horizontal, 6.5)
    .padding(.vertical, 4.5)
    .background(Color.black.opacity(0.76))
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
  }
}

private struct LockedPhotoBackdrop: View {
  let compact: Bool

  var body: some View {
    ZStack {
      MochyWidgetTheme.surface
      RoundedRectangle(cornerRadius: compact ? 8 : 10, style: .continuous)
        .fill(MochyWidgetTheme.accentSoft)
        .overlay(
          RoundedRectangle(cornerRadius: compact ? 8 : 10, style: .continuous)
            .stroke(MochyWidgetTheme.accent.opacity(0.6), lineWidth: 1)
        )
        .frame(width: compact ? 28 : 34, height: compact ? 36 : 44)
    }
  }
}

private struct AmbientSurfaceBackdrop: View {
  var body: some View {
    LinearGradient(
      colors: [MochyWidgetTheme.surfaceElevated, MochyWidgetTheme.canvas],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }
}

private struct UnpairedPlaceholder: View {
  let compact: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("KeepIt")
        .font(.system(size: compact ? 14 : 16, weight: .bold))
        .tracking(-0.4)
        .foregroundColor(MochyWidgetTheme.ink)
      Text("Open KeepIt to pair with your partner and sync Moments here.")
        .font(.system(size: 11, weight: .medium))
        .foregroundColor(MochyWidgetTheme.inkMuted)
        .lineLimit(compact ? 3 : 2)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(14)
    .background(MochyWidgetTheme.surface)
  }
}

// MARK: - Widget Bundle Definition

@main
struct KeepItWidget: Widget {
  let kind: String = "KeepItWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: KeepItTimelineProvider()) { entry in
      if #available(iOS 17.0, *) {
        KeepItWidgetEntryView(entry: entry)
          .containerBackground(MochyWidgetTheme.canvas, for: .widget)
      } else {
        KeepItWidgetEntryView(entry: entry)
      }
    }
    .configurationDisplayName("Partner Moment & Status")
    .description("Shows your partner's latest daily Moment and live status on your Home Screen.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
