import Foundation

enum AssistantAPIError: LocalizedError {
    case invalidResponse
    case server(Int, String)
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "The server returned an invalid response."
        case .server(let status, let message): return "Server error \(status): \(message)"
        case .notConfigured: return "Open MicroAssist and configure the server first."
        }
    }
}

struct AssistantAPI: Sendable {
    enum FetchResult: Sendable {
        case modified(snapshot: AssistantSnapshot, etag: String?)
        case notModified
    }

    let credentials: Credentials

    func fetchSnapshot(etag: String? = nil, forceRefresh: Bool = false, timeout: TimeInterval = 30) async throws -> FetchResult {
        var request = URLRequest(
            url: endpoint("snapshot"),
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: timeout
        )
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if let etag, !forceRefresh { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        if http.statusCode == 304 { return .notModified }
        guard http.statusCode == 200 else { throw serverError(status: http.statusCode, data: data) }
        let snapshot = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
        return .modified(snapshot: snapshot, etag: http.value(forHTTPHeaderField: "ETag"))
    }

    func sendPrompt(_ text: String) async throws -> AssistantSnapshot {
        var request = URLRequest(url: endpoint("prompt"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "text": text,
            "now": formatter.string(from: Date()),
            "timezone": TimeZone.current.identifier,
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        if http.statusCode == 204, let cached = ActualCache.load() {
            return AssistantSnapshot(
                schemaVersion: 1,
                version: cached.version ?? "cached",
                generatedAt: ISO8601DateFormatter().string(from: cached.updatedAt),
                timezone: TimeZone.current.identifier,
                actualMarkdown: cached.markdown,
                cards: cached.cards,
                isProcessing: true,
                activeJobCount: 1
            )
        }
        guard (200...299).contains(http.statusCode) else {
            throw serverError(status: http.statusCode, data: data)
        }
        let snapshot = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
        ActualCache.save(snapshot: snapshot, etag: http.value(forHTTPHeaderField: "ETag"))
        return snapshot
    }

    func sendPromptAndWait(_ text: String) async throws -> BlockingPromptResponse {
        var request = URLRequest(url: endpoint("prompt/blocking"), timeoutInterval: 245)
        request.httpMethod = "POST"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "text": text,
            "now": formatter.string(from: Date()),
            "timezone": TimeZone.current.identifier,
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        guard http.statusCode == 200 || http.statusCode == 202 else {
            throw serverError(status: http.statusCode, data: data)
        }
        let result = try JSONDecoder().decode(BlockingPromptResponse.self, from: data)
        ActualCache.save(snapshot: result.snapshot, etag: nil)
        return result
    }

    func dismissCard(id: String) async throws {
        var request = URLRequest(url: endpoint("cards/\(id)/dismiss"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        guard (200...299).contains(http.statusCode) else { throw serverError(status: http.statusCode, data: data) }
    }

    func registerDevice(token: String) async throws {
        var request = URLRequest(url: endpoint("devices/register"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        request.httpBody = try JSONEncoder().encode(["token": token, "environment": environment])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        guard (200...299).contains(http.statusCode) else { throw serverError(status: http.statusCode, data: data) }
    }

    func fetchChat() async throws -> [ChatMessage] {
        let data = try await get("chat")
        return try JSONDecoder().decode(ChatResponse.self, from: data).messages
    }

    func fetchActivity() async throws -> [BackgroundJob] {
        let data = try await get("activity")
        return try JSONDecoder().decode(ActivityResponse.self, from: data).jobs
    }

    func fetchReminders() async throws -> [AssistantCard] {
        let data = try await get("reminders")
        return try JSONDecoder().decode(ReminderResponse.self, from: data).reminders
    }

    func deleteReminder(id: String) async throws {
        try await delete("reminders/\(id)")
    }

    func fetchRecurring() async throws -> [RecurringEvent] {
        let data = try await get("recurring")
        return try JSONDecoder().decode(RecurringResponse.self, from: data).events
    }

    func deleteRecurring(id: String) async throws {
        try await delete("recurring/\(id)")
    }

    private func delete(_ path: String) async throws {
        var request = URLRequest(url: endpoint(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        guard http.statusCode == 204 else { throw serverError(status: http.statusCode, data: data) }
    }

    private func get(_ path: String) async throws -> Data {
        var request = URLRequest(url: endpoint(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        guard http.statusCode == 200 else { throw serverError(status: http.statusCode, data: data) }
        return data
    }

    private func endpoint(_ path: String) -> URL {
        credentials.serverURL.appending(path: path)
    }

    private func serverError(status: Int, data: Data) -> AssistantAPIError {
        let message = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"]
            ?? String(data: data, encoding: .utf8)
            ?? "Unknown error"
        return .server(status, message)
    }
}

struct ChatMessage: Codable, Identifiable, Sendable {
    let id: String
    let role: String
    let text: String
    let createdAt: String
}

private struct ChatResponse: Codable { let messages: [ChatMessage] }

struct BackgroundJob: Codable, Identifiable, Sendable {
    let id: String
    let kind: String
    let status: String
    let createdAt: String
    let updatedAt: String
    let error: String?
}

private struct ActivityResponse: Codable { let jobs: [BackgroundJob] }
private struct ReminderResponse: Codable { let reminders: [AssistantCard] }
private struct RecurringResponse: Codable { let events: [RecurringEvent] }

struct RecurringEvent: Codable, Identifiable, Sendable {
    let id: String
    let cron: String
    let timezone: String
    let prompt: String
    let enabled: Bool
    let contextFiles: [String]?
}

struct BlockingPromptResponse: Codable, Sendable {
    let completed: Bool
    let answer: String?
    let snapshot: AssistantSnapshot
}
