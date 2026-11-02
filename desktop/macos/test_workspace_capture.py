from pathlib import Path
import re
import subprocess
import unittest


class WorkspaceCaptureTests(unittest.TestCase):
    def source(self, name):
        return (Path(__file__).parent / name).read_text()

    def frozen(self, name):
        fixture = self.source('workspace/capture-readiness-24d.mjs')
        return re.search(r'export const ' + name + r' = String.raw`([\s\S]*?)`;', fixture)[1]

    def test_actual_capture_probe_rejects_premature_views_and_accepts_revealed_content(self):
        result = subprocess.run(['node', '--test', str(Path(__file__).with_suffix('.mjs'))],
                                capture_output=True, text=True)
        print(result.stdout, end='')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_diagnostic_changes_preserve_original_assertions_fetches_and_entire_snapshot(self):
        """Source preservation only; this does not execute Swift or native paint."""
        source = self.source('WorkspaceSmoke.swift')
        script = re.search(r'static let captureReadinessScript = #"""\n([\s\S]*?)\n    """#', source)[1]
        for declaration in ['owned', 'settled']:
            pattern = r'const ' + declaration + r' = [\s\S]*?;\n'
            self.assertEqual(re.search(pattern, script)[0], re.search(pattern, self.frozen('originalScript'))[0])
        prefix = source[source.index('    func captureReadiness('):source.index('        guard var value = try await')]
        self.assertEqual(prefix, self.frozen('originalCapturePrefix'))
        self.assertEqual(source[source.index('    func snapshot('):], self.frozen('originalSnapshotBlock'))

    def test_goal_dependency_source_blocks_all_actions_without_changing_the_success_branch(self):
        """Structural Swift guard check, not a native goal-service execution."""
        source = self.source('WorkspaceJourneys.swift')
        start = source.index('        if checks["approvals"]?["status"] as? String == "pass" {')
        block = source[start:source.index('        await check("projects") {', start)]
        yes, no = block.split('        } else {\n', 1)
        body = yes.split('\n', 1)[1]
        original = ''.join(line[4:] if line.startswith('    ') else line for line in body.splitlines(keepends=True))
        self.assertEqual(original, self.frozen('originalGoalBlock'))
        self.assertIn('"status": "fail", "blocked_by": "approvals", "executed": false', no)
        self.assertNotRegex(no, r'\b(send|js|waitJS|button|fill|navigate)\(')
        self.assertNotIn('webView', no)
        self.assertIn('record(["checks": checks])', no)

    def test_diagnostic_caps_and_hash_source_do_not_filter_guard_inputs_or_log_message_text(self):
        """Check declared source bounds; Swift helper runtime is unqualified."""
        source = self.source('WorkspaceSmoke.swift')
        result_at = source.index('        guard var value = try await')
        summary = source[result_at:source.index('    func diagnosticField(')]
        for literal in ['messages.prefix(32)', 'message.keys.sorted().prefix(16)',
                        'requests.prefix(4)', 'resources.prefix(8)',
                        'messages.count > 32', 'requests.count > 4', 'resources.count > 8']:
            self.assertIn(literal, summary)
        self.assertIn('"content": diagnosticField(message["content"])', summary)
        self.assertNotIn('diagnosticField(message["content"], text: true)', summary)
        helper = source[source.index('    func diagnosticField('):source.index('    func snapshot(')]
        self.assertIn('Data(string.utf8)', helper)
        self.assertIn('String(string.prefix(1024))', helper)
        self.assertIn('string.count > 1024', helper)
        self.assertIn('if text {', helper)
        self.assertIn('result["json_sha256"]', helper)
        self.assertIn('[.sortedKeys, .fragmentsAllowed]', helper)


if __name__ == '__main__':
    unittest.main()
