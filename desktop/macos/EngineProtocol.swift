import Foundation

struct EngineIdentity: Codable, Equatable {
    let product_version: String
    let build_id: String
    let source_revision: String
    let track: String
}

struct EngineReceipt: Decodable {
    let kind: String
    let version: Int
    let incarnation: String
    let endpoint: String?
    let identity: EngineIdentity?
    let store: String?
    let schema: Int?
    let stage: String?
    let code: String?
    let message: String?
}

/// One parser belongs to one launch. Diagnostic output is never protocol input.
final class EngineProtocol {
    static let limit = 16 * 1024
    // Launch identity is distinct from the server's NativeRuntimeScope and
    // any future WebView document identity.
    let incarnation = UUID().uuidString
    let identity: EngineIdentity
    let store: String
    private var pending = Data()
    private(set) var ready: EngineReceipt?

    init(identity: EngineIdentity, store: URL) {
        self.identity = identity
        self.store = store.deletingLastPathComponent().resolvingSymlinksInPath()
            .appendingPathComponent(store.lastPathComponent).path
    }

    func hello() throws -> Data {
        try record(["kind": "hello", "version": 1, "incarnation": incarnation,
                    "identity": JSONSerialization.jsonObject(with: JSONEncoder().encode(identity)), "store": store])
    }

    func stop() throws -> Data {
        try record(["kind": "stop", "version": 1, "incarnation": incarnation])
    }

    private func record(_ object: [String: Any]) throws -> Data {
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        data.append(10)
        guard data.count <= Self.limit else { throw invalid() }
        return data
    }

    func receive(_ data: Data) throws -> URL? {
        var endpoint: URL?
        // Enforce the bound before appending, including an unterminated record.
        for byte in data {
            guard pending.count < Self.limit else { throw invalid() }
            pending.append(byte)
            if byte != 10 { continue }
            let receipt: EngineReceipt
            do { receipt = try JSONDecoder().decode(EngineReceipt.self, from: pending) }
            catch { throw invalid() }
            pending.removeAll(keepingCapacity: true)
            guard receipt.version == 1, receipt.incarnation == incarnation else { throw invalid() }
            if receipt.kind == "failed" {
                // Display a shell-owned message; never render arbitrary peer bytes.
                throw PreviewError.message("The bundled engine could not initialize its selected store or listener.")
            }
            guard receipt.kind == "ready", ready == nil,
                  receipt.identity == identity, receipt.store == store,
                  let schema = receipt.schema, schema > 0,
                  let address = receipt.endpoint, let url = URL(string: address),
                  url.scheme == "http", url.host == "127.0.0.1", let port = url.port, (1...65535).contains(port),
                  url.user == nil, url.password == nil, ["", "/"].contains(url.path),
                  url.query == nil, url.fragment == nil else { throw invalid() }
            ready = receipt
            endpoint = url
        }
        return endpoint
    }

    func invalid() -> Error { PreviewError.message("The bundled engine sent an invalid launch receipt.") }
}
