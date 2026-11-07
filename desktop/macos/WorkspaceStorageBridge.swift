import Foundation
import CoreFoundation
import WebKit

/// Reuses NativeCommandBridge's actual launch/view/document identity. This helper
/// cannot acquire another view, endpoint, filesystem path or operation capability.
@MainActor
final class WorkspaceStorageBridge {
    private weak var webView: WKWebView?
    private let storage: WorkspaceStorage
    private let current: () -> Bool
    private var binding: NativeDocumentBinding?
    private var sequence = 0

    init(webView: WKWebView, storage: WorkspaceStorage, current: @escaping () -> Bool) {
        self.webView = webView
        self.storage = storage
        self.current = current
    }

    func endDocument() { binding = nil; sequence = 0 }

    func activate(_ next: NativeDocumentBinding, endpoint: String) {
        binding = next
        sequence = 0
        Task { [weak self] in
            guard let self else { return }
            let snapshot = await storage.snapshot()
            guard binding == next, current() else { return }
            let bootstrap: [String: Any] = ["version": 1, "endpoint": endpoint,
                "document": object(next), "binding": storage.profile.binding,
                "available": snapshot["available"] ?? false, "values": snapshot["values"] ?? [:]]
            webView?.callAsyncJavaScript("return window.__nacDesktopStorage?.activate(bootstrap) === true",
                arguments: ["bootstrap": bootstrap], in: nil, in: .page) { _ in }
        }
    }

    /// The caller already checked WKWebView, controller, current receipt, main
    /// frame and exact origin. Malformed data never advances the sequence.
    func receive(_ body: String, expected: NativeDocumentBinding) -> Bool {
        guard current(), binding == expected, body.utf8.count <= WorkspaceCheckpoint.limit,
              let data = body.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = message["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              message["launch"] as? String == expected.launch,
              message["view"] as? String == expected.view,
              message["document"] as? String == expected.document,
              let number = message["sequence"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue == Double(sequence + 1), sequence < Int(Int32.max),
              let kind = message["kind"] as? String else { return false }
        let next = sequence + 1
        let common: Set<String> = ["version", "launch", "view", "document", "sequence", "kind"]
        let acknowledge: (Bool) -> Void = { [weak self] durable in
            self?.acknowledge(expected, sequence: next, durable: durable)
        }
        if kind == "flush" {
            guard Set(message.keys) == common else { return false }
            sequence = next
            storage.flush(completion: acknowledge)
            return true
        }
        guard kind == "write", Set(message.keys) == common.union(["namespace", "key", "value"]),
              let namespace = message["namespace"] as? String, let key = message["key"] as? String,
              message["value"] is String || message["value"] is NSNull,
              storage.write(namespace: namespace, key: key, value: message["value"] as? String,
                            completion: acknowledge) else { return false }
        sequence = next
        return true
    }

    func retire() {
        let previous = binding
        endDocument()
        if let previous {
            webView?.callAsyncJavaScript("return window.__nacDesktopStorage?.retire(binding) === true",
                arguments: ["binding": object(previous)], in: nil, in: .page) { _ in }
        }
    }

    func flush(completion: @escaping (Bool) -> Void) { storage.flush(completion: completion) }

    private func acknowledge(_ expected: NativeDocumentBinding, sequence: Int, durable: Bool) {
        guard binding == expected, current() else { return }
        webView?.callAsyncJavaScript(
            "return window.__nacDesktopStorage?.settled(binding, sequence, durable) === true",
            arguments: ["binding": object(expected), "sequence": sequence, "durable": durable],
            in: nil, in: .page) { _ in }
    }

    private func object(_ value: NativeDocumentBinding) -> [String: String] {
        ["launch": value.launch, "view": value.view, "document": value.document]
    }
}
