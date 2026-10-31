import Foundation
import CoreFoundation

enum NativeUIAction: String, Codable, CaseIterable {
    case newSession, settings, projects
}

struct NativeDocumentBinding: Codable, Equatable {
    let launch: String
    let view: String
    let document: String
}

struct NativeUIRequest: Encodable {
    let version = 1
    let request: Int
    let action: NativeUIAction
}

/// A receipt authorizes no operation. This state only correlates UI delivery.
/// WKWebView/frame reference checks are supplied by NativeCommandBridge.
final class NativeCommandState {
    static let limit = 2048
    let origin: URL
    let launch: String
    let view = UUID().uuidString
    private(set) var binding: NativeDocumentBinding?
    private(set) var ready = false
    private var retired = false
    private var sequence = 0
    private var pending: Int?
    #if PREVIEW_SMOKE
    var smokeRequest: Int { sequence }
    #endif

    init?(receipt: EngineReceipt) {
        guard receipt.kind == "ready", receipt.version == 1, receipt.identity != nil,
              receipt.store != nil, (receipt.schema ?? 0) > 0,
              let endpoint = receipt.endpoint, let origin = URL(string: endpoint),
              origin.scheme == "http", origin.host == "127.0.0.1", origin.port != nil,
              origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil,
              ["", "/"].contains(origin.path) else { return nil }
        self.origin = origin
        launch = receipt.incarnation
    }

    func matches(_ receipt: EngineReceipt?) -> Bool {
        !retired && receipt?.incarnation == launch && receipt?.endpoint == origin.absoluteString
    }

    func allows(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port &&
            url.user == nil && url.password == nil
    }

    func beginDocument(receipt: EngineReceipt?) -> NativeDocumentBinding? {
        endDocument()
        guard matches(receipt) else { return nil }
        let next = NativeDocumentBinding(launch: launch, view: view, document: UUID().uuidString)
        binding = next
        return next
    }

    func endDocument() { binding = nil; ready = false; pending = nil }
    func retire() { endDocument(); retired = true }

    func issue(_ action: NativeUIAction, receipt: EngineReceipt?) -> NativeUIRequest? {
        guard matches(receipt), binding != nil, ready, pending == nil, sequence < Int(Int32.max) else { return nil }
        sequence += 1
        pending = sequence
        return NativeUIRequest(request: sequence, action: action)
    }

    @discardableResult
    func receive(_ body: String, origin source: URL?, mainFrame: Bool, currentView: Bool,
                 receipt: EngineReceipt?) -> Bool {
        guard currentView, mainFrame, allows(source), matches(receipt), let binding,
              body.utf8.count <= Self.limit,
              let data = body.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = object["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              object["launch"] as? String == binding.launch,
              object["view"] as? String == binding.view,
              object["document"] as? String == binding.document,
              let kind = object["kind"] as? String else { return false }
        let common: Set<String> = ["version", "kind", "launch", "view", "document"]
        switch kind {
        case "ready":
            guard Set(object.keys) == common, !ready else { return false }
            ready = true
        case "retired":
            guard Set(object.keys) == common, ready else { return false }
            ready = false
            pending = nil
        case "settled":
            guard Set(object.keys) == common.union(["request", "accepted"]), ready,
                  let request = object["request"] as? NSNumber, CFGetTypeID(request) != CFBooleanGetTypeID(),
                  request.doubleValue == Double(pending ?? -1),
                  let accepted = object["accepted"] as? NSNumber, CFGetTypeID(accepted) == CFBooleanGetTypeID()
            else { return false }
            pending = nil
        default: return false
        }
        return true
    }
}
