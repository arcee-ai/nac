"""Compile the standalone OS input driver's passive protocol controls on macOS."""
from pathlib import Path
import platform
import subprocess
import tempfile
import unittest


class CommandInputDriverTests(unittest.TestCase):
    @unittest.skipUnless(platform.system() == 'Darwin' and platform.machine() == 'arm64',
                         'Actual macOS SDK and ARM64 are required')
    def test_passive_identity_and_no_follow_controls(self):
        root = Path(__file__).parent
        with tempfile.TemporaryDirectory(prefix='nac-command-driver-fixture-') as directory:
            executable = Path(directory) / 'CommandInputDriverTests'
            subprocess.run(['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5',
                            '-D', 'COMMAND_DRIVER_TEST', '-framework', 'AppKit',
                            '-framework', 'CoreGraphics', '-framework', 'IOKit',
                            '-framework', 'CryptoKit', str(root / 'CommandInputDriver.swift'),
                            str(root / 'CommandInputDriverTests.swift'), '-o', str(executable)],
                           check=True, timeout=90, capture_output=True)
            result = subprocess.run([str(executable)], check=True, timeout=30,
                                    capture_output=True, text=True)
            self.assertIn('no OS event was posted', result.stdout)
