// Compile with the exact pure callback/error definitions extracted from InstanceSmoke.swift.
@main
enum InstanceWorkspaceCompletionTests {
    @MainActor
    static func main() async throws {
        let first: String = try await withCheckedThrowingContinuation { continuation in
            let completion = InstanceWorkspaceCompletion<String>(continuation, timeout: 1, label: "success")
            completion.finish(.success("first"))
            completion.finish(.failure(InstanceFixtureError("duplicate")))
        }
        precondition(first == "first")

        var late: InstanceWorkspaceCompletion<String>?
        let start = ProcessInfo.processInfo.systemUptime
        do {
            let _: String = try await withCheckedThrowingContinuation { continuation in
                late = InstanceWorkspaceCompletion<String>(continuation, timeout: 0.01, label: "missing callback")
            }
            preconditionFailure("A missing WebKit callback must not produce readiness")
        } catch {
            precondition(error.localizedDescription == "Timed out: missing callback")
            precondition(ProcessInfo.processInfo.systemUptime - start < 2)
        }
        late?.finish(.success("retired late callback"))
        late?.finish(.failure(InstanceFixtureError("late duplicate")))
        late = nil
        print("Workspace callback success, timeout and late/duplicate completion controls passed")

        let atLimit = Data(repeating: 0, count: 2 * 1024 * 1024)
        try validateWorkspaceSnapshotSize(atLimit)
        do {
            try validateWorkspaceSnapshotSize(atLimit + Data([0]))
            preconditionFailure("Oversized diagnostic PNG must not reach the exporter")
        } catch {
            precondition(error.localizedDescription ==
                "Failure WK snapshot exceeds the 2 MiB export limit; pixel evidence not retained")
        }
        print("Exact 2 MiB snapshot boundary and explicit oversized coverage-gap controls passed")
        await WorkspaceReadinessHost.verify()
    }
}

/// The driver inserts the exact production readiness/binding methods at the marker.
/// Only observation transport, native facts and monotonic time are modeled here.
@MainActor
private final class WorkspaceReadinessHost {
    enum Mode: CaseIterable {
        case transient, persistent, malformed, numericReady, pageError, latePositive, beforeFenceLoss
        case nativeFailure, generationLoss, storeLoss, originLoss, documentOriginLoss, retirement, pidLoss
        case hidden, closed, cancelled
        case positiveNativeFailure, positiveGenerationLoss, positiveOriginLoss
        case beforeProbeDeadline
    }
    struct Identity: Encodable {}
    struct Receipt {
        var incarnation = "owned-generation"
        var store = "/owned/fixture.db"
        let schema = 1
        let identity: Identity? = nil
    }
    struct Engine { var receipt: Receipt? = Receipt(); var pid = 42 }
    struct View { var isHidden = false; var isLoading = false; var url = URL(string: "http://127.0.0.1:45678/") }
    struct Window { var isVisible = true }
    struct ObservationFailure: LocalizedError {
        let attempt: Int
        var errorDescription: String? { "observer-error-\(attempt)" }
    }
    @MainActor final class Clock { var systemUptime = 0.0; var cancelled = false; var expireOnBinding = false }
    @MainActor enum ProcessInfo { static var processInfo = Clock() }
    @MainActor enum Task {
        static func checkCancellation() throws {
            if ProcessInfo.processInfo.cancelled { throw CancellationError() }
            if ProcessInfo.processInfo.expireOnBinding {
                ProcessInfo.processInfo.systemUptime = 45
                ProcessInfo.processInfo.expireOnBinding = false
            }
        }
        static func sleep(nanoseconds: UInt64) async throws { try checkCancellation() }
    }
    let mode: Mode
    var engine = Engine()
    var webView = View()
    var window = Window()
    let expectedStore = "/owned/fixture.db"
    var evidence: [String: Any] = [:]
    var attempts = 0
    var selectedURL = URL(string: "http://127.0.0.1:45678/")
    var nativeFailure: String?

    init(_ mode: Mode) {
        self.mode = mode
        ProcessInfo.processInfo = Clock()
        ProcessInfo.processInfo.expireOnBinding = mode == .beforeProbeDeadline
    }
    func baseURL() -> URL? { selectedURL }
    func failure() -> String? { nativeFailure }
    func write() {}
    func wait(_ label: String, timeout: TimeInterval, _ predicate: () -> Bool) async throws {
        precondition(predicate())
        if mode == .beforeFenceLoss { engine.pid = 0 }
    }

