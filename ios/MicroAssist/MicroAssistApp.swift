import SwiftUI
import UIKit
import UserNotifications
import WidgetKit

@main
struct MicroAssistApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task {
            if (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) == true {
                await MainActor.run { application.registerForRemoteNotifications() }
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        try? KeychainStore.write(token, account: SharedConfig.deviceTokenAccount)
        Task {
            guard let credentials = try? Credentials.load() else { return }
            try? await AssistantAPI(credentials: credentials).registerDevice(token: token)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        _ = await refreshFromNotification()
        return [.banner, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        _ = await refreshFromNotification()
    }

    private func refreshFromNotification() async -> UIBackgroundFetchResult {
        RefreshDiagnostics.record("push", "Получено уведомление")
        do {
            guard let credentials = try Credentials.load() else { throw AssistantAPIError.notConfigured }
            if case .modified(let snapshot, let etag) = try await AssistantAPI(credentials: credentials).fetchSnapshot(forceRefresh: true, timeout: 15) {
                ActualCache.save(snapshot: snapshot, etag: etag)
                RefreshDiagnostics.record("fetch", "Сохранён \(snapshot.version.prefix(12)), карточек: \(snapshot.cards.count); reload запрошен")
                WidgetCenter.shared.reloadAllTimelines()
                return .newData
            }
            return .noData
        } catch {
            RefreshDiagnostics.record("fetch", "Ошибка: \(error.localizedDescription)")
            return .failed
        }
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        Task {
            completionHandler(await refreshFromNotification())
        }
    }
}
