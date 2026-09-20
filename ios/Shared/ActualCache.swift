import Foundation

struct CachedActual: Codable, Sendable {
    let markdown: String
    let cards: [AssistantCard]
    let updatedAt: Date
    let etag: String?
    let version: String?

    init(markdown: String, cards: [AssistantCard] = [], updatedAt: Date, etag: String?, version: String? = nil) {
        self.markdown = markdown
        self.cards = cards
        self.updatedAt = updatedAt
        self.etag = etag
        self.version = version
    }

    private enum CodingKeys: String, CodingKey { case markdown, cards, updatedAt, etag, version }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        markdown = try values.decode(String.self, forKey: .markdown)
        cards = try values.decodeIfPresent([AssistantCard].self, forKey: .cards) ?? []
        updatedAt = try values.decode(Date.self, forKey: .updatedAt)
        etag = try values.decodeIfPresent(String.self, forKey: .etag)
        version = try values.decodeIfPresent(String.self, forKey: .version)
    }
}

struct AssistantCard: Codable, Identifiable, Sendable, Equatable {
    let id: String
    let kind: String
    let title: String
    let bodyMarkdown: String
    let priority: Int
    let createdAt: String
    let visibleFrom: String?
    let visibleUntil: String?
    let notificationAt: String?
    let dismissible: Bool
    let kaomoji: String?
    let source: String
}

struct AssistantSnapshot: Codable, Sendable {
    let schemaVersion: Int
    let version: String
    let generatedAt: String
    let timezone: String
    let actualMarkdown: String
    let cards: [AssistantCard]
}

enum ActualCache {
    private static let filename = "actual-cache-v1.json"
    private static let legacyKey = "cached-actual-v1"

    static func load() -> CachedActual? {
        if let url = cacheURL(),
           let data = try? Data(contentsOf: url),
           let value = try? JSONDecoder().decode(CachedActual.self, from: data) {
            return value
        }

        // Migrate caches written by the first version of the app.
        guard let data = UserDefaults(suiteName: SharedConfig.appGroup)?.data(forKey: legacyKey) else {
            return nil
        }
        return try? JSONDecoder().decode(CachedActual.self, from: data)
    }

    static func save(snapshot: AssistantSnapshot, etag: String?) {
        let value = CachedActual(markdown: snapshot.actualMarkdown, cards: snapshot.cards, updatedAt: Date(), etag: etag, version: snapshot.version)
        save(value)
    }

    static func save(markdown: String, etag: String?) {
        save(CachedActual(markdown: markdown, updatedAt: Date(), etag: etag))
    }

    static func save(_ value: CachedActual) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        if let url = cacheURL(), (try? data.write(to: url, options: .atomic)) != nil {
            UserDefaults(suiteName: SharedConfig.appGroup)?.removeObject(forKey: legacyKey)
        } else {
            // Keeps previews and unsigned simulator builds functional.
            UserDefaults(suiteName: SharedConfig.appGroup)?.set(data, forKey: legacyKey)
        }
    }

    static func removeCard(id: String) {
        guard let cached = load() else { return }
        save(CachedActual(
            markdown: cached.markdown,
            cards: cached.cards.filter { $0.id != id },
            updatedAt: cached.updatedAt,
            etag: nil,
            version: cached.version
        ))
    }

    private static func cacheURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: SharedConfig.appGroup)?
            .appending(path: filename)
    }
}