    func observeWorkspace(origin: String, timeout: TimeInterval) async throws -> [String: Any] {
        precondition(timeout > 0 && timeout <= 1)
        attempts += 1
        ProcessInfo.processInfo.systemUptime += [.persistent, .malformed, .numericReady].contains(mode) ? 2.25 : 0.1
        switch mode {
        case .transient: if attempts == 1 { throw ObservationFailure(attempt: attempts) }
        case .persistent: throw ObservationFailure(attempt: attempts)
        case .malformed: return ["ready": true]
        case .nativeFailure: nativeFailure = "native renderer failed"
        case .generationLoss: engine.receipt?.incarnation = "new-generation"
        case .storeLoss: engine.receipt?.store = "/different/store.db"
        case .originLoss: selectedURL = URL(string: "http://127.0.0.1:45679/")
        case .documentOriginLoss: webView.url = URL(string: "http://127.0.0.1:45679/")
        case .retirement: engine.receipt = nil
        case .pidLoss: engine.pid = 0
        case .hidden: webView.isHidden = true
        case .closed: window.isVisible = false
        case .cancelled: ProcessInfo.processInfo.cancelled = true
        case .positiveNativeFailure: nativeFailure = "native renderer failed"
        case .positiveGenerationLoss: engine.receipt?.incarnation = "new-generation"
        case .positiveOriginLoss: selectedURL = URL(string: "http://127.0.0.1:45679/")
        case .latePositive: ProcessInfo.processInfo.systemUptime = 45
        case .numericReady, .pageError, .beforeFenceLoss, .beforeProbeDeadline: break
        }
        let losses: [Mode] = [.nativeFailure, .generationLoss, .storeLoss, .originLoss,
                              .documentOriginLoss, .retirement, .pidLoss, .hidden, .closed, .cancelled]
        if losses.contains(mode) { throw ObservationFailure(attempt: attempts) }
        let body = "No projects yet. Get Started. " + String(repeating: "owned fixture ", count: 10)
        var result: [String: Any] = [
            "ready": true, "url": "http://127.0.0.1:45678/#/", "ready_state": "complete",
            "semantic": "empty-onboarding", "body_length": body.utf16.count, "body_text": body,
            "root_html": "<div id='root'>owned fixture</div>", "diagnostics_installed": true,
            "errors": []
        ]
        if mode == .numericReady { result["ready"] = 1 }
        if mode == .pageError {
            result["errors"] = [["kind": "javascript-error", "message": "captured page failure", "url": "fixture"]]
        }
        return result
    }

    // INSERT_EXACT_WORKSPACE_READINESS_METHODS

    static func verify() async {
        for mode in Mode.allCases {
            let host = WorkspaceReadinessHost(mode)
            var completed = false
            var failure = ""
            do { try await host.readyWorkspace(); completed = true }
            catch { failure = error.localizedDescription }
            let count = host.evidence["workspace_observation_error_count"] as? Int ?? 0
            let samples = host.evidence["workspace_observation_errors"] as? [String] ?? []
            precondition(completed == (mode == .transient), "mode \(mode)")
            precondition((host.evidence["workspace_activated"] as? Bool == true) == completed)
            switch mode {
            case .transient:
                precondition(host.attempts == 2 && count == 1 && samples == ["observer-error-1"])
                precondition(host.evidence["workspace_observation_last_error"] as? String == "observer-error-1")
            case .persistent, .malformed, .numericReady:
                precondition(host.attempts == 20 && count == 20 && samples.count == 16)
                precondition(ProcessInfo.processInfo.systemUptime == 45)
                precondition(failure.contains("Timed out"))
                if mode == .persistent {
                    precondition(samples.first == "observer-error-1" && samples.last == "observer-error-16")
                    precondition(host.evidence["workspace_observation_last_error"] as? String == "observer-error-20")
                }
            case .pageError:
                precondition(host.attempts == 1 && count == 0 && failure.contains("JavaScript or resource errors"))
                let observation = host.evidence["workspace_observation"] as! [String: Any]
                precondition((observation["errors"] as! [[String: String]]).count == 1)
            case .latePositive:
                precondition(host.attempts == 1 && count == 0 && failure.contains("Timed out"))
            case .beforeFenceLoss:
                precondition(host.attempts == 0 && count == 0)
            case .positiveNativeFailure, .positiveGenerationLoss, .positiveOriginLoss:
                precondition(host.attempts == 1 && count == 0 && failure.contains("lost its serving binding"))
            case .beforeProbeDeadline:
                precondition(host.attempts == 0 && count == 0 && failure.contains("Timed out"))
            default:
                precondition(host.attempts == 1 && count == 1 && samples == ["observer-error-1"])
            }
        }
        print("21 exact-method readiness controls passed: recovery, bounded errors/deadline, malformed/page errors and native binding loss")
    }
}
