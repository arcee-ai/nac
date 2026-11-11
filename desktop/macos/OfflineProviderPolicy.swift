#if PREVIEW_SMOKE && !LOCAL_APP
import Foundation

/// Inert HTTP classification/accounting for the one disposable offline scenario.
/// No destination, header, credential or prompt is retained in the receipts.
final class OfflineProviderPolicy {
    static let scenario = "offline-api-key"
    static let key = "offline-dummy-local-only"
    static let setupName = "Offline local fixture"
    enum Refusal: Error { case invalid, missingObservation }
    enum Request {
        case http(method: String, path: String)
        case httpsConnect
        var receipt: String {
            switch self {
            case .http: return "http-absolute-or-connect"
            case .httpsConnect: return "https-connect"
            }
        }
    }
    private struct Pending { let label: String; let authority: String; let request: Request; var rejected = 0; var overflow = false }
    private var usedAuthorities = Set<String>()
    private(set) var retired = false
    private(set) var directRequests = 0
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
        guard !retired, issued.count < 64 else { throw Refusal.invalid }
        let token = UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        issued.insert(token)
        return token
    }

    func retire() { retired = true }
    func noteDirectRequest() { directRequests += 1 }

    func directCanary(_ path: String) -> String? {
        guard !retired else { return nil }
        let prefix = "/offline-canary/"
        guard path.hasPrefix(prefix) else { return nil }
        let token = String(path.dropFirst(prefix.count))
        guard issued.contains(token) else { return nil }
        direct[token, default: 0] += 1
        return token
    }

    func directCount(_ token: String) -> Int { direct[token, default: 0] }

    func begin(_ label: String, authority: String, request: Request) throws {
        let authority = authority.lowercased()
        guard !retired, pending == nil, usedAuthorities.count < 40,
              !usedAuthorities.contains(authority), !receipts.contains(where: { $0["control"] as? String == label }),
              !label.isEmpty, label.utf8.count <= 64, !authority.isEmpty, authority.utf8.count <= 160 else { throw Refusal.invalid }
        // Never reuse a control authority, including after failure. In particular
        // HTTP CONNECT hides paths, so its target must have a new owned port.
        usedAuthorities.insert(authority)
        pending = Pending(label: label, authority: authority, request: request)
    }

    /// Reject every proxy request, but credit only the current unique authority
    /// and required request class. No destination/header is exported in receipts.
    func reject(_ requestLine: String) {
        let parts = requestLine.split(separator: " ")
        var matched = false
        if !retired, let active = pending, parts.count == 3, parts[2] == "HTTP/1.1" {
            if parts[0] == "CONNECT" {
                matched = String(parts[1]).lowercased() == active.authority
            } else if case let .http(method, path) = active.request,
                      parts[0] == Substring(method), let url = URL(string: String(parts[1])),
                      url.scheme == "http", url.user == nil, url.password == nil,
                      url.query == nil, url.fragment == nil, let host = url.host {
                matched = host.lowercased() + ":" + String(url.port ?? 80) == active.authority && url.path == path
            }
        }
        if matched, var active = pending {
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
        guard !retired, let active = pending, active.label == label, !active.overflow, (1...8).contains(active.rejected),
              directToken.map({ directCount($0) == 0 }) ?? true else { throw Refusal.missingObservation }
        receipts.append(["control": label, "proxy_rejections": active.rejected,
                         "request_class": active.request.receipt, "authority_fresh": true, "direct_success": false])
    }

    func authorize(_ headers: String, response: Bool) -> Bool {
        let values = headers.components(separatedBy: "\r\n").dropFirst().compactMap { line -> String? in
            guard let colon = line.firstIndex(of: ":"), line[..<colon].lowercased() == "authorization" else { return nil }
            return line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        guard !retired, values == ["Bearer " + Self.key] else { keyRejected += 1; return false }
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
