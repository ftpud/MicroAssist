import SwiftUI
import UserNotifications
import WidgetKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = AssistantViewModel()
    @State private var showingSettings = false

    var body: some View {
        TabView {
            overview
                .tabItem { Label("Обзор", systemImage: "square.stack.3d.up") }
            ChatView()
                .tabItem { Label("Чат", systemImage: "bubble.left.and.bubble.right") }
            TimersView()
                .tabItem { Label("Таймеры", systemImage: "timer") }
            ActivityView()
                .tabItem { Label("Фон", systemImage: "waveform.path.ecg") }
        }
    }

    private var overview: some View {
        NavigationStack {
            List {
                if model.isProcessing {
                    Section {
                        HStack {
                            ProgressView()
                            Text("Codex обрабатывает запрос в фоне…")
                            Spacer()
                        }
                    }
                }
                if let error = model.errorMessage {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
                if !model.cards.isEmpty {
                    Section {
                        ForEach(model.cards) { card in
                            ReadOnlyCardView(card: card)
                                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .swipeActions(edge: .trailing, allowsFullSwipe: card.dismissible) {
                                    if card.dismissible {
                                        Button("Закрыть", systemImage: "xmark") {
                                            Task { await model.dismiss(card) }
                                        }
                                        .tint(.indigo)
                                    }
                                }
                        }
                    } header: {
                        Text("Сейчас")
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

private struct ChatView: View {
    @State private var messages: [ChatMessage] = []
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(messages) { message in
                                HStack {
                                    if message.role == "user" { Spacer(minLength: 44) }
                                    Text((try? AttributedString(markdown: message.text)) ?? AttributedString(message.text))
                                        .padding(12)
                                        .background(message.role == "user" ? Color.accentColor.opacity(0.22) : Color.secondary.opacity(0.14), in: RoundedRectangle(cornerRadius: 16))
                                    if message.role != "user" { Spacer(minLength: 44) }
                                }
                                .id(message.id)
                            }
                            if sending {
                                HStack { ProgressView(); Text("Codex работает в фоне…"); Spacer() }
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { _, _ in
                        if let id = messages.last?.id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
                    }
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red).padding(.horizontal) }
                HStack(alignment: .bottom) {
                    TextField("Сообщение Codex", text: $text, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...5)
                    Button("Отправить", systemImage: "arrow.up.circle.fill", action: send)
                        .labelStyle(.iconOnly)
                        .font(.title2)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                }
                .padding()
                .background(.bar)
            }
            .navigationTitle("Сессия Codex")
            .toolbar { Button("Обновить", systemImage: "arrow.clockwise") { Task { await reload() } } }
            .task { await reload() }
        }
    }

    private func send() {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        text = ""
        sending = true
        Task {
            do {
                guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
                let api = AssistantAPI(credentials: credentials)
                _ = try await api.sendPrompt(value)
                await reload()
                for _ in 0..<30 {
                    try? await Task.sleep(for: .seconds(2))
                    await reload()
                    let jobs = try? await api.fetchActivity()
                    if jobs?.first?.status == "completed" || jobs?.first?.status == "failed" { break }
                }
                await reload()
                if case .modified(let snapshot, let etag) = try? await api.fetchSnapshot(forceRefresh: true) {
                    ActualCache.save(snapshot: snapshot, etag: etag)
                    WidgetCenter.shared.reloadAllTimelines()
                }
            } catch { self.error = error.localizedDescription }
            sending = false
        }
    }

    private func reload() async {
        do {
            guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
            messages = try await AssistantAPI(credentials: credentials).fetchChat()
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

private struct TimersView: View {
    @State private var cards: [AssistantCard] = []
    @State private var recurring: [RecurringEvent] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                Section("Повторяющиеся") {
                    ForEach(recurring) { event in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(event.prompt).font(.headline)
                            Label(event.cron, systemImage: "repeat")
                                .font(.caption).foregroundStyle(.secondary)
                            Text(event.timezone).font(.caption2).foregroundStyle(.secondary)
                            if let files = event.contextFiles, !files.isEmpty {
                                Text("Контекст: \(files.joined(separator: ", "))")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .swipeActions {
                            Button("Удалить", systemImage: "trash", role: .destructive) {
                                Task { await delete(event) }
                            }
                        }
                    }
                }
                Section("Одноразовые") {
                    ForEach(cards) { card in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(card.title).font(.headline)
                            Text(card.bodyMarkdown)
                            if let raw = card.notificationAt { Label(raw, systemImage: "bell") .font(.caption).foregroundStyle(.secondary) }
                        }
                        .swipeActions {
                            Button("Удалить", systemImage: "trash", role: .destructive) {
                                Task { await delete(card) }
                            }
                        }
                    }
                }
            }
            .overlay { if cards.isEmpty && recurring.isEmpty && error == nil { ContentUnavailableView("Нет таймеров и повторов", systemImage: "timer") } }
            .navigationTitle("Таймеры")
            .refreshable { await reload() }
            .task { await reload() }
        }
    }

    private func reload() async {
        do {
            guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
            async let loadedCards = AssistantAPI(credentials: credentials).fetchReminders()
            async let loadedRecurring = AssistantAPI(credentials: credentials).fetchRecurring()
            (cards, recurring) = try await (loadedCards, loadedRecurring)
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func delete(_ card: AssistantCard) async {
        do {
            guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
            try await AssistantAPI(credentials: credentials).deleteReminder(id: card.id)
            cards.removeAll { $0.id == card.id }
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["card-\(card.id)"])
            WidgetCenter.shared.reloadAllTimelines()
        } catch { self.error = error.localizedDescription }
    }

    private func delete(_ event: RecurringEvent) async {
        do {
            guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
            try await AssistantAPI(credentials: credentials).deleteRecurring(id: event.id)
            recurring.removeAll { $0.id == event.id }
        } catch { self.error = error.localizedDescription }
    }
}

private struct ActivityView: View {
    @State private var jobs: [BackgroundJob] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List(jobs) { job in
                HStack {
                    Image(systemName: icon(job.status)).foregroundStyle(color(job.status))
                    VStack(alignment: .leading) {
                        Text(job.kind == "prompt" ? "Запрос Codex" : job.kind).font(.headline)
                        Text(job.status).font(.caption).foregroundStyle(.secondary)
                        if let error = job.error { Text(error).font(.caption).foregroundStyle(.red) }
                    }
                    Spacer()
                    Text(job.updatedAt).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .overlay { if jobs.isEmpty { ContentUnavailableView("Нет фоновых операций", systemImage: "waveform.path.ecg") } }
            .navigationTitle("Фоновая работа")
            .refreshable { await reload() }
            .task {
                while !Task.isCancelled {
                    await reload()
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
    }

    private func reload() async {
        do {
            guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
            jobs = try await AssistantAPI(credentials: credentials).fetchActivity()
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func icon(_ status: String) -> String {
        switch status { case "completed": return "checkmark.circle.fill"; case "failed": return "xmark.circle.fill"; default: return "clock.arrow.circlepath" }
    }
    private func color(_ status: String) -> Color {
        switch status { case "completed": return .green; case "failed": return .red; default: return .orange }
    }
}

private struct ReadOnlyCardView: View {
    @Environment(\.colorScheme) private var colorScheme
    let card: AssistantCard

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.title)
                    .font(.title2.bold())
                Spacer()
                if let kaomoji = card.kaomoji {
                    Text(kaomoji)
                        .font(.title3)
                        .accessibilityHidden(true)
                }
            }
            Text(attributedBody)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 12)
            if card.dismissible {
                Label("Смахните влево, чтобы закрыть", systemImage: "hand.draw")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 240, alignment: .topLeading)
        .padding(20)
        .background(cardColor.gradient, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.primary.opacity(colorScheme == .dark ? 0.12 : 0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.2 : 0.08), radius: 14, y: 7)
    }

    private var attributedBody: AttributedString {
        (try? AttributedString(markdown: card.bodyMarkdown)) ?? AttributedString(card.bodyMarkdown)
    }

    private var cardColor: Color {
        switch card.kind {
        case "reminder": return .orange.opacity(colorScheme == .dark ? 0.28 : 0.18)
        case "morning": return .yellow.opacity(colorScheme == .dark ? 0.24 : 0.17)
        case "evening": return .indigo.opacity(colorScheme == .dark ? 0.30 : 0.16)
        case "response": return .blue.opacity(colorScheme == .dark ? 0.28 : 0.14)
        default: return .secondary.opacity(colorScheme == .dark ? 0.20 : 0.10)
        }
    }
}
