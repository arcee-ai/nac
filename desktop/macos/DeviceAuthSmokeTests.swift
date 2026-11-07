import Foundation
import Darwin

/// CLI-only state controls. This executable never creates PreviewApp, NSApp,
/// a WebView, a browser, a profile, or an engine process.
@main
struct DeviceAuthSmokeTests {
    static let fixture = EngineIdentity(product_version: "test", build_id: "native-auth-fixture-v1-test",
                                        source_revision: String(repeating: "a", count: 40), track: "dev")
    static let document = NativeDocumentBinding(launch: "launch", view: "view", document: "document")

    static func receipt(identity: EngineIdentity = fixture, kind: String = "ready", version: Int = 1,
                        launch: String = "launch", endpoint: String = "http://127.0.0.1:3211",
                        store: String = "/fixture/store", schema: Int = 1) -> EngineReceipt {
        EngineReceipt(kind: kind, version: version, incarnation: launch, endpoint: endpoint, identity: identity,
                      store: store, schema: schema, stage: nil, code: nil, message: nil)
    }

    static func observe(_ state: inout DeviceAuthPassiveObservation, current: EngineReceipt? = receipt(),
                        pid: Int32 = 123, binding: NativeDocumentBinding? = document,
                        failed: Bool = false, stopping: Bool = false, expired: Bool = false) {
        state.observe(receipt: current, pid: pid, document: binding,
                      nativeFailure: failed, stopping: stopping, readinessExpired: expired)
    }

    static func ready() -> DeviceAuthPassiveObservation {
        var state = DeviceAuthPassiveObservation()
        observe(&state)
        precondition(state.phase == .ready && state.binding?.pid == 123 && state.failure == nil)
        return state
    }

    static func rejectInitial(_ current: EngineReceipt, binding: NativeDocumentBinding = document) {
        var state = DeviceAuthPassiveObservation()
        observe(&state, current: current, binding: binding)
        precondition(state.phase == .failed && state.failure == .invalidEngine && state.binding == nil)
        let data = try! JSONSerialization.data(withJSONObject: state.facts)
        precondition(!String(decoding: data, as: UTF8.self).contains("never-emit"))
    }

    static func stale(_ current: EngineReceipt? = receipt(), pid: Int32 = 123,
                      binding: NativeDocumentBinding? = document) {
        var state = ready()
        observe(&state, current: current, pid: pid, binding: binding)
        precondition(state.failure != nil && state.phase == .failed)
        precondition(state.facts["binding_current"] as? Bool == false)
        precondition(state.facts["ready_observed"] as? Bool == true)
        let failed = state
        observe(&state)
        precondition(state == failed, "A stale observation must not revive a failed binding")
    }

