import AppKit

@MainActor
final class NativeAttentionMenu: NSObject, NSMenuItemValidation {
    struct Actions {
        let enable: () -> Void
        let mute: () -> Void
        let permission: () -> Void
        let clear: () -> Void
        let reset: () -> Void
    }
    private let actions: Actions
    private let root = NSMenuItem(title: "Notifications", action: nil, keyEquivalent: "")
    private let enabled = NSMenuItem(title: "Enable notifications", action: nil, keyEquivalent: "")
    private let muted = NSMenuItem(title: "Mute notifications", action: nil, keyEquivalent: "")
    private let permission = NSMenuItem(title: "Request system permission…", action: nil, keyEquivalent: "")
    private let clear = NSMenuItem(title: "Clear completion indicator", action: nil, keyEquivalent: "")
    private let reset = NSMenuItem(title: "Reset notification settings", action: nil, keyEquivalent: "")
    private let status = NSMenuItem(title: "Loading saved settings…", action: nil, keyEquivalent: "")
    private weak var parent: NSMenu?

    init(actions: Actions) {
        self.actions = actions
        super.init()
        let menu = NSMenu(title: "Notifications")
        for (item, selector) in [(enabled, #selector(toggleEnabled)), (muted, #selector(toggleMuted)),
                                  (permission, #selector(requestPermission)), (clear, #selector(clearIndicator)),
                                  (reset, #selector(resetSettings))] {
            item.target = self; item.action = selector; menu.addItem(item)
        }
        menu.addItem(.separator()); status.isEnabled = false; menu.addItem(status)
        root.submenu = menu
    }
    func install(in menu: NSMenu?) {
        guard let menu, parent !== menu else { return }
        parent?.removeItem(root)
        parent = menu
        menu.insertItem(root, at: min(3, menu.items.count))
    }
    func render(saved: WorkspaceNotificationState, loaded: Bool, saving: Bool, paused: Bool,
                mayRequest: Bool, message: String) {
        enabled.state = saved.enabled ? .on : .off
        enabled.isEnabled = loaded && !saving
        muted.state = saved.muted ? .on : .off
        muted.isEnabled = loaded && saved.enabled && !saving && !paused
        permission.isEnabled = loaded && saved.enabled && !saving && !paused && mayRequest
        clear.isEnabled = loaded && saved.enabled && !saving && !paused && (saved.unreadCompletions > 0 || saved.deliveryUncertain)
        reset.isEnabled = loaded && !saving
        status.title = message
    }
    func validateMenuItem(_ item: NSMenuItem) -> Bool { item.isEnabled }
    @objc private func toggleEnabled() { actions.enable() }
    @objc private func toggleMuted() { actions.mute() }
    @objc private func requestPermission() { actions.permission() }
    @objc private func clearIndicator() { actions.clear() }
    @objc private func resetSettings() { actions.reset() }
}
