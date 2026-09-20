import Foundation

struct CachedActual: Codable, Sendable {
    let markdown: String
    let updatedAt: Date
    let etag: String?
}

enum ActualCache {
    private static let key = "cached-actual-v1"

    static func load() -> CachedActual? {
        guard
            let defaults = UserDefaults(suiteName: SharedConfig.appGroup),
            let data = defaults.data(forKey: key)
        else { return nil }
        return try? JSONDecoder().decode(CachedActual.self, from: data)
    }

    static func save(markdown: String, etag: String?) {
        let value = CachedActual(markdown: markdown, updatedAt: Date(), etag: etag)
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults(suiteName: SharedConfig.appGroup)?.set(data, forKey: key)
    }
}
