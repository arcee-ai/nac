#if PREVIEW_SMOKE && !LOCAL_APP
import Foundation

/// Inert HTTP classification/accounting for the one disposable offline scenario.
/// No destination, header, credential or prompt is retained in the receipts.
final class OfflineProviderPolicy {
    static let scenario = "offline-api-key"
    static let key = "offline-dummy-local-only"
    static let setupName = "Offline local fixture"
    enum Refusal: Error { case invalid, missingObservation }
    private struct Pending { let label: String; let authority: String; var rejected = 0; var overflow = false }
    private var pending: Pending?
    private var issued = Set<String>()
    private var direct: [String: Int] = [:]
    private(set) var receipts: [[String: Any]] = []
    private(set) var keyAccepted = 0
    private(set) var keyRejected = 0
    private(set) var responseAccepted = 0
    private(set) var unlabelledRejections = 0

    static func selected(_ args: [String] = CommandLine.arguments) -> Bool {
        guard args.filter({ $0 == "--smoke-scenario" }).count == 1,
              let i = args.firstIndex(of: "--smoke-scenario"), i + 1 < args.count else { return false }
        return args[i + 1] == scenario
    }

    static func loopback(_ origin: URL) throws -> URL {
        guard origin.scheme == "http", origin.host == "127.0.0.1", let port = origin.port,
              (1...65535).contains(port), origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil, ["", "/"].contains(origin.path) else {
            throw Refusal.invalid
        }
        return origin
    }

    func canary() throws -> String {
        guard issued.count < 64 else { throw Refusal.invalid }
        let token = UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        issued.insert(token)
        return token
    }

    func directCanary(_ path: String) -> String? {
        let prefix = "/offline-canary/"
        guard path.hasPrefix(prefix) else { return nil }
        let token = String(path.dropFirst(prefix.count))
        guard issued.contains(token) else { return nil }
        direct[token, default: 0] += 1
        return token
    }

    func directCount(_ token: String) -> Int { direct[token, default: 0] }

    func begin(_ label: String, authority: String) throws {
        guard pending == nil, receipts.count < 40, !receipts.contains(where: { $0["control"] as? String == label }),
              !label.isEmpty, label.utf8.count <= 64, authority.utf8.count <= 160 else { throw Refusal.invalid }
        pending = Pending(label: label, authority: authority.lowercased())
    }

    /// Called only after identifying an absolute-form proxy request or CONNECT.
    /// Unknown traffic is denied too, but cannot satisfy the pending control.
    func reject(_ requestLine: String) {
        let parts = requestLine.split(separator: " ")
        var authority: String?
        if parts.count == 3, parts[0] == "CONNECT", parts[2] == "HTTP/1.1" {
            authority = String(parts[1]).lowercased()
        } else if parts.count == 3, let url = URL(string: String(parts[1])),
                  url.scheme.map({ ["http", "https"].contains($0) }) == true, url.user == nil, url.password == nil,
                  let host = url.host {
            authority = host.lowercased() + ":" + String(url.port ?? (url.scheme == "https" ? 443 : 80))
        }
        if let authority, var active = pending, active.authority == authority {
            if active.rejected == 8 { active.overflow = true } else { active.rejected += 1 }
            pending = active
        } else { unlabelledRejections = min(128, unlabelledRejections + 1) }
    }

    static func isProxyRequest(_ line: String) -> Bool {
        let parts = line.split(separator: " ")
        return parts.count == 3 && (parts[0] == "CONNECT" || parts[1].hasPrefix("http://") || parts[1].hasPrefix("https://"))
    }

    func finish(_ label: String, directToken: String? = nil) throws {
        defer { pending = nil }
        guard let active = pending, active.label == label, !active.overflow, (1...8).contains(active.rejected),
              directToken.map({ directCount($0) == 0 }) ?? true else { throw Refusal.missingObservation }
        receipts.append(["control": label, "proxy_rejections": active.rejected, "direct_success": false])
    }

    func authorize(_ headers: String, response: Bool) -> Bool {
        let values = headers.components(separatedBy: "\r\n").dropFirst().compactMap { line -> String? in
            guard let colon = line.firstIndex(of: ":"), line[..<colon].lowercased() == "authorization" else { return nil }
            return line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        guard values == ["Bearer " + Self.key] else { keyRejected += 1; return false }
        keyAccepted += 1
        if response { responseAccepted += 1 }
        return true
    }

    var snapshot: [String: Any] {
        ["controls": receipts, "key_accepted": keyAccepted, "key_rejected": keyRejected,
         "authenticated_responses": responseAccepted, "unlabelled_proxy_rejections": unlabelledRejections]
    }
}
#endif
