import Foundation

/// Supplement to an already-owned private launch receipt; never engine adoption.
/// No redirect, cache, credential discovery, store mutation or restart occurs.
final class WorkspaceReadiness: NSObject, URLSessionTaskDelegate {
    private struct Status: Decodable {
        let status: String
        let product_version: String
        let build_id: String
        let source_revision: String
        let build_track: String
        let opened_schema_version: Int
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    static func matches(_ data: Data, receipt: EngineReceipt) -> Bool {
        guard data.count <= EngineProtocol.limit, let identity = receipt.identity,
              let value = try? JSONDecoder().decode(Status.self, from: data) else { return false }
        return value.status == "ok" && value.product_version == identity.product_version &&
            value.build_id == identity.build_id && value.source_revision == identity.source_revision &&
            value.build_track == identity.track && value.opened_schema_version == receipt.schema
    }

    static func check(_ receipt: EngineReceipt) async throws {
        guard let endpoint = receipt.endpoint, let base = URL(string: endpoint),
              base.scheme == "http", base.host == "127.0.0.1", base.port != nil,
              base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
              ["", "/"].contains(base.path) else {
            throw PreviewError.message("The owned engine has no verified endpoint.")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForResource = 3
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        let session = URLSession(configuration: configuration, delegate: WorkspaceReadiness(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: base.appendingPathComponent("readyz"))
        request.timeoutInterval = 3
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (bytes, response) = try await session.bytes(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw PreviewError.message("The owned engine is unavailable. No restart was attempted.")
        }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < EngineProtocol.limit else {
                throw PreviewError.message("The engine readiness response exceeded its limit.")
            }
            data.append(byte)
        }
        guard matches(data, receipt: receipt) else {
            throw PreviewError.message("The engine readiness binding changed. Its workspace remains disabled.")
        }
    }
}
