import AppIntents
import UserNotifications
import WidgetKit

struct SendToAssistantIntent: AppIntent {
    static let title: LocalizedStringResource = "Send to Assistant"
    static let description = IntentDescription("Sends dictated text to your personal assistant.")
    static let openAppWhenRun = false

    @Parameter(title: "Text")
    var text: String

    static var parameterSummary: some ParameterSummary {
        Summary("Send \(\.$text) to Assistant")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .result(dialog: "There is no text to send.")
        }
        guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
        let snapshot = try await AssistantAPI(credentials: credentials).sendPrompt(text)
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        for card in snapshot.cards {
            guard let raw = card.notificationAt,
                  let date = ISO8601DateFormatter().date(from: raw),
                  date > Date() else { continue }
            let content = UNMutableNotificationContent()
            content.title = card.title
            content.body = String(card.bodyMarkdown.prefix(180))
            content.sound = .default
            content.userInfo = ["cardId": card.id]
            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second], from: date
            )
            let request = UNNotificationRequest(
                identifier: "card-\(card.id)",
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            )
            try? await center.add(request)
        }
        WidgetCenter.shared.reloadAllTimelines()
        let response = snapshot.cards.first(where: { $0.kind == "response" })?.title ?? "Sent to your assistant."
        return .result(dialog: IntentDialog(stringLiteral: response))
    }
}

struct MicroAssistShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SendToAssistantIntent(),
            phrases: ["Send to \(.applicationName)"],
            shortTitle: "Send to Assistant",
            systemImageName: "waveform"
        )
    }
}
