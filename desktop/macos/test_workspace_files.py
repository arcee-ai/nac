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

    def test_exact_file_target_and_negative_controls(self):
        result = subprocess.run(['node', '--test', str(Path(__file__).with_suffix('.mjs'))],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
