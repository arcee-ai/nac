import Darwin
import Foundation

/// CLI-only characterization: real existing provider and identified Rust child,
/// with no AppKit application, window, WKWebView or external browser.
@main
@MainActor
struct RecordingFenceTests {
    static func main() async throws {
        let arguments = CommandLine.arguments
        guard let option = arguments.firstIndex(of: "--engine"), option + 1 < arguments.count else {
            throw PreviewError.message("Missing exact private recording-fence test engine")
        }
        let executable = URL(fileURLWithPath: arguments[option + 1])
        let profile = try PreviewProfile()
        let provider = FixtureProvider()
        let engine = PreviewEngine()
        let hostEnvironment = ProcessInfo.processInfo.environment
        var childPID: pid_t = 0
        do {
            let base = profile.environment
            let proxy = URL(string: "http://127.0.0.1:43123")!
            for arguments in [
                ["fixture"], ["fixture", "--smoke-scenario"],
                ["fixture", "--smoke-scenario", "normal"],
                ["fixture", "--smoke-scenario", "external-navigation-recording-extra"],
                ["fixture", "--smoke-scenario", "external-navigation-recording", "--smoke-scenario", "normal"],
            ] {
                try require(PreviewEngine.recordingEnvironment(base, provider: proxy, arguments: arguments) == base,
                            "Nonrecording or malformed scenario changed its child environment")
            }
            let exact = PreviewEngine.recordingEnvironment(base, provider: proxy,
                arguments: ["fixture", "--smoke-scenario", "external-navigation-recording"])
            for name in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
                try require(exact[name] == proxy.absoluteString, "Recording child proxy differed")
            }
            try require(exact["NO_PROXY"] == "127.0.0.1,localhost,::1", "Recording loopback bypass differed")
            try require(base == profile.environment && hostEnvironment == ProcessInfo.processInfo.environment,
                        "Recording construction changed the profile or host environment")

            // Only this exact fenced case launches a Rust child. Its models-dev
            // URL and every test request remain on the existing loopback fixture.
            try await provider.start()
            var ready: URL?
            var failed = false
            engine.onReady = { ready = $0 }
            engine.onFailure = { _ in failed = true }
            engine.onExit = { _ in failed = true }
            try engine.launch(executable: executable, profile: profile, provider: provider)
            childPID = engine.pid
            try await wait("Identified recording child did not become ready") { ready != nil || failed }
            guard !failed, let ready, let receipt = engine.receipt, let identity = receipt.identity else {
                throw PreviewError.message("Recording child readiness failed")
            }
            try require(identity.track == "dev" && !identity.build_id.hasPrefix("native-auth-fixture-v1-"),
                        "Recording control requires the normal development engine")
            let session = URLSession(configuration: .ephemeral)
            defer { session.invalidateAndCancel() }
            var request = URLRequest(url: ready.appendingPathComponent("mcp_library/library"), timeoutInterval: 15)
            request.httpMethod = "GET"
            let (data, response) = try await session.data(for: request)
            let catalog = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let entries = catalog?["entries"] as? [[String: Any]] ?? []
            try require((response as? HTTPURLResponse)?.statusCode == 200 && entries.contains {
                $0["id"] as? String == "exa" &&
                $0["docs_url"] as? String == "https://docs.exa.ai/reference/exa-mcp"
            }, "Actual Rust catalog did not retain its embedded fallback")
            try await wait("Actual Rust catalog warmup never reached the rejecting fixture") {
                provider.rejectedConnectCount > 0
            }
            try require(provider.responseCount == 0, "Recording fence control unexpectedly performed inference")
            let rejected = provider.rejectedConnectCount
            await stop(engine)
            try require(engine.pid == 0 && engine.receipt == nil && !alive(childPID),
                        "Recording child identity/process survived stop")
            provider.stop()
            // A failed fresh loopback connection establishes retirement rather
            // than assuming that a cancellation callback has already completed.
            var stillServing = true
            let probe = URLRequest(url: provider.baseURL.appendingPathComponent("models-dev"), timeoutInterval: 1)
            do { _ = try await session.data(for: probe) } catch { stillServing = false }
            try require(!stillServing, "Recording provider listener survived stop")
            try profile.remove()
            try require(!FileManager.default.fileExists(atPath: profile.root.path), "Recording profile survived cleanup")
            let result: [String: Any] = [
                "scope": "CLI-only actual Rust catalog through existing rejecting preview provider",
                "source_revision": identity.source_revision, "build_id": identity.build_id,
                "rejected_connect_count": rejected, "inference_count": provider.responseCount,
                "normal_other_malformed_construction_unchanged": true, "host_environment_unchanged": true,
                "embedded_catalog_fallback": true, "child_reaped_identity_retired": true,
                "provider_stopped": true, "profile_removed": true,
                "native_wk_qualified": false, "universal_offline_qualified": false,
            ]
            let output = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            print(String(decoding: output, as: UTF8.self))
        } catch {
            await stop(engine)
            provider.stop()
            try? profile.remove()
            throw error
        }
    }

    private static func require(_ condition: Bool, _ message: String) throws {
        guard condition else { throw PreviewError.message(message) }
    }

    private static func wait(_ message: String, condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        throw PreviewError.message(message)
    }

    private static func stop(_ engine: PreviewEngine) async {
        await withCheckedContinuation { continuation in engine.stop { continuation.resume() } }
    }

    private static func alive(_ pid: pid_t) -> Bool { pid > 0 && kill(pid, 0) == 0 }
}
