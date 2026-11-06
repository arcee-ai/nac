import AppKit
import IOKit

/// Second check at consumption, after the external controller's observation.
/// Fixture only: no product authorization or OS settings are changed.
@MainActor
enum AttentionFixtureGuard {
    static func validate(_ command: [String: String], nonce: String, window: NSWindow) throws {
        guard command["control_nonce"] == nonce, command["app_pid"] == String(getpid()) else { throw failed() }
        if command["action"] == "cleanup" { return } // exact-owner stop, never activation/input
        var console = stat()
        let entry = IORegistryGetRootEntry(kIOMainPortDefault)
        guard entry != 0 else { throw failed() }
        defer { IOObjectRelease(entry) }
        let locked = IORegistryEntryCreateCFProperty(entry, "IOConsoleLocked" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
        guard let bit = locked as? NSNumber, CFGetTypeID(bit) == CFBooleanGetTypeID(), !bit.boolValue,
              getuid() > 0, stat("/dev/console", &console) == 0, console.st_uid == getuid(),
              NSApp.isActive, NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
              command["window_number"] == String(window.windowNumber), window.windowNumber > 0,
              let expiry = command["expires"].flatMap(Double.init), expiry.isFinite,
              expiry >= Date().timeIntervalSince1970, expiry <= Date().timeIntervalSince1970 + 2 else { throw failed() }
        // If CGS exposes a lock, it wins over the Root-unlocked fallback.
        if let users = IORegistryEntryCreateCFProperty(entry, "IOConsoleUsers" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [[String: Any]] {
            for row in users {
                if let value = row["CGSSessionScreenIsLocked"] {
                    guard let bit = value as? NSNumber, CFGetTypeID(bit) == CFBooleanGetTypeID(), !bit.boolValue else { throw failed() }
                }
            }
        }
    }
    private static func failed() -> Error { NSError(domain: "NACAttentionFixtureCustody", code: 1) }
}
