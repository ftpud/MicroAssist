import Foundation
import WidgetKit

@MainActor
final class AssistantViewModel: ObservableObject {
    @Published var markdown = ActualCache.load()?.markdown ?? "# Актуальное\n\nНастройте сервер, чтобы начать."
    @Published var lastUpdated = ActualCache.load()?.updatedAt
    @Published var isLoading = false
    @Published var errorMessage: String?

    var sections: [SummarySection] { MarkdownSummary.sections(from: markdown) }

    func refresh() async {
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
}
