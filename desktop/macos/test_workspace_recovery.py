"""Headless execution of verbatim recovery methods; no AppKit/WK/OS claim.

Run under the allocated compiler/pure-test gate. The concrete app, readiness,
retirement and button values are doubles. AppLifecycle and the recovery Task,
generation/engine fences, catch and action presentation are production source.
"""

from pathlib import Path
import os
import re
import subprocess
import tempfile
import unittest


OWNER = Path(__file__).parent


def member(source, declaration):
    matches = list(re.finditer(r'^    ' + re.escape(declaration), source, re.M))
    if len(matches) != 1:
        raise AssertionError(f'Expected exactly one {declaration}')
    start = matches[0].start()
    first_end = source.index('\n', start)
    end = first_end if source[first_end - 1] == '}' else source.index('\n    }', first_end) + 6
    return source[start:end] + '\n'


class WorkspaceRecoveryTests(unittest.TestCase):
    def test_quit_during_readiness_preserves_explicit_recovery_and_stop_fences(self):
        source = Path(os.environ.get('NAC_RECOVERY_SOURCE', OWNER / 'WorkspaceRecovery.swift')).read_text()
        methods = ''.join(member(source, declaration) for declaration in [
            'private func next(', 'private func current(', 'private func sameEngine(',
            'private func reconnect(', 'private func unavailable(', 'private func showActions(',
            'private func hideActions(',
        ])
        admission = member((OWNER / 'PreviewApp.swift').read_text(), 'var canRecoverWorkspace:')
        fixture = (OWNER / 'WorkspaceRecoveryFixture.swift').read_text()
        self.assertEqual(fixture.count('// RECOVERY_METHODS'), 1)
        self.assertEqual(fixture.count('// APP_ADMISSION'), 1)
        fixture = fixture.replace('// RECOVERY_METHODS', methods).replace('// APP_ADMISSION', admission)
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        with tempfile.TemporaryDirectory(prefix='nac-recovery-pure-') as directory:
            path = Path(directory)
            swift = path / 'RecoveryOwner.swift'
            swift.write_text(fixture)
            binary = path / 'recovery-owner-pure-tests'
            command = [compiler, '-sdk', sdk, '-swift-version', '5', '-target', 'arm64-apple-macosx14.0',
                       '-warnings-as-errors', '-Onone', '-D', 'LOCAL_APP',
                       str(OWNER / 'EngineProtocol.swift'), str(OWNER / 'EngineFailure.swift'),
                       str(OWNER / 'AppLifecycle.swift'), str(swift), '-o', str(binary)]
            compiled = subprocess.run(command, text=True, capture_output=True, timeout=120, check=False)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], text=True, capture_output=True, timeout=15, check=False)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
            print(executed.stdout, end='')


if __name__ == '__main__':
    unittest.main()
