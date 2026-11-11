"""Verbatim native disposal with explicit WK ports; no AppKit/WK acceptance."""

from pathlib import Path
import os
import subprocess
import tempfile
import unittest

from test_workspace_recovery import member


OWNER = Path(__file__).parent


class NativeCommandBridgeTests(unittest.TestCase):
    def test_connection_loss_defers_teardown_and_revalidates_binding(self):
        source = Path(os.environ.get('NAC_BRIDGE_SOURCE', OWNER / 'NativeCommandBridge.swift')).read_text()
        fixture = (OWNER / 'NativeConnectionLossFixture.swift').read_text()
        fixture = fixture.replace('// RETIRE_OWNER', member(source, 'func retire('))
        fixture = fixture.replace('// MESSAGE_OWNER', member(source, 'func userContentController('))
        fixture = fixture.replace('// NAVIGATION_OWNER', member(source, 'func navigationStarted('))
        fixture = fixture.replace('// CALL_OWNER', member(source, 'private func call('))
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        with tempfile.TemporaryDirectory(prefix='nac-connection-loss-pure-') as directory:
            root = Path(directory)
            swift = root / 'ConnectionLoss.swift'
            swift.write_text(fixture)
            binary = root / 'connection-loss-tests'
            compiled = subprocess.run([
                compiler, '-sdk', sdk, '-swift-version', '5', '-target', 'arm64-apple-macosx14.0',
                '-warnings-as-errors', '-Onone', str(OWNER / 'EngineProtocol.swift'),
                str(OWNER / 'EngineFailure.swift'), str(OWNER / 'NativeCommandState.swift'),
                str(swift), '-o', str(binary),
            ], text=True, capture_output=True, timeout=120, check=False)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], text=True, capture_output=True, timeout=15, check=False)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
            print(executed.stdout, end='')

    def test_disposal_is_independent_of_document_activation(self):
        source = Path(os.environ.get('NAC_BRIDGE_SOURCE', OWNER / 'NativeCommandBridge.swift')).read_text()
        fixture = (OWNER / 'NativeCommandBridgeFixture.swift').read_text()
        self.assertEqual(fixture.count('// RETIRE_OWNER'), 1)
        fixture = fixture.replace('// RETIRE_OWNER', member(source, 'func retire('))
        compiler = subprocess.check_output(['xcrun', '--find', 'swiftc'], text=True).strip()
        sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        with tempfile.TemporaryDirectory(prefix='nac-bridge-pure-') as directory:
            path = Path(directory)
            swift = path / 'BridgeOwner.swift'
            swift.write_text(fixture)
            binary = path / 'bridge-owner-pure-tests'
            compiled = subprocess.run([
                compiler, '-sdk', sdk, '-swift-version', '5', '-target', 'arm64-apple-macosx14.0',
                '-warnings-as-errors', '-Onone', '-parse-as-library', str(swift), '-o', str(binary),
            ], text=True, capture_output=True, timeout=120, check=False)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            executed = subprocess.run([str(binary)], text=True, capture_output=True, timeout=15, check=False)
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
            print(executed.stdout, end='')


if __name__ == '__main__':
    unittest.main()
