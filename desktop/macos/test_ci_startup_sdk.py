"""Inert process/artifact ports; these tests never compile or execute Swift."""
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import ci_startup
import ci_startup_sdk as sdk
from ci_xctest_project import PROJECT, SCHEME, NATIVE


class StartupSDKTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.harness, self.tests, self.output = [self.root / x for x in ('harness', 'tests', 'evidence')]
        for path in (PROJECT / 'project.pbxproj', PROJECT / SCHEME, NATIVE,
                     Path('desktop/macos/ci-toolchain.json')):
            target = self.harness / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(sdk.ROOT / path, target)
        shutil.copytree(sdk.ROOT / 'desktop/macos/startup_xctest', self.tests / 'desktop/macos/startup_xctest')
        self.H, self.Q = self.repository(self.harness), self.repository(self.tests)
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(sdk.fixture, 'TEST_SOURCE', self.Q))
        stack.enter_context(patch.object(ci_startup, 'TEST_SOURCE', self.Q))
        stack.enter_context(patch.object(sdk.platform, 'system', return_value='Darwin'))
        stack.enter_context(patch.object(sdk.platform, 'machine', return_value='arm64'))
        self.toolchain = json.loads((self.harness / 'desktop/macos/ci-toolchain.json').read_text())
        self.image = next(k for k, v in self.toolchain['image_hosts'].items() if v['os_version'] == '26.7.2')
        # Keep synthetic Xcode metadata out of real Git's macOS launcher env.
        stack.enter_context(patch.object(sdk, 'os', SimpleNamespace(environ={
            **os.environ, 'DEVELOPER_DIR': self.toolchain['developer_directory'], 'ImageVersion': self.image})))
        stack.enter_context(patch.dict(os.environ, {
            'PRIVATE_SDK_TOKEN': 'INERT-SECRET-CANARY', 'NAC_MANAGED_CONFIG': 'INERT-CONFIG-CANARY'}))
        self.calls = []
        self.mode = None

    def repository(self, root):
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        subprocess.run(['git', 'add', '.'], cwd=root, check=True)
        subprocess.run(['git', '-c', 'user.name=Inert SDK fixture', '-c', 'user.email=fixture@example.invalid',
                        '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic source roots'], cwd=root, check=True)
        return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()

    def command(self, args):
        if args[:2] == ['git', '-C']:
            return subprocess.check_output(args, text=True).strip()
        values = {('xcodebuild', '-version'): self.toolchain['xcode'],
                  ('xcrun', '--sdk', 'macosx', '--show-sdk-version'): self.toolchain['sdk'],
                  ('xcrun', 'swiftc', '--version'): self.toolchain['swift'],
                  ('sw_vers', '-productVersion'): '26.7.2',
                  ('sw_vers', '-buildVersion'): self.toolchain['image_hosts'][self.image]['os_build']}
        self.assertIn(tuple(args), values, 'Only inert toolchain observations may be requested')
        return values[tuple(args)]

    def compiler_port(self, args, log, cap, *, env, retain_ownership):
        self.calls.append(args)
        self.assertEqual(args[:2], ['xcodebuild', 'build-for-testing'])
        self.assertEqual(args[-2:], ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO'])
        self.assertEqual(cap, 240)
        self.assertTrue(retain_ownership)
        self.assertNotIn('PRIVATE_SDK_TOKEN', env)
        self.assertNotIn('NAC_MANAGED_CONFIG', env)
        log.write_text('INERT compiler output fixture; no SDK command executed\n')
        if self.mode == 'compile-failure':
            raise RuntimeError('Inert compiler rejected source')
        derived = Path(args[args.index('-derivedDataPath') + 1])
        products = derived / 'Build/Products'
        bundle = products / 'Debug/NACStartupUITests-Runner.app/Contents/PlugIns/NACStartupUITests.xctest'
        binary = bundle / 'Contents/MacOS/NACStartupUITests'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(struct.pack('<II', 0xFEEDFACF, 0x0100000C) + b'INERT-NOT-EXECUTABLE')
        (bundle / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable': 'NACStartupUITests'}))
        selection = json.loads((self.output / 'project/project-selection.json').read_text())
        environment = dict(arg.split('=', 1) for arg in args if arg.startswith('NAC_'))
        environment.update(NAC_STARTUP_SOURCE_PATH=selection['startup_source_path'],
                           NAC_STARTUP_SOURCE_SHA256=selection['startup_source_sha256'])
        target = {'IsUITestBundle': True, 'BlueprintName': 'NACStartupUITests',
                  'TestBundlePath': '__TESTHOST__/Contents/PlugIns/NACStartupUITests.xctest',
                  'TestHostPath': '__TESTROOT__/Debug/NACStartupUITests-Runner.app',
                  'EnvironmentVariables': environment}
        if self.mode == 'wrong-binding':
            environment['NAC_STARTUP_TEST_SHA'] = '0' * 40
        if self.mode == 'wrong-target':
            target['BlueprintName'] = 'NACNativeUITests'
        if self.mode == 'missing-binary':
            binary.unlink()
        if self.mode == 'wrong-architecture':
            binary.write_bytes(b'INERT-X86-HEADER')
        if self.mode != 'missing-runner':
            (products / 'unit.xctestrun').write_bytes(plistlib.dumps({'unit': target}))
        if self.mode == 'two-runners':
            (products / 'other.xctestrun').write_bytes(plistlib.dumps({'unit': target}))

    def check(self):
        return sdk.check(self.harness, self.H, self.tests, self.output,
                         run=self.compiler_port, command=self.command)

    def test_real_materializer_and_runner_inspector_bind_full_target_without_execution(self):
        report = self.check()
        self.assertEqual(report['result'], 'passed')
        self.assertIs(report['acceptance'], False)
        self.assertEqual(report['test_executions'], 0)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(report['harness_sha'], self.H)
        self.assertEqual(report['test_source_sha'], self.Q)
        self.assertEqual(report['test_files'], sdk.fixture.TEST_FILES)
        self.assertEqual(report['toolchain']['os_version'], '26.7.2')
        self.assertEqual(len(report['selection']['sources']), 4)
        for name in ('StartupJourneys.swift', 'StartupAXGuard.swift', 'StartupAXReceipt.swift'):
            self.assertIn(str(self.tests / 'desktop/macos/startup_xctest' / name), report['selection']['sources'])
        self.assertEqual(self.calls[0][self.calls[0].index('-destination') + 1], 'platform=macOS,arch=arm64')
        self.assertEqual(report['architecture'], 'arm64')
        self.assertRegex(report['test_bundle_executable_sha256'], '^[a-f0-9]{64}$')
        self.assertEqual(report, json.loads((self.output / 'sdk-check.json').read_text()))
        self.assertFalse(list((self.output / 'project').rglob('*.swift')))

    def test_dirty_or_mutated_sources_fail_before_any_compiler(self):
        for root in (self.harness, self.tests):
            path = root / 'dirty'
            path.write_text('inert dirty source')
            with self.assertRaises(RuntimeError):
                self.check()
            self.assertEqual(self.calls, [])
            self.assertEqual(json.loads((self.output / 'sdk-check.json').read_text())['result'], 'failed')
            path.unlink()
            shutil.rmtree(self.output)

    def test_crossroots_and_output_inside_sources_are_rejected(self):
        for tests, output in ((self.harness, self.output), (self.tests, self.harness / 'evidence')):
            with self.assertRaises(RuntimeError):
                sdk.check(self.harness, self.H, tests, output, run=self.compiler_port, command=self.command)
        self.assertEqual(self.calls, [])

    def test_missing_sdk_and_wrong_required_platform_never_compile(self):
        for changed in ('sdk-unavailable', 'wrong-platform'):
            def command(args):
                if changed == 'sdk-unavailable' and args == ['xcodebuild', '-version']:
                    raise RuntimeError('Inert CLT-only host')
                if changed == 'wrong-platform' and args == ['sw_vers', '-productVersion']:
                    return '27.0.1'
                return self.command(args)
            with self.assertRaises(RuntimeError):
                sdk.check(self.harness, self.H, self.tests, self.output, run=self.compiler_port, command=command)
            self.assertEqual(self.calls, [])
            self.assertEqual(json.loads((self.output / 'sdk-check.json').read_text())['stage'], 'toolchain')
            shutil.rmtree(self.output)

    def test_compiler_and_actual_artifact_failures_remain_failed_with_evidence(self):
        for mode in ('compile-failure', 'wrong-binding', 'wrong-target', 'missing-binary',
                     'wrong-architecture', 'missing-runner', 'two-runners'):
            with self.subTest(mode=mode):
                self.mode = mode
                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    self.check()
                report = json.loads((self.output / 'sdk-check.json').read_text())
                self.assertEqual(report['result'], 'failed')
                self.assertIs(report['acceptance'], False)
                self.assertEqual(report['test_executions'], 0)
                self.assertTrue((self.output / 'build.log').is_file())
                shutil.rmtree(self.output)

    def test_future_runtime_command_cannot_cross_the_compile_only_port(self):
        def bad_builder(folder, marker, marker_sha, config, selection, run):
            run(['xcodebuild', 'test-without-building'], folder / 'build.log', 240, env={})
        with patch.object(sdk, 'generated_runner', side_effect=bad_builder), self.assertRaises(RuntimeError):
            self.check()
        self.assertEqual(self.calls, [])
