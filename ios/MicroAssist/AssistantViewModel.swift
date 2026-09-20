import Foundation
import WidgetKit

@MainActor
final class AssistantViewModel: ObservableObject {
    @Published var markdown: String
    @Published var lastUpdated: Date?
    @Published var isLoading = false
    @Published var errorMessage: String?

    var sections: [SummarySection] { MarkdownSummary.sections(from: markdown, itemLimit: 10) }

    init() {
        let cached = ActualCache.load()
        markdown = cached?.markdown ?? "# Актуальное\n\nНастройте сервер, чтобы начать."
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
            switch try await AssistantAPI(credentials: credentials).fetchActual(etag: cached?.etag) {
            case .modified(let value, let etag):
                ActualCache.save(markdown: value, etag: etag)
                markdown = value
                lastUpdated = Date()
                WidgetCenter.shared.reloadAllTimelines()
            case .notModified:
                markdown = cached?.markdown ?? markdown
                lastUpdated = cached?.updatedAt
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadCachedValue() {
        guard let cached = ActualCache.load() else { return }
        markdown = cached.markdown
        lastUpdated = cached.updatedAt
    }
}
