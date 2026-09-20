import SwiftUI
import UIKit
import UserNotifications

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
        [.banner, .sound]
    }
}