    static func main() {
        for scenario in ["device-success", "device-denied", "device-expired", "device-cancel", "device-timeout",
                         "device-restart", "device-canceled-restart"] {
            precondition(DeviceAuthSmokeMode(scenario: scenario) == .active)
        }
        precondition(DeviceAuthSmokeMode(scenario: "device-external-xctest") == .externalXCTest)
        for scenario in ["", "device", "device-external-xctest-extra", "device-external-xctest ",
                         "Device-external-xctest", "device-success-extra", "unknown"] {
            precondition(DeviceAuthSmokeMode(scenario: scenario) == nil)
        }

        var missing = DeviceAuthPassiveObservation(outputAvailable: false)
        observe(&missing)
        precondition(missing.failure == .missingOutput && missing.binding == nil)
        var waiting = DeviceAuthPassiveObservation()
        observe(&waiting, current: nil, pid: 0, binding: nil)
        observe(&waiting, binding: nil)
        precondition(waiting.phase == .waiting && waiting.binding == nil)
        observe(&waiting, binding: nil, expired: true)
        precondition(waiting.failure == .readinessTimeout)
        observe(&waiting)
        precondition(waiting.binding == nil, "A late ready document must not undo a timeout")

        var firstExpired = DeviceAuthPassiveObservation()
        observe(&firstExpired, expired: true)
        guard firstExpired.phase == .failed, firstExpired.failure == .readinessTimeout,
              firstExpired.binding == nil else {
            fputs("FAIL: first valid binding at the expired readiness deadline was adopted.\n", stderr)
            exit(1)
        }
        let expired = firstExpired
        observe(&firstExpired)
        precondition(firstExpired == expired, "A subsequent valid sample must not revive first-sample expiry")

        var stable = ready()
        let original = stable
        observe(&stable, expired: true)
        precondition(stable == original, "Readiness deadline must not expire an already verified launch")
        precondition(stable.facts["ready_source"] as? String == fixture.source_revision)
        precondition(stable.facts["origin"] as? String == "http://127.0.0.1:3211")
        precondition(stable.facts["engine_identity"] as? [String: String] == ["product_version": "test",
            "build_id": fixture.build_id, "source_revision": fixture.source_revision, "track": "dev"])
        precondition(stable.facts["passed"] == nil, "Observer readiness is never auth acceptance")
        precondition(stable.facts["observer_input_issued"] as? Bool == false)
        precondition(stable.facts["input_issued"] == nil, "Observer inactivity must not imply an inactive external actor")
        precondition(stable.facts["ready_store"] == nil, "Do not emit the store path")
        let snapshot = try! JSONSerialization.data(withJSONObject: stable.facts)
        precondition(snapshot.count <= 4096)
        precondition(!String(decoding: snapshot, as: UTF8.self).contains("/fixture/store"))

        for identity in [
            EngineIdentity(product_version: "test", build_id: "ordinary", source_revision: "source", track: "dev"),
            EngineIdentity(product_version: "test", build_id: fixture.build_id, source_revision: "source", track: "release"),
            EngineIdentity(product_version: "test", build_id: fixture.build_id, source_revision: "", track: "dev"),
        ] { rejectInitial(receipt(identity: identity)) }
        for current in [receipt(kind: "failure"), receipt(version: 2), receipt(schema: 0),
                        receipt(endpoint: "http://localhost:3211"), receipt(endpoint: "https://127.0.0.1:3211"),
                        receipt(endpoint: "http://127.0.0.1:0"), receipt(endpoint: "http://user@127.0.0.1:3211"),
                        receipt(endpoint: "http://127.0.0.1:3211?secret=never-emit"),
                        receipt(endpoint: "http://127.0.0.1:3211#fragment"), receipt(store: "relative")] {
            rejectInitial(current)
        }
        rejectInitial(receipt(), binding: NativeDocumentBinding(launch: "foreign", view: "view", document: "document"))
        for current in [
            receipt(launch: "successor"), receipt(endpoint: "http://127.0.0.1:3212"), receipt(store: "/other/store"),
            receipt(schema: 2), receipt(version: 2), receipt(kind: "failure"),
            receipt(identity: EngineIdentity(product_version: "other", build_id: fixture.build_id,
                source_revision: fixture.source_revision, track: "dev")),
            receipt(identity: EngineIdentity(product_version: "test", build_id: "native-auth-fixture-v1-successor",
                source_revision: fixture.source_revision, track: "dev")),
            receipt(identity: EngineIdentity(product_version: "test", build_id: fixture.build_id,
                source_revision: String(repeating: "b", count: 40), track: "dev")),
            receipt(identity: EngineIdentity(product_version: "test", build_id: fixture.build_id,
                source_revision: fixture.source_revision, track: "release")),
        ] { stale(current) }
        stale(nil)
        stale(pid: 124)
        stale(pid: 0)
        stale(binding: nil)
        stale(binding: NativeDocumentBinding(launch: "launch", view: "view", document: "reloaded"))
        stale(binding: NativeDocumentBinding(launch: "launch", view: "other", document: "document"))

        var nativeFailure = ready()
        observe(&nativeFailure, failed: true)
        precondition(nativeFailure.failure == .nativeFailure)
        nativeFailure.didStop(pid: 123, receipt: receipt(), document: document)
        precondition(nativeFailure.failure == .nativeFailure && nativeFailure.phase == .retired)
        precondition(!nativeFailure.stopped && !nativeFailure.commandsRetired)

        var quitting = ready()
        observe(&quitting, current: nil, pid: 0, binding: nil, stopping: true)
        precondition(quitting.phase == .stopping && quitting.failure == nil)
        quitting.didStop(pid: 0, receipt: nil, document: nil)
        precondition(quitting.phase == .retired && quitting.failure == nil)
        precondition(quitting.stopped && quitting.commandsRetired)
        let retired = quitting
        observe(&quitting)
        quitting.didStop(pid: 123, receipt: receipt(), document: document)
        precondition(quitting == retired, "Retired observer must ignore late callbacks")
        var interrupted = ready()
        observe(&interrupted, stopping: true)
        observe(&interrupted)
        precondition(interrupted.failure == .staleBinding)

        for (pid, current, binding) in [(Int32(123), nil as EngineReceipt?, nil as NativeDocumentBinding?),
                                        (Int32(0), receipt(), nil), (Int32(0), nil, document)] {
            var incomplete = ready()
            incomplete.didStop(pid: pid, receipt: current, document: binding)
            precondition(incomplete.failure == .incompleteRetirement && incomplete.phase == .retired)
        }
        print("Passive device mode/binding/failure/retirement controls passed; no app, WK, browser or auth operation")
    }
}
