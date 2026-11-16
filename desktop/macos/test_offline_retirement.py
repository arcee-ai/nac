"""Actual retirement decision with inert listener/connection/clock ports.

Run under the shared compiler lease. Extract the current observer and stop body
without rewriting them; compile the real policy/target owners. No Network,
listener, socket, app, provider, profile or engine is acquired by the Swift test.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent

HARNESS = r'''
import Foundation
import Darwin

enum Clock {
    static var now = 100.0
    static var advanceOnObservation: Double?
    static var sleepTo: Double?
    static var cancelOnSleep: (() -> Void)?
    static var sleeps: [UInt64] = []
    static var observations = 0
    static func observe() {
        observations += 1
        if let next = advanceOnObservation { now = next; advanceOnObservation = nil }
    }
    static func reset() {
        now = 100; advanceOnObservation = nil; sleepTo = nil
        cancelOnSleep = nil; sleeps = []; observations = 0
    }
}
final class InertClock { var systemUptime: Double { Clock.now } }
enum ProcessInfo { static let processInfo = InertClock() }
enum Task {
    static var isCancelled: Bool { false }
    static func sleep(nanoseconds: UInt64) async throws {
        Clock.sleeps.append(nanoseconds)
        guard let next = Clock.sleepTo else { throw OfflineProviderPolicy.Refusal.invalid }
        Clock.now = next; Clock.cancelOnSleep?()
    }
}
enum State { case ready, cancelled }
final class Listener {
    var value = State.ready
    var state: State { Clock.observe(); return value }
    func cancel() { value = .cancelled }
}
final class Connection {
    var value = State.ready
    var state: State { Clock.observe(); return value }
    func cancel() { value = .cancelled }
}

@MainActor final class FixtureProvider {
    static var last: FixtureProvider?
    var offline: OfflineProviderPolicy?
    var baseURL: URL! = URL(string: "http://127.0.0.1:43123")!
    private var listener: Listener?
    private var connections: [UUID: Connection] = [:]
    private var offlineRetiredConnections: [Connection]?
    private var heldResponses: [() -> Void] = []
    init() { Self.last = self }
    func start() async throws {
        listener = Listener(); connections = [UUID(): Connection()]
    }
    var handlesRetained: Bool { listener != nil && offlineRetiredConnections != nil }
    func setStates(_ listenerState: State, _ connectionState: State) {
        listener?.value = listenerState
        for connection in offlineRetiredConnections ?? [] { connection.value = connectionState }
    }
__ACTUAL_STOP__
__ACTUAL_OBSERVER__
}

@main struct Control {
    static var rows: [[String: Any]] = []
    @MainActor static func direct(_ label: String, at: Double, expected: Bool,
                                  delayedObservation: Double? = nil,
                                  pending: Bool = false, sleepTo: Double? = nil,
                                  retired: Bool = true) async throws {
        Clock.reset()
        let provider = FixtureProvider(); provider.offline = OfflineProviderPolicy()
        try await provider.start()
        if retired { provider.offline!.retire() }
        provider.stop()
        if pending { provider.setStates(.ready, .ready) }
        Clock.now = at; Clock.advanceOnObservation = delayedObservation
        Clock.sleepTo = sleepTo
        Clock.cancelOnSleep = { provider.setStates(.cancelled, .cancelled) }
        var accepted = false
        do { try await provider.awaitOfflineControlStop(deadline: 102); accepted = true } catch {}
        let retained = provider.handlesRetained
        let pass = accepted == expected && retained == !expected && Clock.observations > 0
        rows.append(["case": label, "accepted": accepted, "expected": expected,
                     "handles_retained": retained, "observed_at": Clock.now,
                     "deadline": 102, "sleeps": Clock.sleeps, "passed": pass])
    }
    @MainActor static func owned(_ label: String, at: Double, expected: Bool) async throws {
        Clock.reset()
        let target = OfflineHTTPControlTarget()
        _ = try await target.open()
        let provider = FixtureProvider.last!, policy = target.policy!
        target.close() // Actual owner fixes original deadline at100+2.
        Clock.now = at
        var accepted = false
        do { try await target.settle(); accepted = true } catch {}
        let retained = target.policy === policy
        let handles = provider.handlesRetained
        var successorDenied = false, retryDenied = false
        if !expected {
            do { _ = try await target.open() } catch { successorDenied = true }
            do { try await target.settle() } catch { retryDenied = true }
        } else {
            do { _ = try await target.open(); target.close(); try await target.settle() }
            catch { successorDenied = true }
        }
        let pass = accepted == expected && retained == !expected && handles == !expected && policy.retired &&
            (expected ? !successorDenied : successorDenied && retryDenied)
        rows.append(["case": label, "accepted": accepted, "expected": expected,
                     "owner_retained": retained, "handles_retained": handles,
                     "retired": policy.retired, "successor_denied": successorDenied,
                     "retry_denied": retryDenied, "observed_at": Clock.now,
                     "original_deadline": 102, "passed": pass])
    }
    @MainActor static func main() async throws {
        try await direct("cancelled-before", at: 101.999, expected: true)
        try await direct("cancelled-equal", at: 102, expected: false)
        try await direct("cancelled-past", at: 103, expected: false)
        try await direct("state-observation-crosses-clock", at: 101, expected: false, delayedObservation: 103)
        try await direct("pending-equal", at: 102, expected: false, pending: true)
        try await direct("pending-past", at: 103, expected: false, pending: true)
        try await direct("sleep-resumes-cancelled-equal", at: 101.99, expected: false, pending: true, sleepTo: 102)
        try await direct("sleep-resumes-cancelled-past", at: 101.99, expected: false, pending: true, sleepTo: 103)
        try await owned("owner-before", at: 101.999, expected: true)
        try await owned("owner-equal", at: 102, expected: false)
        try await owned("owner-past", at: 103, expected: false)
        let passed = rows.allSatisfy { $0["passed"] as? Bool == true }
        let result: [String: Any] = ["passed": passed, "cases": rows,
            "actual_network_app_provider_operations": false,
            "clock_and_state_ports": "inert; actual observer/stop bytes and target/policy owners"]
        let bytes = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data([10]))
        exit(passed ? 0 : 1)
    }
}
'''


def extract_method(source, signature):
    """Brace matching keeps exact source bytes; these methods contain no braces in strings."""
    start = source.index(signature)
    opening = source.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        if source[end] == '{':
            depth += 1
        elif source[end] == '}':
            depth -= 1
        end += 1
    return source[start:end]


def run(source_root, output):
    output.mkdir(parents=True, exist_ok=False)
    provider = (source_root / 'FixtureProvider.swift').read_text()
    stop = extract_method(provider, '    func stop() {')
    observer = extract_method(provider, '    @MainActor func awaitOfflineControlStop(')
    harness = HARNESS.replace('__ACTUAL_STOP__', stop).replace('__ACTUAL_OBSERVER__', observer)
    source = output / 'RetirementInert.swift'
    source.write_text(harness)
    (output / 'actual-observer.swift').write_text(observer)
    (output / 'actual-stop.swift').write_text(stop)
    inputs = [source_root / name for name in ('FixtureProvider.swift', 'OfflineProviderPolicy.swift',
                                             'OfflineHTTPControlTarget.swift', 'test_offline_retirement.py')]
    receipt = dict(inputs={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
                   observer_sha256=hashlib.sha256(observer.encode()).hexdigest(),
                   stop_sha256=hashlib.sha256(stop.encode()).hexdigest(),
                   harness_sha256=hashlib.sha256(harness.encode()).hexdigest(), commands=[],
                   actual_network_app_provider_operations=False)

    def command(argv, limit):
        row = dict(argv=argv, limit_seconds=limit, state='attempted')
        receipt['commands'].append(row)
        def save():
            (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        save()
        started = time.monotonic()
        try:
            result = subprocess.run(argv, text=True, capture_output=True, timeout=limit)
            row.update(state='completed', exit=result.returncode, stdout=result.stdout, stderr=result.stderr)
            return result
        except BaseException as error:
            row.update(state='failed', error=type(error).__name__)
            raise
        finally:
            row['seconds'] = time.monotonic() - started
            save()

    compiler = ['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5',
                '-target', 'arm64-apple-macosx14.0', '-O', '-D', 'PREVIEW_SMOKE',
                str(source), str(source_root / 'OfflineProviderPolicy.swift'),
                str(source_root / 'OfflineHTTPControlTarget.swift'), '-o', str(output / 'controls')]
    result = command(compiler, 90)
    if result.returncode:
        return result.returncode
    result = command([str(output / 'controls')], 5)
    value = json.loads(result.stdout)
    (output / 'observations.json').write_text(json.dumps(value, indent=2) + '\n')
    return result.returncode


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--artifacts', type=Path, required=True)
    arguments = parser.parse_args()
    raise SystemExit(run(arguments.source_root.resolve(), arguments.artifacts.resolve()))
