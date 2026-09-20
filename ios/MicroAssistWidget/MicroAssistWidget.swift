import AppIntents
import SwiftUI
import WidgetKit

struct DismissCardIntent: AppIntent {
    static let title: LocalizedStringResource = "Закрыть карточку"
    static let openAppWhenRun = false

    @Parameter(title: "Card ID") var cardID: String

    init() { cardID = "" }
    init(cardID: String) { self.cardID = cardID }

    func perform() async throws -> some IntentResult {
        guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
        try await AssistantAPI(credentials: credentials).dismissCard(id: cardID)
        ActualCache.removeCard(id: cardID)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

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
                if case .modified(let snapshot, let etag) = try? await AssistantAPI(credentials: credentials).fetchSnapshot(forceRefresh: true) {
                    ActualCache.save(snapshot: snapshot, etag: etag)
                }
            }
            let entry = ActualEntry(date: Date(), cached: ActualCache.load() ?? old)
            // WidgetKit may defer refreshes, so APNs remains the primary trigger.
            // This shorter timeline is a safety net when a background push is throttled.
            let interval: TimeInterval = entry.cached?.isProcessing == true ? 60 : 15 * 60
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(interval))))
        }
    }
}

struct MicroAssistWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ActualEntry

    var body: some View {
        let sections = MarkdownSummary.sections(from: entry.cached?.markdown ?? "", itemLimit: itemLimit)
        VStack(alignment: .leading, spacing: sectionSpacing) {
            HStack {
                Text("Актуальное").font(isFullPage ? .title2.bold() : .headline)
                Spacer()
                if entry.cached?.isProcessing == true {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Codex обрабатывает запрос")
                }
                Image(systemName: "sparkles").foregroundStyle(.tint)
            }
            if let cards = entry.cached?.cards, !cards.isEmpty {
                WidgetCardStack(cards: Array(cards.prefix(cardLimit)), fullPage: isFullPage)
                    .frame(height: cardStackHeight)
                if family != .systemSmall {
                    Divider()
                    actualContent(sections)
                }
            } else if sections.isEmpty {
                Text("Нет сохранённых данных")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                actualContent(sections)
            }
            Spacer(minLength: 0)
            if let updated = entry.cached?.updatedAt {
                Text(updated, style: .relative).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder
    private func actualContent(_ sections: [SummarySection]) -> some View {
        ForEach(sections) { section in
            Text(section.title)
                .font(isFullPage ? .headline : .caption.bold())
                .foregroundStyle(.secondary)
            ForEach(section.items, id: \.self) { item in
                Text("• \(item)")
                    .font(isFullPage ? .body : .caption)
                    .lineLimit(isFullPage || family == .systemLarge ? 2 : 1)
            }
        }
    }

    private var isFullPage: Bool {
        if #available(iOSApplicationExtension 27.0, *) {
            return family == .systemExtraLargePortrait
        }
        return false
    }

    private var itemLimit: Int {
        if isFullPage { return 24 }
        switch family {
        case .systemSmall: return 4
        case .systemMedium: return 8
        case .systemLarge: return 14
        default: return 8
        }
    }

    private var cardLimit: Int {
        if isFullPage { return 4 }
        switch family {
        case .systemSmall: return 3
        case .systemLarge: return 4
        default: return 3
        }
    }

    private var cardStackHeight: CGFloat {
        if isFullPage { return 300 }
        switch family {
        case .systemSmall: return 105
        case .systemMedium: return 68
        case .systemLarge: return 155
        default: return 90
        }
    }

    private var sectionSpacing: CGFloat {
        isFullPage ? 10 : 5
    }
}

private struct WidgetCardStack: View {
    let cards: [AssistantCard]
    let fullPage: Bool

    var body: some View {
        ZStack(alignment: .top) {
            ForEach(Array(cards.enumerated().reversed()), id: \.element.id) { index, card in
                WidgetCardView(card: card, fullPage: fullPage, interactive: index == 0)
                    .scaleEffect(1 - CGFloat(index) * 0.025, anchor: .top)
                    .offset(y: CGFloat(index) * (fullPage ? 12 : 7))
                    .zIndex(Double(cards.count - index))
                    .allowsHitTesting(index == 0)
            }
        }
        .padding(.bottom, CGFloat(max(0, cards.count - 1)) * (fullPage ? 12 : 7))
    }
}

private struct WidgetCardView: View {
    let card: AssistantCard
    let fullPage: Bool
    let interactive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(card.title).font(fullPage ? .title3.bold() : .caption.bold())
                Spacer()
                if let kaomoji = card.kaomoji { Text(kaomoji).accessibilityHidden(true) }
                if interactive && card.dismissible {
                    Button(intent: DismissCardIntent(cardID: card.id)) {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Закрыть карточку")
                }
            }
            Text(attributedBody)
                .font(fullPage ? .body : .caption)
                .lineLimit(fullPage ? 10 : 4)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(fullPage ? 14 : 8)
        .background(cardColor, in: RoundedRectangle(cornerRadius: fullPage ? 20 : 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: fullPage ? 20 : 14, style: .continuous)
                .stroke(.white.opacity(0.22), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.12), radius: 5, y: 3)
    }

    private var attributedBody: AttributedString {
        (try? AttributedString(markdown: card.bodyMarkdown)) ?? AttributedString(card.bodyMarkdown)
    }

    private var cardColor: Color {
        switch card.kind {
        case "reminder": return Color(red: 1.00, green: 0.78, blue: 0.34)
        case "morning": return Color(red: 1.00, green: 0.90, blue: 0.46)
        case "evening": return Color(red: 0.63, green: 0.58, blue: 0.92)
        case "response": return Color(red: 0.55, green: 0.78, blue: 1.00)
        default: return Color(red: 0.62, green: 0.88, blue: 0.76)
        }
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
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@available(iOSApplicationExtension 27.0, *)
struct MicroAssistFullPageWidget: Widget {
    let kind = "MicroAssistFullPageWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ActualProvider()) { entry in
            MicroAssistWidgetView(entry: entry)
        }
        .configurationDisplayName("Актуальное — весь экран")
        .description("Full-page overview of your current tasks.")
        .supportedFamilies([.systemExtraLargePortrait])
    }
}
