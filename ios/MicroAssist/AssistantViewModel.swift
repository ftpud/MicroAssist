import Foundation
import SwiftUI
import UserNotifications
import WidgetKit

@MainActor
final class AssistantViewModel: ObservableObject {
    @Published var markdown: String
    @Published var cards: [AssistantCard]
    @Published var lastUpdated: Date?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var isProcessing = false

    var sections: [SummarySection] { MarkdownSummary.sections(from: markdown, itemLimit: 10) }

    init() {
        let cached = ActualCache.load()
        markdown = cached?.markdown ?? "# Актуальное\n\nНастройте сервер, чтобы начать."
        cards = cached?.cards ?? []
        lastUpdated = cached?.updatedAt
    }

    func becameActive() async {
        loadCachedValue()
        await refresh()
    }

    func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
            let cached = ActualCache.load()
            // Foreground refreshes deliberately bypass URLCache and ETag. This repairs
            // stale/corrupt shared caches and makes pull-to-refresh authoritative.
            switch try await AssistantAPI(credentials: credentials).fetchSnapshot(forceRefresh: true) {
            case .modified(let snapshot, let etag):
                ActualCache.save(snapshot: snapshot, etag: etag)
                markdown = snapshot.actualMarkdown
                cards = snapshot.cards
                isProcessing = snapshot.isProcessing ?? false
                lastUpdated = Date()
                await scheduleNotifications(for: snapshot.cards)
                WidgetCenter.shared.reloadAllTimelines()
            case .notModified:
                markdown = cached?.markdown ?? markdown
                cards = cached?.cards ?? cards
                isProcessing = cached?.isProcessing ?? false
                lastUpdated = cached?.updatedAt
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func dismiss(_ card: AssistantCard) async {
        guard card.dismissible else { return }
        let previous = cards
        withAnimation { cards.removeAll { $0.id == card.id } }
        ActualCache.removeCard(id: card.id)
        do {
            guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
            try await AssistantAPI(credentials: credentials).dismissCard(id: card.id)
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["card-\(card.id)"])
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            cards = previous
            errorMessage = error.localizedDescription
            await refresh()
        }
    }

    private func loadCachedValue() {
        guard let cached = ActualCache.load() else { return }
        markdown = cached.markdown
        cards = cached.cards
        isProcessing = cached.isProcessing
        lastUpdated = cached.updatedAt
    }

    private func scheduleNotifications(for cards: [AssistantCard]) async {
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        for card in cards {
            guard let raw = card.notificationAt, let date = ISO8601DateFormatter().date(from: raw), date > Date() else { continue }
            let content = UNMutableNotificationContent()
            content.title = card.title
            content.body = String(card.bodyMarkdown.prefix(180))
            content.sound = .default
            content.userInfo = ["cardId": card.id]
            let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            let request = UNNotificationRequest(identifier: "card-\(card.id)", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
            try? await center.add(request)
        }
    }
}
