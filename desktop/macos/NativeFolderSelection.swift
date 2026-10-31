import Foundation

/// Correlates one directory panel with its initiating form/document. Paths are
/// information only: project admission and filesystem policy stay in Rust.
final class NativeFolderSelection {
    private var pending: UUID?
    private var retired = false

    func begin() -> UUID? {
        guard !retired else { return nil }
        let request = UUID()
        pending = request
        return request
    }

    func cancel(_ request: UUID) {
        if pending == request { pending = nil }
    }

    func complete(_ request: UUID, current: Bool) -> Bool {
        guard !retired, pending == request else { return false }
        pending = nil
        return current
    }

    func retire() { retired = true; pending = nil }

    static func validPath(_ path: String) -> Bool {
        path.hasPrefix("/") && path.utf8.count <= 16_384 &&
            !path.unicodeScalars.contains(where: { $0.value == 0 })
    }
}
