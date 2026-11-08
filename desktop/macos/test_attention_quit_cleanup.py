"""Source safety fences, not an AppKit execution test.

The RED witness is the concrete cleanup -> interactive finish -> termination ->
unknown-activity confirmation -> front/sheet call chain. GREEN checks its new
owning entry and presentation fences. Actual lifecycle assertions are also
provided in AttentionFixtureLifecycleTests.swift; this unit may only typecheck
that program. No native executable or GUI operation is invoked here.
"""
from pathlib import Path
import re
import unittest

OWNER = Path(__file__).resolve().parent


def body(source, signature):
    start = source.index(signature)
    opening = source.index('{', start)
    depth = 1
    for end in range(opening + 1, len(source)):
        depth += (source[end] == '{') - (source[end] == '}')
        if depth == 0:
            return source[opening + 1:end]
    raise AssertionError('Unbalanced source body')


class CleanupSourceFences(unittest.TestCase):
    def test_cleanup_does_not_reenter_the_interactive_unknown_activity_path(self):
        smoke = (OWNER / 'AttentionSmoke.swift').read_text()
        cleanup = re.search(r'case "cleanup":([^\n]+)', smoke)[1]
        self.assertNotIn('stopFixture()', cleanup,
            'RED: cleanup -> stopFixture -> NSApp.terminate -> unknown Activity -> '
            'present -> makeKeyAndOrderFront + beginSheetModal')
        self.assertIn('cleanupAttentionFixture()', cleanup)
        quit_source = (OWNER / 'AppQuit.swift').read_text()
        cleanup = body(quit_source, 'func cleanupAttentionFixture()')
        self.assertIn('lifecycle.beginAttentionFixtureCleanup()', cleanup)
        self.assertIn('beginStop(wait)', cleanup)
        self.assertNotIn('requestQuit(', cleanup)
        self.assertNotIn('Activity(', cleanup)
        self.assertNotIn('endSheet', cleanup)
        self.assertNotIn('confirmation = nil', cleanup)
        self.assertIn('app.beginShutdown', body(quit_source, 'private func beginStop('))

    def test_existing_and_queued_confirmation_cannot_be_presented_or_answered_by_cleanup(self):
        source = (OWNER / 'AppQuit.swift').read_text()
        cleanup = body(source, 'func cleanupAttentionFixture()')
        self.assertIn('fixtureStopTimer?.invalidate()', cleanup)
        present = body(source, 'private func present(')
        self.assertLess(present.index('guard !attentionFixtureCleanup'), present.index('let alert = NSAlert()'))
        terminate = body(source, 'func shouldTerminate()')
        self.assertLess(terminate.index('if attentionFixtureCleanup'), terminate.index('lifecycle.requestQuit('))
        self.assertIn('case .finished = lifecycle.phase', terminate)
        self.assertIn('return .terminateCancel', terminate)

    def test_timeout_and_retirement_do_not_front_or_rekey_after_cleanup(self):
        source = (OWNER / 'AppQuit.swift').read_text()
        timeout = body(source, 'private func waitForStop(')
        self.assertLess(timeout.index('if self.attentionFixtureCleanup'), timeout.index('self.app.showShutdownStatus'))
        guarded = body(timeout, 'if self.attentionFixtureCleanup')
        self.assertIn('return', guarded)
        self.assertNotIn('makeKey', guarded)
        self.assertNotIn('showShutdownStatus', guarded)
        completion = body(source, 'private func beginStop(')
        late = completion.split('case .settledAfterTimeout:', 1)[1]
        self.assertLess(late.index('if self.attentionFixtureCleanup'), late.index('self.app.showShutdownStatus'))
        preview = (OWNER / 'PreviewApp.swift').read_text()
        retirement = body(preview, 'private func continueShutdown(')
        self.assertIn('if !quit.attentionFixtureCleanup { window.makeFirstResponder(nil) }', retirement)
        recovery = body((OWNER / 'WorkspaceRecovery.swift').read_text(), 'private func cancelConfirmation()')
        self.assertLess(recovery.index('if app.quit.attentionFixtureCleanup'), recovery.index('app.window.endSheet'))
        self.assertNotIn('endSheet', body(recovery, 'if app.quit.attentionFixtureCleanup'))
        old_retirement = (OWNER / 'WorkspaceRetirement.swift').read_text()
        self.assertIn('if !attentionFixtureCleanup() { view?.window?.makeFirstResponder(nil) }', old_retirement)
        self.assertIn('self?.quit.attentionFixtureCleanup ?? true', preview)

if __name__ == '__main__':
    unittest.main()
