#if INSTANCE_SMOKE && ELECTRON_PERFORMANCE
import CryptoKit
import AppKit
import Foundation
import WebKit

/// Diagnostic observer for an explicitly selected disposable INSTANCE_SMOKE case.
/// Never compiled into the normal Swift app. Uses the same JS as Electron tests.
@MainActor
enum WorkspaceProbe {
    static func run(view: WKWebView, configuration: URL,
                    requireCurrent: @escaping () throws -> Void) async throws -> [String: Any] {
        try requireCurrent()
        let data = try Data(contentsOf: configuration)
        guard data.count <= 16 * 1024,
              let config = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let provider = config["providerURL"] as? String, let url = URL(string: provider),
              url.scheme == "http", url.host == "127.0.0.1", url.port != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
            throw ProbeFailure("Invalid disposable performance configuration")
        }
        guard let scriptURL = Bundle.main.url(forResource: "performance-workspace-probe", withExtension: "cjs") else {
            throw ProbeFailure("Missing fixture-only shared performance observer")
        }
        let script = try Data(contentsOf: scriptURL)
        guard script.count <= 64 * 1024, let source = String(data: script, encoding: .utf8) else {
            throw ProbeFailure("Invalid shared performance observer")
        }
        if let gatePath = config["foregroundGate"] as? String,
           let readyPath = config["foregroundReady"] as? String {
            let parent = configuration.deletingLastPathComponent().standardizedFileURL
            let gate = URL(fileURLWithPath: gatePath).standardizedFileURL
            let ready = URL(fileURLWithPath: readyPath).standardizedFileURL
            guard gate.deletingLastPathComponent() == parent,
                  ready.deletingLastPathComponent() == parent,
                  gate.lastPathComponent == "swift-foreground.go",
                  ready.lastPathComponent == "swift-foreground.ready" else {
                throw ProbeFailure("Invalid disposable native foreground gate")
            }
            try Data("ready".utf8).write(to: ready, options: .atomic)
            let deadline = Date().addingTimeInterval(120)
            while !FileManager.default.fileExists(atPath: gate.path) {
                try requireCurrent()
                guard Date() < deadline else { throw ProbeFailure("Native foreground gate timed out") }
                try await Task.sleep(for: .milliseconds(100))
            }
        }
        guard let nativeWindow = view.window else { throw ProbeFailure("Missing actual fixture window") }
        let foreground = ProbeForeground(window: nativeWindow)
        defer { foreground.close() }
        let foregroundStart = foreground.snapshot()
        try foreground.requireCurrent()
        let digest = SHA256.hash(data: script).map { String(format: "%02x", $0) }.joined()
        let result: Any = try await withCheckedThrowingContinuation { continuation in
            let completion = ProbeCompletion(continuation)
            view.callAsyncJavaScript(source + "\nreturn await nacWorkspaceProbe(config);",
                                     arguments: ["config": config], in: nil, in: .page) { result in
                do {
                    try requireCurrent()
                    completion.finish(try result.get())
                } catch { completion.fail(error) }
            }
        }
        try requireCurrent()
        try foreground.requireCurrent()
        guard var values = result as? [String: Any] else { throw ProbeFailure("Malformed performance result") }
        values["native_foreground"] = ["start": foregroundStart, "end": foreground.snapshot()]
        values["shared_probe_sha256"] = digest
        values["observer"] = "optimized INSTANCE_SMOKE; DOM/rAF and HTTP proxies only"
        if let window = view.window, let screen = window.screen {
            func rectangle(_ rect: NSRect) -> [String: Double] {
                ["x": rect.origin.x, "y": rect.origin.y,
                 "width": rect.width, "height": rect.height]
            }
            values["native_display"] = [
                "display_id": screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] ?? NSNull(),
                "backing_scale_factor": screen.backingScaleFactor,
                "screen_frame": rectangle(screen.frame), "window_frame": rectangle(window.frame),
                "content_bounds": rectangle(view.bounds),
                "available_screens": NSScreen.screens.map { candidate -> [String: Any] in
                    ["display_id": candidate.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] ?? NSNull(),
                     "backing_scale_factor": candidate.backingScaleFactor,
                     "frame": rectangle(candidate.frame)]
                }
            ]
        } else {
            throw ProbeFailure("The actual WK fixture display is unavailable")
        }
        return values
    }
}

@MainActor private final class ProbeForeground {
    private weak var window: NSWindow?
    private var tokens: [NSObjectProtocol] = []
    private var resignActive = 0, resignKey = 0, hidden = 0

    init(window: NSWindow) {
        self.window = window
        let center = NotificationCenter.default
        tokens = [
            center.addObserver(forName: NSApplication.didResignActiveNotification, object: NSApp, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.resignActive += 1 }
            },
            center.addObserver(forName: NSWindow.didResignKeyNotification, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.resignKey += 1 }
            },
            center.addObserver(forName: NSApplication.didHideNotification, object: NSApp, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.hidden += 1 }
            }
        ]
    }

    func snapshot() -> [String: Any] {
        ["application_active": NSApp.isActive, "window_key": window?.isKeyWindow ?? false,
         "window_visible": window?.isVisible ?? false, "window_miniaturized": window?.isMiniaturized ?? true,
         "resigned_active_count": resignActive, "resigned_key_count": resignKey, "hidden_count": hidden]
    }

    func requireCurrent() throws {
        guard NSApp.isActive, let window, window.isKeyWindow, window.isVisible, !window.isMiniaturized,
              resignActive == 0, resignKey == 0, hidden == 0 else {
            throw ProbeFailure("Actual native foreground changed; this timing cell is not admitted")
        }
    }

    func close() {
        for token in tokens { NotificationCenter.default.removeObserver(token) }
        tokens.removeAll()
    }
}

private struct ProbeFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

@MainActor private final class ProbeCompletion {
    private var continuation: CheckedContinuation<Any, Error>?
    private var timer: DispatchWorkItem?
    init(_ continuation: CheckedContinuation<Any, Error>) {
        self.continuation = continuation
        let timeout = DispatchWorkItem { [weak self] in self?.fail(ProbeFailure("Performance observer exceeded 180 seconds")) }
        timer = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 180, execute: timeout)
    }
    func finish(_ value: Any) { complete(.success(value)) }
    func fail(_ error: Error) { complete(.failure(error)) }
    private func complete(_ result: Result<Any, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        timer?.cancel(); timer = nil
        continuation.resume(with: result)
    }
}
#endif
