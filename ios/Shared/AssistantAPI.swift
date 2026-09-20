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
        case modified(markdown: String, etag: String?)
        case notModified
    }

    let credentials: Credentials

    func fetchActual(etag: String? = nil) async throws -> FetchResult {
        var request = URLRequest(url: endpoint("actual.md"))
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssistantAPIError.invalidResponse }
        if http.statusCode == 304 { return .notModified }
        guard http.statusCode == 200 else { throw serverError(status: http.statusCode, data: data) }
        guard let markdown = String(data: data, encoding: .utf8) else { throw AssistantAPIError.invalidResponse }
        return .modified(markdown: markdown, etag: http.value(forHTTPHeaderField: "ETag"))
    }

    func sendPrompt(_ text: String) async throws -> String {
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
        guard let markdown = String(data: data, encoding: .utf8) else { throw AssistantAPIError.invalidResponse }
        ActualCache.save(markdown: markdown, etag: http.value(forHTTPHeaderField: "ETag"))
        return markdown
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
