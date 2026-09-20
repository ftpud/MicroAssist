import AppIntents
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
        _ = try await AssistantAPI(credentials: credentials).sendPrompt(text)
        WidgetCenter.shared.reloadAllTimelines()
        return .result(dialog: "Sent to your assistant.")
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
