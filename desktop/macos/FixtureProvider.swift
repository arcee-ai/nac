import Foundation
import Network

/// A bounded, loopback-only Responses fixture, built into the development app.
/// It has no model credentials and never executes a requested tool.
final class FixtureProvider {
    static let partial = "Hello from the isolated"
    static let answer = "Hello from the isolated NAC Mac preview."
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]
    private(set) var responseCount = 0
    #if PREVIEW_SMOKE
    var offline: OfflineProviderPolicy?
    private var offlineRetiredConnections: [NWConnection]?
    var holdResponses = false
    private(set) var heldResponseCount = 0
    private var heldResponses: [() -> Void] = []
    func releaseResponses() {
        holdResponses = false
        let completions = heldResponses
        heldResponses.removeAll()
        completions.forEach { $0() }
    }
    // Main-queue fixture observation only; never retains a proxy destination.
    private(set) var rejectedConnectCount = 0
    #endif
    private var startContinuation: CheckedContinuation<Void, Error>?
    var baseURL: URL!

    func start() async throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.startContinuation = continuation
            listener.stateUpdateHandler = { [weak self] state in
                guard let self, let continuation = self.startContinuation else { return }
                switch state {
                case .ready:
                    self.startContinuation = nil
                    guard let port = listener.port else {
                        continuation.resume(throwing: PreviewError.message("Fixture has no loopback port"))
                        return
                    }
                    self.baseURL = URL(string: "http://127.0.0.1:\(port.rawValue)")!
                    continuation.resume()
                case .failed(let error): self.startContinuation = nil; continuation.resume(throwing: error)
                case .cancelled: self.startContinuation = nil; continuation.resume(throwing: CancellationError())
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { connection.cancel(); return }
                #if PREVIEW_SMOKE
                if self.offline?.retired == true { connection.cancel(); return }
                #endif
                let id = UUID()
                self.connections[id] = connection
                connection.stateUpdateHandler = { [weak self] state in
                    if case .cancelled = state { self?.connections.removeValue(forKey: id) }
                    if case .failed = state {
                        connection.cancel()
                        self?.connections.removeValue(forKey: id)
                    }
                }
                connection.start(queue: .main)
                self.receive(connection, accumulated: Data())
            }
            listener.start(queue: .main)
        }
    }

    func stop() {
        #if PREVIEW_SMOKE
        if offline?.retired == true, offlineRetiredConnections == nil {
            offlineRetiredConnections = Array(connections.values)
        }
        #endif
        listener?.cancel()
        for connection in connections.values { connection.cancel() }
        connections.removeAll()
        #if PREVIEW_SMOKE
        heldResponses.removeAll()
        #endif
    }

    #if PREVIEW_SMOKE
    /// Only the separately owned offline target uses this observation. A new
    /// target is forbidden until exact listener/connection cancellation settles.
    @MainActor func awaitOfflineControlStop(deadline: TimeInterval) async throws {
        guard offline?.retired == true else { throw OfflineProviderPolicy.Refusal.invalid }
        while true {
            let listenerStopped: Bool
            if let listener { if case .cancelled = listener.state { listenerStopped = true } else { listenerStopped = false } }
            else { listenerStopped = true }
            let connectionsStopped = (offlineRetiredConnections ?? []).allSatisfy {
                if case .cancelled = $0.state { return true }; return false
            }
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            guard remaining > 0 else { throw OfflineProviderPolicy.Refusal.missingObservation }
            if listenerStopped && connectionsStopped {
                listener = nil
                offlineRetiredConnections = nil
                return
            }
            try await Task.sleep(nanoseconds: UInt64(min(0.02, remaining) * 1_000_000_000))
        }
    }
    #endif

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, error in
            guard let self else { return }
            let bytes = accumulated + (data ?? Data())
            guard bytes.count <= 2_000_000, error == nil else { connection.cancel(); return }
            if let boundary = bytes.range(of: Data("\r\n\r\n".utf8)) {
                let headers = String(decoding: bytes[..<boundary.lowerBound], as: UTF8.self)
                let size = headers.components(separatedBy: "\r\n").first {
                    $0.lowercased().hasPrefix("content-length:")
                }.flatMap { Int($0.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) } ?? 0
                guard size >= 0, size <= 2_000_000 else { connection.cancel(); return }
                if bytes.count - boundary.upperBound >= size {
                    self.respond(connection, headers: headers,
                                 body: Data(bytes[boundary.upperBound...]))
                    return
                }
            }
            if done { connection.cancel() }
            else { self.receive(connection, accumulated: bytes) }
        }
    }

    private func respond(_ connection: NWConnection, headers: String, body: Data) {
        let route = headers.components(separatedBy: "\r\n")[0]
        #if PREVIEW_SMOKE
        if let offline {
            guard !offline.retired else { connection.cancel(); return }
            if OfflineProviderPolicy.isProxyRequest(route) {
                offline.reject(route)
                send(connection, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", final: true)
                return
            }
            offline.noteDirectRequest()
            let path = route.split(separator: " ").dropFirst().first.map(String.init) ?? ""
            if route.hasPrefix("GET "), let nonce = offline.directCanary(path) {
                let json = encode(["nonce": nonce])
                send(connection, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(json.utf8.count)\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n\(json)", final: true)
                return
            }
            if route == "GET /models HTTP/1.1" || route == "POST /responses HTTP/1.1" {
                guard offline.authorize(headers, response: route.hasPrefix("POST ")) else {
                    send(connection, "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", final: true)
                    return
                }
                if route.hasPrefix("GET ") {
                    let json = encode(["object": "list", "data": [["id": "gpt-5.6-sol", "object": "model", "owned_by": "fixture"]]])
                    send(connection, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(json.utf8.count)\r\nConnection: close\r\n\r\n\(json)", final: true)
                    return
                }
            }
        }
        #endif
        if route.hasPrefix("GET /models-dev") {
            send(connection, "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n", final: true)
            return
        }
        guard route == "POST /responses HTTP/1.1",
              let request = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              request["model"] as? String == "gpt-5.6-sol" else {
            #if PREVIEW_SMOKE
            if route.hasPrefix("CONNECT ") { rejectedConnectCount = min(32, rejectedConnectCount + 1) }
            #endif
            send(connection, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", final: true)
            return
        }
        responseCount += 1
        let item: [String: Any] = ["id": "msg-preview", "type": "message", "status": "completed",
            "role": "assistant", "content": [["type": "output_text", "text": Self.answer, "annotations": []]]]
        let response: [String: Any] = ["id": "resp-preview", "object": "response", "status": "completed",
            "model": "gpt-5.6-sol", "output": [item],
            "usage": ["input_tokens": 7, "output_tokens": 9, "total_tokens": 16]]
        guard request["stream"] as? Bool == true else {
            let json = encode(response)
            send(connection, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(json.utf8.count)\r\nConnection: close\r\n\r\n\(json)", final: true)
            return
        }
        send(connection, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n" +
             event(["type": "response.output_text.delta", "delta": Self.partial]))
        // Deliberately separate transport frames so the real UI can observe streaming.
        let finish = { [weak self] in
            guard let self else { return }
            self.send(connection, self.event(["type": "response.output_text.delta",
                "delta": " NAC Mac preview."]) +
                self.event(["type": "response.output_item.done", "output_index": 0, "item": item]) +
                self.event(["type": "response.completed", "response": response]), final: true)
        }
        #if PREVIEW_SMOKE
        if holdResponses {
            heldResponseCount += 1
            heldResponses.append(finish)
            return
        }
        #endif
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: finish)
    }

    private func encode(_ object: [String: Any]) -> String {
        String(decoding: try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }
    private func event(_ object: [String: Any]) -> String { "data: \(encode(object))\n\n" }
    private func send(_ connection: NWConnection, _ text: String, final: Bool = false) {
        connection.send(content: Data(text.utf8), completion: .contentProcessed { error in
            if final || error != nil { connection.cancel() }
        })
    }
}
