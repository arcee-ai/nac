import Foundation

/// A presentation read model, with no delivery or execution effects. nil pending
/// means the current decision projection is unknown, never a resolution.
enum NativeAttentionIndicator {
    static func badge(enabled: Bool, unread: UInt64, pending: Int?) -> String? {
        guard enabled else { return nil }
        guard let pending, pending >= 0 else {
            if unread == 0 { return "?" }
            return unread > 99 ? "99+?" : "\(unread)+?"
        }
        let (count, overflow) = unread.addingReportingOverflow(UInt64(pending))
        return overflow || count > 99 ? "99+" : count == 0 ? nil : String(count)
    }
}
