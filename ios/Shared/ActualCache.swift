import Foundation

struct CachedActual: Codable, Sendable {
    let markdown: String
    let updatedAt: Date
    let etag: String?
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

    static func save(markdown: String, etag: String?) {
        let value = CachedActual(markdown: markdown, updatedAt: Date(), etag: etag)
        guard let data = try? JSONEncoder().encode(value) else { return }
        if let url = cacheURL(), (try? data.write(to: url, options: .atomic)) != nil {
            UserDefaults(suiteName: SharedConfig.appGroup)?.removeObject(forKey: legacyKey)
        } else {
            // Keeps previews and unsigned simulator builds functional.
            UserDefaults(suiteName: SharedConfig.appGroup)?.set(data, forKey: legacyKey)
        }
    }

    private static func cacheURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: SharedConfig.appGroup)?
            .appending(path: filename)
    }
}
