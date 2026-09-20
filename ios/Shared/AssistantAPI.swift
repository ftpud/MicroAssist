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

    func fetchSnapshot(etag: String? = nil) async throws -> FetchResult {
        var request = URLRequest(url: endpoint("snapshot"))
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
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
        guard http.statusCode == 200 else { throw serverError(status: http.statusCode, data: data) }
        let snapshot = try JSONDecoder().decode(AssistantSnapshot.self, from: data)
        ActualCache.save(snapshot: snapshot, etag: http.value(forHTTPHeaderField: "ETag"))
        return snapshot
    }

    func dismissCard(id: String) async throws {
        var request = URLRequest(url: endpoint("cards/\(id)/dismiss"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        guard http.statusCode == 204 else { throw serverError(status: http.statusCode, data: data) }
    }

    func registerDevice(token: String) async throws {
        var request = URLRequest(url: endpoint("devices/register"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["token": token])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        guard http.statusCode == 204 else { throw serverError(status: http.statusCode, data: data) }
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
