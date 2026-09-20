import SwiftUI
import WidgetKit

struct ActualEntry: TimelineEntry {
    let date: Date
    let cached: CachedActual?
}

struct ActualProvider: TimelineProvider {
    func placeholder(in context: Context) -> ActualEntry {
        ActualEntry(date: Date(), cached: CachedActual(markdown: "# Актуальное\n\n## Сегодня\n\n- Купить хлеб", updatedAt: Date(), etag: nil))
    }

    func getSnapshot(in context: Context, completion: @escaping (ActualEntry) -> Void) {
        completion(ActualEntry(date: Date(), cached: ActualCache.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ActualEntry>) -> Void) {
        Task {
            let old = ActualCache.load()
            if let credentials = try? Credentials.load() {
                if case .modified(let markdown, let etag) = try? await AssistantAPI(credentials: credentials).fetchActual(etag: old?.etag) {
                    ActualCache.save(markdown: markdown, etag: etag)
                }
            }
            let entry = ActualEntry(date: Date(), cached: ActualCache.load() ?? old)
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(90 * 60))))
        }
    }
}

struct MicroAssistWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ActualEntry

    var body: some View {
        let sections = MarkdownSummary.sections(from: entry.cached?.markdown ?? "", itemLimit: family == .systemSmall ? 4 : 8)
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("Актуальное").font(.headline)
                Spacer()
                Image(systemName: "sparkles").foregroundStyle(.tint)
            }
            if sections.isEmpty {
                Text("Нет сохранённых данных")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(sections) { section in
                    Text(section.title).font(.caption.bold()).foregroundStyle(.secondary)
                    ForEach(section.items, id: \.self) { item in
                        Text("• \(item)").font(.caption).lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
            if let updated = entry.cached?.updatedAt {
                Text(updated, style: .relative).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct MicroAssistWidget: Widget {
    let kind = "MicroAssistWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ActualProvider()) { entry in
            MicroAssistWidgetView(entry: entry)
        }
        .configurationDisplayName("Актуальное")
        .description("Current tasks from MicroAssist.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
