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
        updatedAt: ISO8601DateFormatter().string(from: Date())
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
          ZStack {
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
