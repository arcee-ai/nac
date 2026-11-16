"""Verbatim navigation delegate/deadline controls; not actual AppKit/WK acceptance."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

from test_workspace_recovery import member

OWNER = Path(__file__).parent


class WorkspaceNavigationTests(unittest.TestCase):
    def test_unadmitted_starts_preserve_tracked_completion_and_deadline(self):
        source = Path(os.environ.get('NAC_NAVIGATION_SOURCE', OWNER / 'PreviewApp.swift')).read_text()
        declarations = [
            'func webView(_ webView: WKWebView, didStartProvisionalNavigation',
            'func webView(_ webView: WKWebView, didFinish',
            'func webView(_ webView: WKWebView, didFailProvisionalNavigation',
            'func webView(_ webView: WKWebView, didFail navigation:',
        ]
        delegates = ''.join(member(source, declaration) for declaration in declarations)
        replacement = member(source, 'func replaceWorkspace(')
        marker = 'DispatchQueue.main.asyncAfter(deadline: .now() + 10) {'
        self.assertEqual(replacement.count(marker), 1)
        start = replacement.index(marker)
        end = replacement.index('\n            }', start) + len('\n            }')
        closure = replacement[start:end]
        self.assertTrue(closure.startswith(marker + ' [weak self, weak replacement] in\n'))
        # Only scheduling syntax is replaced by an explicit port. Preserve the
        # capture list, guard and callback bytes from the production closure.
        deadline = 'return {' + closure[len(marker):]
        fixture = (OWNER / 'WorkspaceNavigationFixture.swift').read_text()
        self.assertEqual(fixture.count('// EXPECT_PATHS'), 1)
        fixture = fixture.replace('// EXPECT_PATHS', 'let expectsPaths = ' +
            ('true' if 'nativePaths?.navigationStarted' in delegates else 'false'))
        for tag, contents in [('// APP_DELEGATES', delegates), ('// APP_DEADLINE', deadline)]:
            self.assertEqual(fixture.count(tag), 1)
            fixture = fixture.replace(tag, contents)
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        scenarios = [
            'tracked-load', 'tracked-url-unset', 'blank-finish', 'blank-timeout',
            'nil-start', 'nil-commands', 'off-origin', 'foreign-view', 'stopped', 'failed',
            'stale-engine', 'stale-known', 'same-origin-reload', 'old-failure',
            'current-failure', 'current-provisional-failure',
        ]
        with tempfile.TemporaryDirectory(prefix='nac-navigation-owner-') as directory:
            path = Path(directory)
            swift = path / 'NavigationOwner.swift'
            swift.write_text(fixture)
            binary = path / 'navigation-owner'
            compiled = subprocess.run([compiler, '-parse-as-library', '-sdk', sdk, '-swift-version', '5',
                '-target', 'arm64-apple-macosx14.0', '-warnings-as-errors', '-Onone',
                str(swift), '-o', str(binary)], text=True, capture_output=True, timeout=120, check=False)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            for scenario in scenarios:
                with self.subTest(scenario=scenario):
                    executed = subprocess.run([str(binary), scenario], text=True,
                        capture_output=True, timeout=10, check=False)
                    self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
                    print(executed.stdout, end='')


if __name__ == '__main__':
    unittest.main()
