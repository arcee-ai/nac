import Foundation
import UserNotifications

@MainActor
final class NativeNotificationCenter: NSObject, NativeAttentionDelivery, UNUserNotificationCenterDelegate {
    private let center: UNUserNotificationCenter
    var response: ((NativeAttentionDestination) -> Void)?
    {
        didSet {
            if let response, let pendingResponse {
                self.pendingResponse = nil
                response(pendingResponse)
            }
        }
    }
    private var pendingResponse: NativeAttentionDestination?
    var shouldPresent: ((NativeAttentionDestination) -> Bool)?
    private var mutation: UInt64 = 0
    private var retired = false
    private var deliveryGeneration: UInt64 = 0
    private var pendingAdds: Set<String> = []
    private var cancelledAdds: Set<String> = []

    init(center: UNUserNotificationCenter = .current()) {
        self.center = center
        super.init()
        center.delegate = self
    }
    func settings(_ completion: @escaping (NativeNotificationAuthorization) -> Void) {
        center.getNotificationSettings { value in
            let status = value.authorizationStatus
            DispatchQueue.main.async { completion(.init(allowed: status == .authorized || status == .provisional, mayRequest: status == .notDetermined)) }
        }
    }
    func authorize(_ completion: @escaping (Bool) -> Void) {
        center.requestAuthorization(options: [.alert, .badge, .sound]) { accepted, error in
            DispatchQueue.main.async { completion(accepted && error == nil) }
        }
    }
    func add(_ destination: NativeAttentionDestination, title: NativeAttentionTitle, completion: @escaping (Bool) -> Void) {
        guard !retired, mutation < UInt64.max, !pendingAdds.contains(destination.identifier) else { completion(false); return }
        mutation += 1
        let generation = deliveryGeneration
        pendingAdds.insert(destination.identifier)
        let content = UNMutableNotificationContent()
        content.title = title.rawValue
        content.body = "Open NAC to view current state."
        content.userInfo = destination.userInfo
        // Default system delivery honors denial and Focus. No critical/time-
        // sensitive entitlement or separate Focus-status permission is requested.
        center.add(UNNotificationRequest(identifier: destination.identifier, content: content, trigger: nil)) { [self] error in
            DispatchQueue.main.async {
                self.pendingAdds.remove(destination.identifier)
                let cancelled = self.cancelledAdds.remove(destination.identifier) != nil
                guard !self.retired, generation == self.deliveryGeneration, !cancelled else {
                    self.center.removePendingNotificationRequests(withIdentifiers: [destination.identifier])
                    self.center.removeDeliveredNotifications(withIdentifiers: [destination.identifier])
                    completion(false); return
                }
                completion(error == nil)
            }
        }
    }
    func present(_ destination: NativeAttentionDestination, completion: @escaping (Bool) -> Void) {
        center.getPendingNotificationRequests { [weak self] pending in
            DispatchQueue.main.async {
                guard let self else { completion(false); return }
                self.center.getDeliveredNotifications { delivered in
                    let found = pending.contains { $0.identifier == destination.identifier } ||
                        delivered.contains { $0.request.identifier == destination.identifier }
                    DispatchQueue.main.async { completion(found) }
                }
            }
        }
    }
    func withdraw(_ identifiers: [String]) {
        cancelledAdds.formUnion(pendingAdds.intersection(identifiers))
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
    func withdrawProfile(_ profile: String) {
        guard !retired, mutation < UInt64.max else { return }
        mutation += 1
        guard deliveryGeneration < UInt64.max else { retired = true; return }
        deliveryGeneration += 1
        let expected = mutation
        center.getPendingNotificationRequests { [weak self] requests in
            let ids = requests.filter { $0.identifier.hasPrefix("nac-attention-") && $0.content.userInfo["profile"] as? String == profile }.map(\.identifier)
            DispatchQueue.main.async {
                guard let self, !self.retired, self.mutation == expected else { return }
                self.center.removePendingNotificationRequests(withIdentifiers: ids)
            }
        }
        center.getDeliveredNotifications { [weak self] requests in
            let ids = requests.map(\.request).filter { $0.identifier.hasPrefix("nac-attention-") && $0.content.userInfo["profile"] as? String == profile }.map(\.identifier)
            DispatchQueue.main.async {
                guard let self, !self.retired, self.mutation == expected else { return }
                self.center.removeDeliveredNotifications(withIdentifiers: ids)
            }
        }
    }
    func retire() {
        retired = true
        cancelledAdds.formUnion(pendingAdds)
        response = nil
        shouldPresent = nil
        pendingResponse = nil
        if center.delegate === self { center.delegate = nil }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                           withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let request = notification.request
        let target = NativeAttentionDestination(userInfo: request.content.userInfo, identifier: request.identifier)
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.retired, let target, self.shouldPresent?(target) == true else {
                completionHandler([]); return
            }
            // AppKit can stay active with its last workspace closed. The
            // coordinator rechecks actual window focus/mute/opt-out here.
            // Standard presentation still belongs to system authorization/Focus.
            completionHandler([.banner, .list, .sound])
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                           withCompletionHandler completionHandler: @escaping () -> Void) {
        let request = response.notification.request
        let target = NativeAttentionDestination(userInfo: request.content.userInfo, identifier: request.identifier)
        let isDefault = response.actionIdentifier == UNNotificationDefaultActionIdentifier
        DispatchQueue.main.async { [weak self] in
            defer { completionHandler() }
            guard isDefault, let target else { return }
            if let handler = self?.response { handler(target) }
            else { self?.pendingResponse = target } // one bounded cold-launch response
        }
    }
}
