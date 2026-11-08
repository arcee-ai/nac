"""Pure Foundation environment checks and actual Python ownership admission.

NAC_STARTUP_PRODUCT_SOURCE optionally binds these same controls to the immutable
P resolver. Without it, explicit synthetic maps exercise role validation only.
No product app/engine, browser, live PID probe or signal is requested.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from ci_startup_environment import SOURCE, SOURCE_SHA256, resolve_environment
from ci_startup_fixture import environment
from ci_startup_owner import OwnerWitness

DRIVER = r'''
let request = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
do {
    let value = try StartupEnvironmentCheck.record(executable: request["executable"] as! String,
        nativePath: request["native"] as! String, enginePath: request["engine"] as! String,
        argv: request["argv"] as! [String], environment: request["observed"] as! [String: String],
        launcher: request["launcher"] as! [String: String], child: request["child"] as! [String: String])
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
} catch { FileHandle.standardOutput.write(Data("null".utf8)) }
'''


class ResolverAdmissionTests(unittest.TestCase):
    def test_changed_product_source_is_rejected_before_compilation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source = root / SOURCE
            source.parent.mkdir(parents=True)
            source.write_text('Synthetic changed source; must never compile or execute')
            with patch('ci_startup_environment.require_checkout') as checkout, \
                    self.assertRaisesRegex(RuntimeError, 'resolver differs'):
                resolve_environment(root, {})
            checkout.assert_called_once()
            self.assertEqual(list(root.glob('environment-resolver-*')), [])

    def test_legacy_product_is_rejected_before_source_or_compiler(self):
        from ci_startup_environment import PRODUCT
        self.assertEqual(PRODUCT, '4b7a1f3e0bf6175a77c5ebf627fe965860e99976')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with patch('ci_startup_environment.require_checkout', side_effect=RuntimeError('legacy product rejected')) as checkout, \
                    patch('ci_startup_environment.subprocess.check_output') as query, \
                    patch('ci_startup_environment.subprocess.run') as run:
                with self.assertRaisesRegex(RuntimeError, 'legacy product rejected'):
                    resolve_environment(root, {})
            checkout.assert_called_once_with(root, PRODUCT)
            query.assert_not_called()
            run.assert_not_called()


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('swiftc'), 'Darwin Swift Foundation controls unavailable')
class ProductionEnvironmentControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac354-environment-controls-')
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name).resolve()
        cls.launcher = environment(cls.root, 'http://127.0.0.1:4173/models-dev')
        product = os.environ.get('NAC_STARTUP_PRODUCT_SOURCE')
        if product:
            cls.child, cls.provenance = resolve_environment(Path(product),
                {'root': cls.root, 'home': Path(cls.launcher['HOME']), 'environment': cls.launcher})
        else:
            cls.child = {**cls.launcher, 'PATH': '/explicit-synthetic-child-path'}
            cls.provenance = {'scope': 'Synthetic maps only; no P resolver claim'}
        source = (Path(__file__).parent / 'CIStartupObserver.swift').read_text()
        begin, end = '// BEGIN STARTUP ENVIRONMENT CHECKS', '// END STARTUP ENVIRONMENT CHECKS'
        assert source.count(begin) == source.count(end) == 1
        production = source.split(begin, 1)[1].split('\n', 1)[1].split(end, 1)[0]
        file = cls.root / 'main.swift'
        file.write_text('import Foundation\nenum OwnershipError: Error { case invalid }\n' + production + DRIVER)
        cls.executable = cls.root / 'EnvironmentControls'
        build = subprocess.run(['swiftc', '-swift-version', '5', str(file), '-o', str(cls.executable)],
                               capture_output=True, text=True, timeout=45)
        if build.returncode:
            raise AssertionError(build.stderr[-8192:])
        cls.provenance = {**cls.provenance, 'observer_sha256': hashlib.sha256(source.encode()).hexdigest(),
                          'control_binary_sha256': hashlib.sha256(cls.executable.read_bytes()).hexdigest()}
        cls.records = []

    def request(self, role):
        app = '/private/nac342-xctest-unit/NAC.app'
        native, engine = app + '/Contents/MacOS/NACPreview', app + '/Contents/Resources/nac-web'
        executable = native if role == 'launcher' else '/bin/sh' if role == 'descendant' else engine
        argv = [executable] + (['--directory', self.launcher['HOME']] if role == 'launcher' else
                ['__desktop-configuration', '--directory', self.launcher['HOME']] if role == 'configuration_helper'
                else ['--bind', '127.0.0.1:0'] if role == 'engine' else [])
        return {'executable': executable, 'native': native, 'engine': engine, 'argv': argv,
                'launcher': self.launcher, 'child': self.child,
                'observed': copy.deepcopy(self.launcher if role == 'launcher' else self.child)}

    def validate(self, request):
        result = subprocess.run([str(self.executable)], input=json.dumps(request).encode(),
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr[-4096:])
        value = json.loads(result.stdout)
        self.records.append({'request': request, 'result': value})
        return value

    def owner_nodes(self):
        nodes = []
        for role, pid, parent in [('launcher', 10, 1), ('configuration_helper', 11, 10),
                                  ('engine', 12, 10), ('descendant', 13, 12)]:
            request = self.request(role)
            record = self.validate(request)
            self.assertEqual(record['environment_role'], role)
            node = {**record, 'executable': request['executable'], 'pid': pid, 'parent': parent, 'uid': 501,
                    'start_seconds': 1234, 'start_microseconds': pid, 'arguments_sha256': 'c' * 64}
            if role == 'launcher':
                node.update(app_launch_epoch=1234.5, windows=[17])
            nodes.append(node)
        return nodes

    def owner(self, nodes):
        config = {'app_path': '/private/nac342-xctest-unit/NAC.app', 'environment': self.launcher,
                  'child_environment': self.child}
        owner = OwnerWitness(config, 'b' * 64, uid=501, clock=lambda: 100)
        self.attempted_owner = owner
        owner.observe({'schema': 'nac342-owner-v1', 'event': 'ready', 'complete': True, 'nodes': [],
                       'retired': [], 'enumerated_exits': [], 'observed_uptime_ns': '99000000000',
                       'configuration_sha256': 'b' * 64})
        owner.observe({'schema': 'nac342-owner-v1', 'complete': True, 'nodes': nodes, 'retired': [],
                       'enumerated_exits': [], 'observed_uptime_ns': '99500000000'})
        return owner

    def reject_nodes(self, nodes):
        with self.assertRaises(RuntimeError):
            self.owner(nodes)
        self.assertEqual(self.attempted_owner.history, {})
        self.assertEqual(self.attempted_owner.latest, [])
        self.assertIsNone(self.attempted_owner.app)
        self.assertFalse(self.attempted_owner.serving_observed)
        self.assertEqual(self.attempted_owner.signals, [])

    def test_all_four_roles_enter_actual_python_owner_with_distinct_maps(self):
        nodes = self.owner_nodes()
        owner = self.owner(nodes)
        self.assertEqual(len(owner.history), 4)
        self.assertTrue(owner.serving_observed)
        self.assertNotEqual(self.launcher['PATH'], self.child['PATH'])
        self.assertEqual(nodes[0]['environment'], self.launcher)
        self.assertTrue(all(node['environment'] == self.child for node in nodes[1:]))
        if os.environ.get('NAC_STARTUP_PRODUCT_SOURCE'):
            self.assertEqual(self.provenance['source_sha256'], SOURCE_SHA256)

    def test_swift_wrong_path_role_other_controlled_values_and_credentials_reject(self):
        for role in ('launcher', 'configuration_helper', 'engine', 'descendant'):
            for key in self.launcher:
                with self.subTest(role=role, changed=key):
                    request = self.request(role)
                    request['observed'][key] = 'wrong-controlled-value'
                    self.assertIsNone(self.validate(request))
            for key in ('EXAMPLE_TOKEN', 'EXAMPLE_API_KEY', 'NAC_MANAGED_CONFIG'):
                request = self.request(role)
                request['observed'][key] = 'synthetic-secret-never-emitted'
                self.assertIsNone(self.validate(request))
            request = self.request(role)
            request['observed'] = self.child if role == 'launcher' else self.launcher
            self.assertIsNone(self.validate(request))
        for argv in ([], ['--bind', '__desktop-configuration']):
            request = self.request('engine')
            request['argv'] = [request['engine']] + argv
            self.assertIsNone(self.validate(request))
        request = self.request('launcher')
        request['argv'] += ['__desktop-configuration']
        self.assertIsNone(self.validate(request))
        request = self.request('engine')
        request['argv'][0] = '/foreign/nac-web'
        self.assertIsNone(self.validate(request))

    def test_python_wrong_role_path_flags_or_values_never_admit_partial_history(self):
        nodes = self.owner_nodes()
        for index in range(4):
            wrong_path = nodes[2]['executable'] if index == 3 else '/foreign'
            for key, value in [('environment_role', 'wrong-role'), ('executable', wrong_path),
                               ('configuration_helper', not nodes[index]['configuration_helper']),
                               ('serving', not nodes[index]['serving'])]:
                candidate = copy.deepcopy(nodes)
                candidate[index][key] = value
                with self.subTest(index=index, key=key):
                    self.reject_nodes(candidate)
            for key in self.launcher:
                candidate = copy.deepcopy(nodes)
                candidate[index]['environment'][key] = 'wrong-controlled-value'
                with self.subTest(index=index, key=key):
                    self.reject_nodes(candidate)

    def test_changed_child_contract_and_ambient_observations_never_replace_controlled_facts(self):
        for role in ('launcher', 'configuration_helper', 'engine', 'descendant'):
            request = self.request(role)
            request['observed']['XCODE_PLATFORM_METADATA'] = 'synthetic-ambient-value'
            value = self.validate(request)
            self.assertNotIn('XCODE_PLATFORM_METADATA', value['environment'])
            for change in ({'HOME': '/different'}, {'EXTRA': 'uncontrolled'}):
                request = self.request(role)
                request['child'] = {**self.child, **change}
                self.assertIsNone(self.validate(request))


if __name__ == '__main__':
    unittest.main()
