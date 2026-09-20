import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var serverURL = ""
    @State private var token = ""
    @State private var errorMessage: String?
    let onSave: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("https://assistant.example.com", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("Bearer token", text: $token)
                        .textInputAutocapitalization(.never)
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
                Section {
                    Text("Use HTTPS when connecting over a network. HTTP is intended only for local development.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save) }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        serverURL = (try? KeychainStore.read(account: SharedConfig.serverURLAccount)) ?? ""
        token = (try? KeychainStore.read(account: SharedConfig.tokenAccount)) ?? ""
    }

    private func save() {
        let trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme == "https" || url.scheme == "http", url.host != nil else {
            errorMessage = "Enter a valid HTTP or HTTPS URL."
            return
        }
        guard !token.isEmpty else {
            errorMessage = "Enter the bearer token."
            return
        }
        do {
            try KeychainStore.write(url.absoluteString, account: SharedConfig.serverURLAccount)
            try KeychainStore.write(token, account: SharedConfig.tokenAccount)
            onSave()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
