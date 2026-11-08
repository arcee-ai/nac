"""Execute the actual file capture probe with modeled DOM, never native pixels."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest
from test_workspace_recovery import member


class FileCaptureControls(unittest.TestCase):
    def test_actual_files_journey_supplies_the_file_target(self):
        owner = Path(__file__).parent
        source = (owner / 'WorkspaceSmoke.swift').read_text()
        target = member(source, 'enum CaptureTarget {')
        journeys = Path(os.environ.get('NAC_WORKSPACE_JOURNEYS_SOURCE', owner / 'WorkspaceJourneys.swift')).read_text()
        block = journeys[journeys.index('        await check("files") {'):journeys.index('        await check("git") {')]
        fixture = '''import Foundation
@MainActor final class WorkspaceSmoke {
    // TARGET
    let sessionID = "owned-session"
    var captured: CaptureTarget?
    func check(_ name: String, _ action: () async throws -> String) async { _ = try! await action() }
    func navigate(_ path: String) async throws {}
    func button(_ title: String) async throws {}
    func quote(_ value: String) -> String { String(data: try! JSONSerialization.data(withJSONObject: [value]), encoding: .utf8)!.dropFirst().dropLast().description }
    func js(_ script: String) async throws -> Any { true }
    func waitJS(_ detail: String, _ script: String) async throws {}
    func snapshot(_ name: String, expecting target: CaptureTarget?) async throws { captured = target }
    func run() async {
        // JOURNEY
    }
}
@main enum FileTargetTests {
    @MainActor static func main() async {
        let smoke = WorkspaceSmoke()
        await smoke.run()
        guard case let .file(id, path, content) = smoke.captured,
              id == smoke.sessionID, path == "workspace.ts",
              content == "export const workspaceFileFixture = 351;\\n" else {
            print("Actual Files journey did not bind its file capture target"); exit(42)
        }
    }
}
'''.replace('    // TARGET', target).replace('        // JOURNEY', block)
        with tempfile.TemporaryDirectory(prefix='nac-file-target-pure-') as temporary:
            root = Path(temporary)
            swift, binary = root / 'FileTarget.swift', root / 'file-target'
            swift.write_text(fixture)
            compiled = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-warnings-as-errors',
                '-parse-as-library', str(swift), '-o', str(binary)], capture_output=True, text=True, timeout=60)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)

    def test_actual_row_wait_keeps_its_deadline_and_engine_failure(self):
        owner = Path(__file__).parent
        wait = member((owner / 'WorkspaceSmoke.swift').read_text(), 'func waitJS(')
        fixture = r'''import Foundation
struct Date: Comparable {
    static var now: Double = 0
    let value: Double
    init() { value = Self.now }
    init(_ value: Double) { self.value = value }
    func addingTimeInterval(_ seconds: TimeInterval) -> Date { Date(value + seconds) }
    static func < (a: Date, b: Date) -> Bool { a.value < b.value }
}
enum Task {
    static func sleep(nanoseconds: UInt64) async throws { Date.now += Double(nanoseconds) / 1e9 }
}
enum PreviewError: Error { case message(String) }
struct Root { let path = "owned-profile" }
struct Profile { let root = Root() }
struct Engine { let pid = 351 }
@MainActor final class App {
    var failure: String?
    let profile: Profile? = Profile()
    let engine = Engine()
}
@MainActor final class WorkspaceSmoke {
    let app = App()
    var polls = 0
    var records = 0
    var admitAt = Int.max
    func record(_ value: [String: Any]) { records += 1 }
    func js(_ source: String) async throws -> Any { polls += 1; return polls >= admitAt }
    // ACTUAL_WAIT
}
@main enum WaitControls {
    @MainActor static func main() async throws {
        Date.now = 0
        let delayed = WorkspaceSmoke(); delayed.admitAt = 5
        try await delayed.waitJS("owned row", "readonly")
        precondition(delayed.polls == 5 && delayed.records == 5)
        precondition(Date.now > 0.19 && Date.now < 0.21)
        Date.now = 0
        let absent = WorkspaceSmoke()
        do { try await absent.waitJS("owned row", "readonly"); fatalError("Missing timeout") }
        catch PreviewError.message(let text) { precondition(text == "Timed out waiting for owned row") }
        precondition(Date.now >= 20 && Date.now < 20.051)
        precondition(absent.polls >= 399 && absent.polls <= 401)
        Date.now = 0
        let failed = WorkspaceSmoke(); failed.app.failure = "owned engine stopped"
        do { try await failed.waitJS("owned row", "readonly"); fatalError("Missing engine failure") }
        catch PreviewError.message(let text) { precondition(text == "owned engine stopped") }
        precondition(failed.polls == 0 && failed.records == 1 && Date.now == 0)
    }
}
'''.replace('    // ACTUAL_WAIT', wait)
        with tempfile.TemporaryDirectory(prefix='nac-files-row-wait-pure-') as temporary:
            root = Path(temporary)
            swift, binary = root / 'RowWait.swift', root / 'row-wait'
            swift.write_text(fixture)
            compiled = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-warnings-as-errors',
                '-parse-as-library', str(swift), '-o', str(binary)], capture_output=True, text=True, timeout=60)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)

    def test_actual_git_block_selects_diff_and_rechecks_owned_file(self):
        owner = Path(__file__).parent
        target = member((owner / 'WorkspaceSmoke.swift').read_text(), 'enum CaptureTarget {')
        journeys = Path(os.environ.get('NAC_WORKSPACE_JOURNEYS_SOURCE', owner / 'WorkspaceJourneys.swift')).read_text()
        block = journeys[journeys.index('        await check("git") {'):journeys.index('        await check("approvals") {')]
        fixture = r'''import Foundation
        enum PreviewError: Error { case message(String) }
        @MainActor final class WorkspaceSmoke {
            // TARGET
            let sessionID = "owned-session"
            var events: [String] = []
            func quote(_ value: String) -> String { String(data: try! JSONSerialization.data(withJSONObject: [value]), encoding: .utf8)!.dropFirst().dropLast().description }
            func check(_ name: String, _ action: () async throws -> String) async { _ = try! await action() }
            func navigate(_ panel: String) async throws { events.append("navigate:" + panel) }
            func button(_ title: String) async throws { events.append("button:" + title) }
            func require(_ title: String, _ script: String) async throws { events.append(title) }
            func waitJS(_ title: String, _ script: String) async throws { events.append(title) }
            func js(_ script: String) async throws -> Any {
                if script.contains("Show panel") { return false }
                precondition(script.contains("rows[0].click()")); events.append("one-row-click"); return true
            }
            func captureReadiness(_ target: CaptureTarget) async throws -> [String: Any] {
                guard case let .file(id,path,content) = target, id == sessionID, path == "workspace.ts",
                    content == "export const workspaceFileFixture = 351;\n" else { fatalError("Wrong Git file binding") }
                events.append("file-readiness"); return ["ready":true]
            }
            func run() async {
                // GIT
            }
        }
        @main enum GitControls {
            @MainActor static func main() async {
                let smoke = WorkspaceSmoke(); await smoke.run()
                precondition(smoke.events == ["Git branch unavailable", "Git changed-file receipt missing",
                    "navigate:files", "button:Diff of changed files", "owned Git workspace.ts row",
                    "one-row-click", "owned rendered Git diff", "file-readiness",
                    "Owned Git diff changed during file readback"])
            }
        }
'''.replace('            // TARGET', target).replace('                // GIT', block)
        with tempfile.TemporaryDirectory(prefix='nac-git-owned-pure-') as temporary:
            root = Path(temporary)
            swift, binary = root / 'GitBlock.swift', root / 'git-block'
            swift.write_text(fixture)
            compiled = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-warnings-as-errors',
                '-parse-as-library', str(swift), '-o', str(binary)], capture_output=True, text=True, timeout=60)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)

    def test_exact_file_target_and_negative_controls(self):
        result = subprocess.run(['node', '--test', str(Path(__file__).with_suffix('.mjs'))],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
