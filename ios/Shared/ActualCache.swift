import Foundation

struct CachedActual: Codable, Sendable {
    let markdown: String
    let cards: [AssistantCard]
    let updatedAt: Date
    let etag: String?
    let version: String?
    let isProcessing: Bool
    let activeJobCount: Int

    init(markdown: String, cards: [AssistantCard] = [], updatedAt: Date, etag: String?, version: String? = nil, isProcessing: Bool = false, activeJobCount: Int = 0) {
        self.markdown = markdown
        self.cards = cards
        self.updatedAt = updatedAt
        self.etag = etag
        self.version = version
        self.isProcessing = isProcessing
        self.activeJobCount = activeJobCount
    }

    private enum CodingKeys: String, CodingKey { case markdown, cards, updatedAt, etag, version, isProcessing, activeJobCount }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        markdown = try values.decode(String.self, forKey: .markdown)
        cards = try values.decodeIfPresent([AssistantCard].self, forKey: .cards) ?? []
        updatedAt = try values.decode(Date.self, forKey: .updatedAt)
        etag = try values.decodeIfPresent(String.self, forKey: .etag)
        version = try values.decodeIfPresent(String.self, forKey: .version)
        isProcessing = try values.decodeIfPresent(Bool.self, forKey: .isProcessing) ?? false
        activeJobCount = try values.decodeIfPresent(Int.self, forKey: .activeJobCount) ?? 0
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
    let isProcessing: Bool?
    let activeJobCount: Int?
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
        let value = CachedActual(markdown: snapshot.actualMarkdown, cards: snapshot.cards, updatedAt: Date(), etag: etag, version: snapshot.version, isProcessing: snapshot.isProcessing ?? false, activeJobCount: snapshot.activeJobCount ?? 0)
        save(value)
    }

    static func save(markdown: String, etag: String?) {
        save(CachedActual(markdown: markdown, updatedAt: Date(), etag: etag))
    }

    static func save(_ value: CachedActual) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        if let url = cacheURL(), (try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])) != nil {
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
            version: cached.version,
            isProcessing: cached.isProcessing,
            activeJobCount: cached.activeJobCount
        ))
    }

    private static func cacheURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: SharedConfig.appGroup)?
            .appending(path: filename)
    }
}

enum RefreshDiagnostics {
    static func record(_ key: String, _ message: String) {
        UserDefaults(suiteName: SharedConfig.appGroup)?.set("\(Date().formatted(date: .abbreviated, time: .standard)): \(message)", forKey: "refresh-\(key)")
    }

    static func value(_ key: String) -> String {
        UserDefaults(suiteName: SharedConfig.appGroup)?.string(forKey: "refresh-\(key)") ?? "Нет событий"
    }
}
