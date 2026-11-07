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

    def test_declared_deltas_preserve_approval_and_remaining_snapshot(self):
        """Source preservation only; this does not execute Swift or native paint."""
        source = self.source('WorkspaceSmoke.swift')
        script = re.search(r'static let captureReadinessScript = #"""\n([\s\S]*?)\n    """#', source)[1]
        pattern = r'const owned = [\s\S]*?;\n'
        self.assertEqual(re.search(pattern, script)[0], re.search(pattern, self.frozen('originalScript'))[0])
        pattern = r'const settled = [\s\S]*?;\n'
        original = re.search(pattern, self.frozen('originalScript'))[0]
        old = '(!sessionState.message_page || sessionState.message_page.start === 0 && sessionState.message_page.total === 2)'
        new = ('sessionState.message_page?.start === 0 && sessionState.message_page?.end === 2 &&\n'
               '        sessionState.message_page?.total === 2 && sessionState.message_page?.has_older === false')
        self.assertIn(old, original)
        self.assertEqual(re.search(pattern, script)[0], original.replace(old, new))
        capture_start = source.index('    func captureReadiness(')
        prefix = source[capture_start:source.index('        guard var value = try await', capture_start)]
        canonical = prefix[prefix.index('            canonicalState ='):prefix.index('            arguments["sessionState"]')]
        self.assertIn("'?include_sessions=false'", canonical)
        self.assertIn('Canonical snapshot owner differs', canonical)
        self.assertNotIn('.filter', prefix)
        self.assertNotIn('.drop', prefix)
        projected = prefix.replace('        var canonicalState: [String: Any]?\n', '').replace(canonical, '')
        projected = projected.replace(" + '?message_limit=3&include_system=false&include_sessions=false'", '')
        file_branch = r'''        if case let .file(id, path, _) = target {
            arguments["fileState"] = try await js("const r=await fetch('/sessions/' + \(quote(id)) + '/workspace/file?' + new URLSearchParams({path:\(quote(path))}),{cache:'no-store'}); if(!r.ok)throw Error('File snapshot unavailable'); return await r.json();")
        }
'''
        self.assertEqual(projected.count(file_branch), 1)
        projected = projected.replace(file_branch, '')
        self.assertEqual(projected, self.frozen('originalCapturePrefix'))
        self.assertIn('value["canonical_snapshot"] = canonicalState', source)
        # Keep the entire original capture flow except the two diagnostic-only guards.
        snapshot = self.frozen('originalSnapshotBlock')
        self.assertEqual(snapshot.count('        if !painting {\n'), 1)
        self.assertEqual(snapshot.count('        if !ready || !afterSurface {\n'), 1)
        snapshot = snapshot.replace('        if !painting {\n',
                                    '        if target != nil && !painting {\n', 1)
        snapshot = snapshot.replace('        if !ready || !afterSurface {\n',
                                    '        if target != nil && (!ready || !afterSurface) {\n', 1)
        # Preserve all capture checks/ordering except the explicit paint commit
        # repair. Behavioral fault coverage executes the entire exact method.
        declaration = '    func snapshot(_ name: String, expecting target: CaptureTarget? = nil) async throws {\n'
        snapshot = snapshot.replace(declaration, declaration + '''        var targetedCaptureCompleted = false
        defer {
            if target != nil && !targetedCaptureCompleted {
                checks["visible-paint"] = ["status": "unavailable", "detail": "Requested snapshot did not complete all capture and identity checks; inspect retained diagnostics"]
                record(["paint_diagnostics": paintDiagnostics, "checks": checks])
            }
        }
''', 1)
        old_pass = '''        } else if target != nil && checks["visible-paint"] == nil {
            checks["visible-paint"] = ["status": "pass", "detail": "Fresh animation frame and revealed transcript before native snapshot; inspect retained PNGs"]
'''
        self.assertEqual(snapshot.count(old_pass), 1)
        snapshot = snapshot.replace(old_pass, '')
        final_guard = '''            throw PreviewError.message("Capture \\(name) did not reach and retain requested visible content")
        }
'''
        self.assertEqual(snapshot.count(final_guard), 1)
        snapshot = snapshot.replace(final_guard, final_guard + '''        if target != nil {
            if checks["visible-paint"] == nil {
                checks["visible-paint"] = ["status": "pass", "detail": "Fresh frame, retained PNG and requested content/identity checks completed; inspect retained PNGs"]
            }
            targetedCaptureCompleted = true
            record(["paint_diagnostics": paintDiagnostics, "checks": checks])
        }
''', 1)
        self.assertEqual(source[source.index('    func snapshot('):], snapshot)

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

    def test_visible_diagnostics_are_bounded_and_hash_content_with_separate_raw_snapshot(self):
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


class CanonicalFixtureSourceTests(unittest.TestCase):
    def test_strict_owned_binding_precedes_provider_and_expectation(self):
        root = Path(__file__).parent
        fixture = (root / 'WorkspaceFixture.swift').read_text()
        journey = (root / 'WorkspaceJourneys.swift').read_text()
        smoke = (root / 'WorkspaceSmoke.swift').read_text()
        self.assertIn('try WorkspaceFixture.prepareExternalReadTarget(in: profile.root)', smoke)
        for token in ('realpath(root.path, nil)', 'realpath(requested, nil)', 'O_EXCL | O_NOFOLLOW',
                      'O_RDONLY | O_NOFOLLOW | O_NONBLOCK', 'bound.st_dev == identity.device',
                      'bound.st_ino == identity.inode', 'bound.st_nlink == 1',
                      'owner.st_ino == identity.rootInode', 'owner.st_uid == getuid()',
                      'owner.st_mode & mode_t(S_IRWXG | S_IRWXO) == 0'):
            self.assertIn(token, fixture)
        self.assertIn('guard let path = try? requireExternalReadTarget()', fixture)
        self.assertIn('"WK_APPROVAL_FIXTURE_INVALID"', fixture)
        self.assertLess(journey.index('_ = try WorkspaceFixture.requireExternalReadTarget()'),
                        journey.index('try await self.send("WK_APPROVAL")'))
        self.assertIn('let path = try WorkspaceFixture.requireExternalReadTarget()', journey)
        self.assertNotIn('resolvingSymlinksInPath', journey)
        # Static checks only: Swift compilation and OS/broker characterization UNRUN.


if __name__ == '__main__':
    unittest.main()
