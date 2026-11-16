"""Execute actual Q1 enqueue/flush observation with held inert disk callbacks."""
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_workspace_recovery import member


class Q1ObserverBindingTests(unittest.TestCase):
    def test_observer_is_bound_when_the_write_or_flush_is_accepted(self):
        source = Path(__file__).with_name('WorkspaceStorage.swift').read_text()
        start = source.index('    #if PREVIEW_SMOKE && LOCAL_APP')
        instrumentation = source[start:source.index('    #endif', start) + len('    #endif')]
        # The successor notification layer moves the same observation seam into
        # its shared enqueue. Execute the actual owning method in either shape.
        shared_enqueue = '    private func enqueue(' in source
        enqueue = member(source, 'private func enqueue(' if shared_enqueue else
                         'func write(namespace:')
        accept = ('smokeQ1Ordinary = ordinary ? ("drafts", "owned-key", value) : nil; '
                  'enqueue(Data(value.utf8)) { _ in }') if shared_enqueue else (
                  '_ = write(namespace: "drafts", key: "owned-key", value: value) { _ in }')
        flush = member(source, 'func flush(timeout: TimeInterval = 0.5, completion: @escaping (Bool) -> Void) {')
        fixture = '''import Foundation
import CryptoKit
enum WorkspaceCheckpoint { static let limit = 1_048_576 }
@MainActor final class HeldCheckpoint {
    var callbacks: [(Bool) -> Void] = []
    func write(_ data: Data, completion: @escaping (Bool) -> Void) { callbacks.append(completion) }
    func finish(_ durable: Bool = true) { callbacks.removeFirst()(durable) }
}
@MainActor final class WorkspaceStorage {
    struct Profile { let digest = "owned-profile"; let draftKey = "owned-key" }
    let profile = Profile()
    let checkpoint = HeldCheckpoint()
    var pending = 0
    var available = true
    var values: [String: [String: String]] = ["drafts": [:], "preferences": [:]]
    func validKey(_ namespace: String, _ key: String) -> Bool { true }
    var waiters: [UUID: (Bool) -> Void] = [:]
    // INSTRUMENTATION
    // ENQUEUE
    // FLUSH
    func accept(_ value: String, ordinary: Bool = true) {
        // ACCEPT
    }
}
@main enum Controls {
    @MainActor static func main() {
        // A pre-hook write may complete after the Q1 observer is attached.
        let first = WorkspaceStorage()
        var events: [[String: Any]] = []
        WorkspaceStorage.smokeQ1Event = nil
        first.accept("before-hook")
        first.flush { _ in }
        WorkspaceStorage.smokeQ1Event = { event, _ in events.append(event) }
        first.accept("native", ordinary: false)
        first.accept("ordinary")
        first.checkpoint.finish()
        precondition(events.map { $0["kind"] as! String } == ["accepted", "accepted"],
                     "Pre-hook completion reached an observer that never accepted it")
        first.checkpoint.finish()
        first.checkpoint.finish()
        precondition(events.map { $0["sequence"] as! Int } == [2, 3, 2, 3])
        precondition(events.map { $0["kind"] as! String } == ["accepted", "accepted", "completed", "completed"])
        precondition(events[0]["writeClass"] as? String == "FIRST_CLASS")
        precondition(events[1]["writeClass"] as? String == "ordinary")
        precondition(events[2]["checkpointSHA256"] as? String == events[0]["checkpointSHA256"] as? String)
        precondition(events[3]["checkpointSHA256"] as? String == events[1]["checkpointSHA256"] as? String)

        // Replacing the global hook cannot redirect old completions or flushes.
        let second = WorkspaceStorage()
        var old: [[String: Any]] = [], successor: [[String: Any]] = []
        WorkspaceStorage.smokeQ1Event = { event, _ in old.append(event) }
        second.accept("old-owner")
        second.flush { _ in }
        WorkspaceStorage.smokeQ1Event = { event, _ in successor.append(event) }
        second.accept("successor-owner")
        second.checkpoint.finish()
        second.checkpoint.finish()
        precondition(old.map { $0["kind"] as! String } == ["accepted", "completed", "flush"])
        precondition(old.allSatisfy { $0["sequence"] as? Int == 1 })
        precondition(successor.map { $0["kind"] as! String } == ["accepted", "completed"])
        precondition(successor.allSatisfy { $0["sequence"] as? Int == 2 })

        // Retiring the global hook must not hide a known late disk failure.
        let third = WorkspaceStorage()
        var retained: [[String: Any]] = []
        WorkspaceStorage.smokeQ1Event = { event, _ in retained.append(event) }
        third.accept("accepted-before-retirement")
        WorkspaceStorage.smokeQ1Event = nil
        third.checkpoint.finish(false)
        precondition(retained.count == 2 && retained[1]["kind"] as? String == "completed")
        precondition(retained[1]["durable"] as? Bool == false && !third.available)
        print("PASS actual enqueue/flush observer binding, native/ordinary pairing and late failure")
    }
}
'''.replace('    // INSTRUMENTATION', instrumentation).replace('    // ENQUEUE', enqueue).replace('    // FLUSH', flush).replace('        // ACCEPT', accept).replace(
            'FIRST_CLASS', 'native-notifications' if shared_enqueue else 'ordinary')
        with tempfile.TemporaryDirectory(prefix='nac-q1-observer-pure-') as temporary:
            root = Path(temporary)
            swift, binary = root / 'Controls.swift', root / 'controls'
            swift.write_text(fixture)
            compiled = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-parse-as-library',
                '-D', 'PREVIEW_SMOKE', '-D', 'LOCAL_APP', str(swift), '-o', str(binary)],
                capture_output=True, text=True, timeout=60)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)


if __name__ == '__main__':
    unittest.main()
