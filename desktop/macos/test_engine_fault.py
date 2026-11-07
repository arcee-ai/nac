"""Execute the fixture fault owner's actual guards with inert signal ports."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import unittest

from test_workspace_recovery import member


class OwnedEngineFaultTests(unittest.TestCase):
    def test_exact_unreaped_owner_is_the_only_one_shot_signal_target(self):
        source = Path(__file__).with_name('PreviewEngine.swift').read_text()
        owner, run = source.split('private final class EngineRun {', 1)
        wrapper = member(owner, 'func crashOwnedEngineForSmoke(') + member(owner, 'var smokeFaultReceipt:')
        methods = ''.join(member(run, declaration) for declaration in [
            'func crashOwnedEngineForSmoke(', 'func recordSmokeFaultReap(', 'var receipt:',
        ])
        fields = '\n'.join(re.findall(r'^    private(?:\(set\))? var smoke(?:CrashUsed|FaultReceipt)[^\n]*', run, re.M))
        self.assertEqual(len(fields.splitlines()), 2)
        fixture = '''import Foundation
import Darwin
import Dispatch
struct EngineReceipt { let incarnation: String }
final class ProtocolPort {
    var ready: EngineReceipt? = EngineReceipt(incarnation: "owned")
}
final class EngineRun {
    var pid: pid_t = 73
    var exitSource: Int? = 1
    var channelFD: Int32 = 3
    var stopping = false, failed = false
    let protocolState = ProtocolPort()
    // FIELDS
    // METHODS
}
// This independent forwarding port never delegates to the real signal default.
final class ForwardingRun {
    var receipt: EngineReceipt? = EngineReceipt(incarnation: "owned")
    var calls: [String] = []
    var smokeFaultReceipt: [String: Any]?
    func crashOwnedEngineForSmoke(expectedIncarnation: String) -> Bool {
        calls.append(expectedIncarnation); smokeFaultReceipt = ["reaped": false]; return true
    }
}
final class PreviewEngine {
    var run: ForwardingRun?
    private var smokeFaultRun: ForwardingRun?
    // WRAPPER
}
@main enum Controls {
    static func main() throws {
        var calls: [[Int32]] = []
        let send: (pid_t, Int32) -> Int32 = { pid, value in calls.append([pid, value]); return 0 }
        let refusals: [(EngineRun) -> Void] = [
            { $0.pid = 0 }, { $0.pid = -1 }, { $0.exitSource = nil },
            { $0.channelFD = -1 }, { $0.stopping = true }, { $0.failed = true },
            { $0.protocolState.ready = nil },
            { $0.protocolState.ready = EngineReceipt(incarnation: "successor") }
        ]
        for configure in refusals {
            let run = EngineRun(); configure(run)
            precondition(!run.crashOwnedEngineForSmoke(expectedIncarnation: "owned", signal: send))
        }
        let wrong = EngineRun()
        precondition(!wrong.crashOwnedEngineForSmoke(expectedIncarnation: "foreign", signal: send))
        precondition(calls.isEmpty)

        let live = EngineRun()
        precondition(live.crashOwnedEngineForSmoke(expectedIncarnation: "owned", signal: send))
        precondition(calls == [[73, SIGKILL]])
        precondition(!live.crashOwnedEngineForSmoke(expectedIncarnation: "owned", signal: send))
        precondition(calls.count == 1 && live.smokeFaultReceipt?["reaped"] as? Bool == false)
        live.recordSmokeFaultReap(waitedPID: 73, status: SIGKILL)
        precondition(live.smokeFaultReceipt?["reaped"] as? Bool == true)
        precondition(live.smokeFaultReceipt?["raw_wait_status"] as? Int == Int(SIGKILL))
        precondition(live.smokeFaultReceipt?["owned_pid"] as? Int == 73)
        live.pid = 0
        precondition(!live.crashOwnedEngineForSmoke(expectedIncarnation: "owned", signal: send))

        let failed = EngineRun()
        var refusedCalls = 0
        let refuse: (pid_t, Int32) -> Int32 = { _,_ in refusedCalls += 1; return -1 }
        precondition(!failed.crashOwnedEngineForSmoke(expectedIncarnation: "owned", signal: refuse))
        precondition(!failed.crashOwnedEngineForSmoke(expectedIncarnation: "owned", signal: refuse))
        precondition(refusedCalls == 1 && failed.smokeFaultReceipt?["syscall_result"] as? Int == -1)
        failed.recordSmokeFaultReap(waitedPID: -1, status: 0)
        precondition(failed.smokeFaultReceipt?["reaped"] as? Bool == false)
        precondition(failed.smokeFaultReceipt?["waited_pid"] as? Int == -1)
        let ordinary = EngineRun()
        ordinary.recordSmokeFaultReap(waitedPID: 73, status: 0)
        precondition(ordinary.smokeFaultReceipt == nil)

        let owner = PreviewEngine()
        precondition(!owner.crashOwnedEngineForSmoke(expectedIncarnation: "owned"))
        let old = ForwardingRun(); owner.run = old
        precondition(!owner.crashOwnedEngineForSmoke(expectedIncarnation: "foreign"))
        let successor = ForwardingRun()
        successor.receipt = EngineReceipt(incarnation: "successor")
        owner.run = successor
        precondition(!owner.crashOwnedEngineForSmoke(expectedIncarnation: "owned"))
        precondition(old.calls.isEmpty && successor.calls.isEmpty)
        precondition(owner.crashOwnedEngineForSmoke(expectedIncarnation: "successor"))
        precondition(old.calls.isEmpty && successor.calls == ["successor"])
        // Reap and successor launch can precede RecoverySmoke's next poll.
        successor.smokeFaultReceipt = ["reaped": true, "raw_wait_status": Int(SIGKILL)]
        owner.run = ForwardingRun()
        precondition(owner.smokeFaultReceipt?["reaped"] as? Bool == true)
        precondition(owner.smokeFaultReceipt?["raw_wait_status"] as? Int == Int(SIGKILL))
        owner.run = nil
        precondition(owner.smokeFaultReceipt?["reaped"] as? Bool == true)
        print(String(data: try JSONSerialization.data(withJSONObject: live.smokeFaultReceipt!), encoding: .utf8)!)
    }
}
'''.replace('    // FIELDS', fields).replace('    // METHODS', methods).replace('    // WRAPPER', wrapper)
        with tempfile.TemporaryDirectory(prefix='nac-engine-fault-pure-') as temporary:
            root = Path(temporary)
            swift, binary = root / 'Controls.swift', root / 'controls'
            swift.write_text(fixture)
            compiled = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-parse-as-library',
                str(swift), '-o', str(binary)], capture_output=True, text=True, timeout=60)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
            fact = json.loads(executed.stdout)
            self.assertTrue(os.WIFSIGNALED(fact['raw_wait_status']))
            self.assertEqual(os.WTERMSIG(fact['raw_wait_status']), signal.SIGKILL)
            self.assertEqual(fact['waited_pid'], fact['owned_pid'])
            self.assertEqual(fact['requested_incarnation'], 'owned')


if __name__ == '__main__':
    unittest.main()
