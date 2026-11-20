"""Exercise the actual active fixture's delayed-ready predicate without OS input."""
from pathlib import Path
import subprocess
import platform
import shutil
import tempfile
import unittest

SOURCE = Path(__file__).with_name('DeviceAuthSmoke.swift').read_text()


class DeviceAuthReadyTests(unittest.TestCase):
    def test_real_click_script_ignores_heading_loading_and_disabled_action(self):
        script = SOURCE.split('private static let clickScript = #"""', 1)[1].split('"""#', 1)[0]
        probe = r'''
const assert = require('node:assert/strict');
const fs = require('node:fs');
const run = new Function('document', 'title', 'inCard', fs.readFileSync(0, 'utf8'));
let clicked = 0, buttons = [];
const card = {textContent:'Arcee sign-in Checking authorization',querySelectorAll:()=>buttons};
let account = card;
const document = {querySelector(selector) {
  assert.equal(selector, '[role=group][aria-label="Arcee account"]');
  return account;
}};
const sample = () => run(document, 'Sign in with Arcee', true);
assert.equal(card.textContent.includes('Arcee sign-in'), true);
assert.equal(sample(), false); assert.equal(clicked, 0);
const action = {textContent:'Sign in with Arcee',disabled:true,click(){clicked++;}};
buttons = [action]; assert.equal(sample(), false); assert.equal(clicked, 0);
account=null; action.disabled=false; assert.equal(sample(), false); assert.equal(clicked, 0);
account=card;
action.disabled=false; assert.equal(sample(), true); assert.equal(clicked, 1);
console.log('actual predicate waited for the enabled action and clicked once');
'''
        result = subprocess.run(['node', '-e', probe], input=script, capture_output=True,
                                text=True, check=True, timeout=10)
        self.assertIn('clicked once', result.stdout)

    @unittest.skipUnless(platform.system() == "Darwin" and shutil.which("xcrun"),
                         "Actual Darwin Swift compiler is required")
    def test_actual_swift_wait_and_active_closure_stop_after_one_click_or_error(self):
        closure = SOURCE.split('                    try await wait("ready Arcee sign-in action") {', 1)[1]
        closure = 'try await wait("ready Arcee sign-in action") {' + closure.split(
            '                    evidence["start_command_issued"]', 1)[0]
        wait = SOURCE.split('    private func wait(', 1)[1].split('    private func write()', 1)[0]
        wait = '    private func wait(' + wait
        # Keep the actual 35s/50ms bounds; successful samples finish immediately.
        self.assertIn('addingTimeInterval(35)', wait)
        self.assertIn('50_000_000', wait)
        swift = r'''
import Foundation
struct PreviewError: Error { static func message(_ text: String) -> Self { Self() } }
@MainActor final class Harness {
    final class App { var failure: String? }
    let app = App()
    static let clickScript = "exact fixture script"
    var samples = 0, clicks = 0, shouldThrow = false
    func checkpoint() {}
    func js(_ script: String, arguments: [String: Any]) async throws -> Any {
        precondition(script == Self.clickScript)
        precondition(arguments["title"] as? String == "Sign in with Arcee")
        precondition(arguments["inCard"] as? Bool == true)
        samples += 1
        if shouldThrow { throw PreviewError.message("document retired") }
        if samples < 3 { return false }
        clicks += 1
        return true
    }
    func attempt() async throws {
CLOSURE
    }
WAIT
}
@main struct Probe {
    @MainActor static func main() async throws {
        let delayed = Harness()
        try await delayed.attempt()
        precondition(delayed.samples == 3 && delayed.clicks == 1)
        let retired = Harness(); retired.shouldThrow = true
        do { try await retired.attempt(); preconditionFailure("retired document accepted") } catch {}
        precondition(retired.samples == 1 && retired.clicks == 0)
        let failed = Harness(); failed.app.failure = "failed"
        do { try await failed.attempt(); preconditionFailure("failed app accepted") } catch {}
        precondition(failed.samples == 0 && failed.clicks == 0)
        print("active Swift readiness sampled atomically; no successful click or failure replayed")
    }
}
'''.replace('CLOSURE', closure).replace('WAIT', wait)
        with tempfile.TemporaryDirectory(prefix='nac-device-ready-controls-') as temporary:
            source, executable = Path(temporary) / 'Probe.swift', Path(temporary) / 'probe'
            source.write_text(swift)
            subprocess.run(['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5',
                            str(source), '-o', str(executable)], check=True, capture_output=True, timeout=90)
            result = subprocess.run([str(executable)], check=True, capture_output=True, text=True, timeout=10)
            self.assertIn('no successful click or failure replayed', result.stdout)
