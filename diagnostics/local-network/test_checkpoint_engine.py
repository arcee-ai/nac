import sys
import tempfile
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from checkpoint_engine import prepare_engine_operation


class Tests(unittest.TestCase):
    def test_exact_owners_and_direct_child_lifetime(self):
        calls = []
        @contextmanager
        def setup(profile, config, log):
            calls.append('setup_enter')
            try:
                yield {'base_url': 'private-loopback'}
            finally:
                calls.append('setup_exit')
        modules = {
            'ci': types.SimpleNamespace(qualification_deadline=lambda now, suite: now + 3600, run=lambda argv, *a, **k: calls.append(argv[3])),
            'ci_startup': types.SimpleNamespace(product_package_owner=lambda root: root / 'owner.py'),
            'ci_startup_fixture': types.SimpleNamespace(
                prepare_profile=lambda parent, scenario, url, **kw: {'home': parent / 'home', 'scenario': scenario},
                prepare_configuration=lambda profile, app, manifest, p, q, sha, **kw:
                    ({'app_path': str(app)}, None, None)),
            'ci_startup_api': types.SimpleNamespace(
                configuration_selection=lambda profile, engine, **kw: calls.append('configuration'),
                setup_engine=setup,
                seed_model=lambda base, provider: calls.append('seed')),
            'ci_qualifications': types.SimpleNamespace(require_checkout=lambda p, sha: calls.append('checkout')),
        }
        def execute(argv, cwd, timeout, log):
            calls.append(argv[3])
            return True
        with tempfile.TemporaryDirectory() as root, patch.dict(sys.modules, modules):
            p = Path(root)
            operation = prepare_engine_operation(p, p, p, p)
            self.assertEqual(calls, ['checkout', 'prepare-engine', 'normal', 'verify', 'checkout'])
            with operation('http://127.0.0.1:1'):
                calls.append('observation')
            self.assertEqual(calls[-5:], ['configuration', 'setup_enter', 'seed', 'observation', 'setup_exit'])

    def test_failed_package_cannot_start_engine(self):
        calls = []
        modules = {
            'ci': types.SimpleNamespace(qualification_deadline=lambda now, suite: now + 3600, run=lambda argv, *a, **k: calls.append(argv[3])),
            'ci_startup': types.SimpleNamespace(product_package_owner=lambda root: root / 'owner.py'),
            'ci_startup_fixture': types.SimpleNamespace(prepare_profile=lambda *_: self.fail(),
                                                         prepare_configuration=lambda *_: self.fail()),
            'ci_startup_api': types.SimpleNamespace(configuration_selection=lambda *_: self.fail(),
                                                     setup_engine=lambda *_: self.fail(), seed_model=lambda *_: self.fail()),
            'ci_qualifications': types.SimpleNamespace(require_checkout=lambda *_: None),
        }
        def failed_run(argv, *args, **kwargs):
            calls.append(argv[3])
            raise RuntimeError('unavailable')
        modules['ci'].run = failed_run
        def execute(*_):
            self.fail('independent process owner')
        with tempfile.TemporaryDirectory() as root, patch.dict(sys.modules, modules):
            p = Path(root)
            with self.assertRaises(RuntimeError):
                prepare_engine_operation(p, p, p, p)
        self.assertEqual(calls, ['prepare-engine'])

if __name__ == '__main__':
    unittest.main()
