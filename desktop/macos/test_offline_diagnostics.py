"""Exact diagnostic method + real policy; compiler and ports are explicitly bounded.

Standalone CLI, not unittest discovery. No app, listener, provider or socket is
acquired. Import is inert; actual-method Swift and strict validators run in main.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

from test_offline_retirement import extract_method

ROOT = Path(__file__).resolve().parent

HARNESS = r'''
import Foundation
import Darwin

@MainActor final class EnginePort {
    var pid: Int32 = 0
    var receipt: String?
    var log = "SECRET_LOG https://secret.invalid/log"
}
@MainActor final class AppPort {
    let engine = EnginePort()
    var failure: String?
}
@MainActor final class FencePort {
    let policy = OfflineProviderPolicy()
    var diagnosticStage = "constructed"
}
@MainActor final class DiagnosticOwner {
    var scenario = "offline-api-key"
    var evidence: [String: Any] = ["passed": false, "error": "primary-failure"]
    let app = AppPort()
    var offline: FencePort?
    var writeAttempts = 0
    var writeFailures = 0
    var failWrite = false
    var written: [[String: Any]] = []
    func write() {
        writeAttempts += 1
        // Actual write() absorbs write errors; this port has no filesystem.
        if failWrite { writeFailures += 1; return }
        written.append(evidence)
    }
    func sample() { recordOfflineDiagnostic() }
    var diagnostic: [String: Any] { evidence["offline_diagnostic"] as? [String: Any] ?? [:] }
__ACTUAL_DIAGNOSTIC__
}

@main struct Control {
    static var rows: [[String: Any]] = []
    static func check(_ name: String, _ condition: Bool, facts: [String: Any] = [:]) {
        rows.append(["case": name, "passed": condition, "facts": facts])
    }
    @MainActor static func main() throws {
        let nilOwner = DiagnosticOwner()
        nilOwner.sample()
        let nilFacts = nilOwner.diagnostic
        check("nil-fence-observation-gap", nilOwner.writeAttempts == 1 &&
            nilFacts["fence_created"] as? Bool == false &&
            nilFacts["network_stage"] as? String == "not_created" &&
            nilFacts["engine_pid_observed_positive"] as? Bool == false &&
            nilFacts["ready_receipt_observed"] as? Bool == false &&
            (nilFacts["network_observations"] as? [String: Any])?.isEmpty == true)
        nilOwner.sample()
        check("unchanged-snapshot-no-write", nilOwner.writeAttempts == 1)

        let sticky = DiagnosticOwner()
        sticky.app.engine.pid = 42; sticky.app.engine.receipt = "owned-receipt"
        sticky.sample()
        sticky.app.engine.pid = 0; sticky.app.engine.receipt = nil
        sticky.sample()
        check("positive-pid-and-ready-remain-sticky", sticky.writeAttempts == 1 &&
            sticky.diagnostic["engine_pid_observed_positive"] as? Bool == true &&
            sticky.diagnostic["ready_receipt_observed"] as? Bool == true)

        let current = DiagnosticOwner()
        current.app.failure = "SECRET_FAILURE https://secret.invalid?key=SECRET_KEY"
        current.sample()
        let observed = current.diagnostic["startup_failure_observed"] as? Bool == true
        current.app.failure = nil; current.sample()
        check("startup-failure-current-presence-only", observed && current.writeAttempts == 2 &&
            current.diagnostic["startup_failure_observed"] as? Bool == false)

        let owner = DiagnosticOwner(); let fence = FencePort(); owner.offline = fence
        owner.evidence["offline_phase"] = "prelaunch_controls"
        fence.diagnosticStage = "before-native-http"
        owner.sample()
        let firstWrites = owner.writeAttempts
        let token = try fence.policy.canary()
        let authority = "secret.invalid:43123", path = "/SECRET_NONCE"
        try fence.policy.begin("before-native-http", authority: authority,
                               request: .http(method: "GET", path: path))
        fence.policy.reject("GET http://" + authority + path + " HTTP/1.1")
        _ = fence.policy.authorize("GET /models HTTP/1.1\r\nAuthorization: Bearer SECRET_KEY", response: false)
        owner.sample()
        let pending = owner.diagnostic["network_observations"] as! [String: Any]
        check("attempted-stage-no-fabricated-completion", owner.diagnostic["phase"] as? String == "prelaunch_controls" &&
            owner.diagnostic["network_stage"] as? String == "before-native-http" &&
            (pending["controls"] as? [[String: Any]])?.isEmpty == true &&
            owner.diagnostic["baseline_local_reachable"] == nil &&
            owner.evidence["offline_provider"] == nil && owner.evidence["passed"] as? Bool == false)
        check("counter-only-change-writes-once", owner.writeAttempts == firstWrites + 1 && pending["key_rejected"] as? Int == 1)
        owner.sample()
        check("repeated-counter-snapshot-no-write", owner.writeAttempts == firstWrites + 1)
        try fence.policy.finish("before-native-http", directToken: token)
        owner.sample()
        let complete = owner.diagnostic["network_observations"] as! [String: Any]
        let controls = complete["controls"] as! [[String: Any]]
        check("actual-policy-completed-row", controls.count == 1 &&
            controls[0]["control"] as? String == "before-native-http" &&
            controls[0]["proxy_rejections"] as? Int == 1 &&
            controls[0]["authority_fresh"] as? Bool == true)

        var stageOnce = true
        for phase in ["await_workspace", "fence_admission", "prelaunch_controls", "prelaunch_controls_passed", "offline_journey"] {
            let prior = owner.writeAttempts
            owner.evidence["offline_phase"] = phase
            owner.sample(); owner.sample()
            stageOnce = stageOnce && owner.writeAttempts == prior + 1
        }
        check("closed-phase-changes-write-once", stageOnce)
        var networkOnce = true
        for stage in ["reference-native", "reference-wk-fetch", "reference-wk-navigation", "reference-key-rejections",
                      "before-native-loopback", "before-native-http", "before-native-https", "initial-controls-complete"] {
            let prior = owner.writeAttempts
            fence.diagnosticStage = stage
            owner.sample(); owner.sample()
            networkOnce = networkOnce && owner.writeAttempts == prior + 1
        }
        check("closed-network-stage-change-write-once", networkOnce)
        owner.app.failure = "SECRET_FAILURE https://secret.invalid?key=SECRET_KEY"
        owner.app.engine.pid = 42; owner.app.engine.receipt = "owned-receipt"
        owner.sample()
        let encoded = try JSONSerialization.data(withJSONObject: owner.evidence, options: [.sortedKeys])
        let text = String(decoding: encoded, as: UTF8.self)
        let forbidden = ["SECRET_FAILURE", "SECRET_LOG", "SECRET_KEY", "SECRET_NONCE", "secret.invalid", token, OfflineProviderPolicy.key]
        check("no-secret-failure-log-key-url-nonce", forbidden.allSatisfy { !text.contains($0) })
        check("diagnostics-never-promote-pass", owner.evidence["passed"] as? Bool == false &&
            owner.evidence["error"] as? String == "primary-failure" && owner.evidence["offline_provider"] == nil)

        let refusedWrite = DiagnosticOwner(); refusedWrite.failWrite = true
        refusedWrite.app.failure = "SECRET_FAILURE"; refusedWrite.sample()
        check("write-failure-preserves-primary-failure", refusedWrite.writeFailures == 1 && refusedWrite.written.isEmpty &&
            refusedWrite.evidence["passed"] as? Bool == false && refusedWrite.evidence["error"] as? String == "primary-failure")
        let other = DiagnosticOwner(); other.scenario = "external-auth"; other.sample()
        check("other-scenario-no-diagnostic-or-write", other.writeAttempts == 0 && other.evidence["offline_diagnostic"] == nil)
        let passed = rows.allSatisfy { $0["passed"] as? Bool == true }
        let result: [String: Any] = ["passed": passed, "cases": rows,
            "diagnostic_object": owner.diagnostic, "app_provider_socket_operations": false,
            "negative_observations_are_absence_proof": false]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
        FileHandle.standardOutput.write(Data([10]))
        exit(passed ? 0 : 1)
    }
}
'''


def strict_and_registration(source_root, diagnostic):
    """Actual existing validators; refuse before any actor/process acquisition."""
    from external_auth_smoke import require_terminal
    from offline_provider_smoke import require_offline

    def deny(event, arguments):
        if event.startswith(('subprocess.', 'socket.')) or event in ('os.system', 'os.posix_spawn', 'os.fork'):
            raise RuntimeError('Unexpected real acquisition in inert diagnostic validators')
    sys.addaudithook(deny)
    rows = []
    build = dict(source_revision='a' * 40, build_id='inert-source', track='dev')
    for name, record in [
            ('failed-ordinary-terminal', dict(scenario='offline-api-key', passed=False)),
            ('missing-ordinary-terminal', dict(scenario='offline-api-key')),
            ('missing-source-binding', dict(scenario='offline-api-key', passed=True, commands_retired=True,
                engine_reaped=True, profile_removed=True, identity_retired=True))]:
        record['offline_diagnostic'] = diagnostic
        try:
            require_terminal(record, 'offline-api-key', build)
        except AssertionError:
            rows.append(dict(case=name, passed=True))
        else:
            raise AssertionError('Diagnostics unexpectedly substituted for ordinary terminal facts')
    for record in [dict(offline_diagnostic=diagnostic), dict(offline_diagnostic=diagnostic, offline_provider={})]:
        try:
            require_offline(record)
        except AssertionError:
            rows.append(dict(case='missing-offline-acceptance', passed=True))
        else:
            raise AssertionError('Diagnostics unexpectedly substituted for offline acceptance')
    tree = ast.parse((source_root / 'ci_native_offline.py').read_text())
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
    calls = [n for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'run'
             and n.args and isinstance(n.args[0], ast.Constant)]
    labels = [n.args[0].value for n in sorted(calls, key=lambda n: n.lineno)]
    assert labels.count('offline-diagnostic-controls') == 1
    call = next(n for n in calls if n.args[0].value == 'offline-diagnostic-controls')
    assert labels.index('offline-retirement-controls') < labels.index('offline-diagnostic-controls') < labels.index('smoke-build')
    assert any(k.arg == 'limit' and isinstance(k.value, ast.Constant) and k.value.value == 120 for k in call.keywords)
    assert any(k.arg == 'environment' and isinstance(k.value, ast.Name) and k.value.id == 'environment' for k in call.keywords)
    assert isinstance(call.args[1], ast.List)
    assert ast.unparse(call.args[1].elts[0]) == 'sys.executable'
    assert ast.literal_eval(call.args[1].elts[1]) == '-B'
    assert ast.literal_eval(call.args[1].elts[2]) == 'desktop/macos/test_offline_diagnostics.py'
    rows.append(dict(case='actual-standalone-registration-before-build', passed=True))
    return rows


def run(source_root, output):
    output.mkdir(parents=True, exist_ok=False)
    method = extract_method((source_root / 'PreviewSmoke.swift').read_text(), '    private func recordOfflineDiagnostic()')
    harness = HARNESS.replace('__ACTUAL_DIAGNOSTIC__', method)
    source = output / 'DiagnosticInert.swift'; source.write_text(harness)
    (output / 'actual-diagnostic.swift').write_text(method)
    inputs = [source_root / n for n in ('PreviewSmoke.swift', 'OfflineNetworkFence.swift',
              'OfflineProviderPolicy.swift', 'test_offline_diagnostics.py', 'ci_native_offline.py',
              'external_auth_smoke.py', 'offline_provider_smoke.py')]
    receipt = dict(inputs={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
                   method_sha256=hashlib.sha256(method.encode()).hexdigest(),
                   harness_sha256=hashlib.sha256(harness.encode()).hexdigest(), commands=[])

    def save():
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')

    def command(argv, limit):
        row = dict(argv=argv, limit_seconds=limit, state='attempted'); receipt['commands'].append(row); save()
        started = time.monotonic()
        try:
            result = subprocess.run(argv, capture_output=True, text=True, timeout=limit)
            row.update(state='completed', exit=result.returncode, stdout=result.stdout, stderr=result.stderr)
            return result
        except BaseException as error:
            row.update(state='failed', error=type(error).__name__)
            raise
        finally:
            row['seconds'] = time.monotonic() - started; save()

    compiler = ['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5', '-target', 'arm64-apple-macosx14.0',
                '-O', '-D', 'PREVIEW_SMOKE', str(source), str(source_root / 'OfflineProviderPolicy.swift'),
                '-o', str(output / 'controls')]
    compiled = command(compiler, 90)
    if compiled.returncode:
        return compiled.returncode
    controlled = command([str(output / 'controls')], 5)
    if controlled.returncode:
        return controlled.returncode
    observations = json.loads(controlled.stdout)
    (output / 'observations.json').write_text(json.dumps(observations, indent=2) + '\n')
    if observations.get('passed') is not True:
        raise AssertionError('Actual diagnostic controls failed')
    strict = strict_and_registration(source_root, observations['diagnostic_object'])
    receipt['strict_and_registration'] = strict; receipt['passed'] = True; save()
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--artifacts', type=Path, required=True)
    options = parser.parse_args()
    raise SystemExit(run(options.source_root.resolve(), options.artifacts.resolve()))
