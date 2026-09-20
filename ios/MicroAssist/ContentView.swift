import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = AssistantViewModel()
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            List {
                if let error = model.errorMessage {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
                if !model.cards.isEmpty {
                    Section("Сейчас") {
                        ForEach(model.cards) { card in
                            ReadOnlyCardView(card: card)
                                .swipeActions(edge: .trailing, allowsFullSwipe: card.dismissible) {
                                    if card.dismissible {
                                        Button("Закрыть", systemImage: "xmark") {
                                            Task { await model.dismiss(card) }
                                        }
                                        .tint(.indigo)
                                    }
                                }
                        }
                    }
                }
                ForEach(model.sections) { section in
                    Section(section.title) {
                        ForEach(section.items, id: \.self) { item in
                            Label(item, systemImage: "circle")
                        }
                    }
                }
                if let date = model.lastUpdated {
                    Section {
                        Text("Updated \(date.formatted(date: .abbreviated, time: .shortened))")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .overlay {
                if model.sections.isEmpty && !model.isLoading {
                    ContentUnavailableView("Nothing current", systemImage: "checkmark.circle")
                }
            }
            .navigationTitle("MicroAssist")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Settings", systemImage: "gear") { showingSettings = true }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                        .disabled(model.isLoading)
                }
            }
            .refreshable { await model.refresh() }
            .task { await model.becameActive() }
            .onChange(of: scenePhase) { _, newPhase in
                guard newPhase == .active else { return }
                Task { await model.becameActive() }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView { Task { await model.refresh() } }
            }
        }
    }
}

private struct ReadOnlyCardView: View {
    let card: AssistantCard

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.title).font(.headline)
                Spacer()
                if let kaomoji = card.kaomoji { Text(kaomoji).accessibilityHidden(true) }
            }
            Text(attributedBody)
                .font(.body)
                .textSelection(.enabled)
            if card.dismissible {
                Text("Смахните влево, чтобы закрыть")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
    }

    private var attributedBody: AttributedString {
        (try? AttributedString(markdown: card.bodyMarkdown)) ?? AttributedString(card.bodyMarkdown)
    }
}
