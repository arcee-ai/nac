"""Workload transition/finalizer controls; all runtime operations are mocked."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import contract as c
spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def audit(event, _):
    if event.startswith(('subprocess.', 'ctypes.', 'socket.')) or event in ('os.kill', 'os.killpg', 'os.fork'):
        raise AssertionError('REAL_RUNTIME_FORBIDDEN')


sys.addaudithook(audit)


class WorkloadControls(unittest.TestCase):
    def exercise(self, root, orphan=False, parse_failure=False, cleanup_failure=False,
                 process_failure=False, inventory_missing=False):
        product, out = root/'product', root/'out'
        product.mkdir()
        out.mkdir()
        context = root/'context.json'
        c.write_json(context, {'control': 'a'*40, 'product': str(product),
                              'browsers': '/synthetic', 'tool_environment': {'PATH': '/synthetic'}})
        calls = []

        def phase(argv, cwd, env, output, label, seconds):
            calls.append((label, argv))
            build = root/'out-build'
            if label == 'build-product':
                (build/'debug').mkdir()
                (build/'debug/nac-web').write_bytes(b'synthetic executable')
            if label == 'build-measurement':
                executable = build/'test'
                executable.write_bytes(b'synthetic test')
                (out/(label+'.stdout')).write_text(json.dumps({'reason': 'compiler-artifact',
                    'target': {'name': 'nac_server'}, 'profile': {'test': True}, 'executable': str(executable)}))
            if label == 'measurement-inventory':
                listing = 'other: test\n\n1 test, 0 benchmarks\n' if inventory_missing else c.TEST+': test\nother: test\n\n2 tests, 0 benchmarks\n'
                (out/(label+'.stdout')).write_text(listing)
            if label == 'measurement':
                (out/(label+'.stdout')).write_text('synthetic malformed libtest output')
                if cleanup_failure:
                    (out/'perf-tmp/retained-fixture').write_text('must be reported, never deleted')
                if process_failure:
                    raise RuntimeError('CHILD_FAILED')

        with patch.dict(os.environ, {}, clear=True), \
             patch.object(runner, 'bootstrap_namespace', return_value=({'pid1': True}, Mock())), \
             patch.object(runner, 'verify_product') as verify, patch.object(runner, 'run_owned', phase), \
             patch.object(runner, 'verify_pair', return_value=[]), \
             patch.object(runner, 'measurement_rows', side_effect=RuntimeError('MEASUREMENT_FILTER_COUNT') if parse_failure else None, return_value=[]) as parse, \
             patch.object(runner, 'resource_sample', return_value={}) as sample, \
             patch.object(runner, 'reap_namespace', return_value={'remaining': [303] if orphan else []}):
            code = runner.inside(context, out)
        return code, json.loads((out/'evidence.json').read_text()), calls, verify, sample, parse

    def test_inventory_is_same_retained_binary_before_exact_one_measurement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code, result, calls, *_ = self.exercise(root)
            self.assertEqual(code, 0)
            self.assertEqual([label for label, _ in calls],
                             ['build-product', 'build-measurement', 'capture-pair', 'measurement-inventory', 'measurement'])
            self.assertEqual(calls[3][1], [root/'out/bin/heartbeat-measurement', '--list'])
            self.assertEqual(calls[4][1], [calls[3][1][0], c.TEST, '--ignored', '--exact', '--nocapture', '--test-threads=1'])
            self.assertEqual(result['measurement_inventory']['total'], 2)
            self.assertEqual(result['measurement_inventory']['binary_sha256'], result['measurement_binary']['sha256'])

    def test_orphan_prevents_inventory_and_measurement(self):
        with tempfile.TemporaryDirectory() as directory:
            code, result, calls, *_ = self.exercise(Path(directory), orphan=True)
            self.assertEqual(code, 90)
            self.assertEqual(result['first_error'], 'CAPTURE_CHILDREN_REMAIN')
            self.assertEqual(len(calls), 3)

    def test_parser_failure_still_records_all_final_checks_and_first_error(self):
        for cleanup_failure in (False, True):
            with self.subTest(cleanup_failure=cleanup_failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                code, result, calls, verify, sample, parse = self.exercise(root, parse_failure=True, cleanup_failure=cleanup_failure)
                self.assertEqual(code, 90)
                self.assertEqual(result['first_error'], 'MEASUREMENT_FILTER_COUNT')
                self.assertEqual(result['state'], 'FAIL')
                self.assertEqual(sample.call_count, 2)
                self.assertEqual(verify.call_count, 3)  # before build, after build, final even on parse failure
                self.assertEqual(parse.call_count, 1)
                self.assertEqual(sum(label == 'measurement' for label, _ in calls), 1)
                for name in ['post-measurement-resources', 'performance-fixture-cleanup', 'final-product-verification']:
                    self.assertTrue((root/'out'/(name+'.json')).is_file())
                self.assertEqual(result['cleanup_errors'], [{'check': 'performance-fixture-cleanup', 'code': 'PERFORMANCE_FIXTURE_RETAINED'}] if cleanup_failure else [])

    def test_all_finalizers_attempted_when_resource_or_product_check_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out/'perf-tmp').mkdir()
            with patch.object(runner, 'resource_sample', side_effect=OSError('synthetic')), \
                 patch.object(runner, 'verify_product', side_effect=RuntimeError('PRODUCT_DIRTY')):
                errors = runner.final_checks({}, out, out, True)
            self.assertEqual([e['check'] for e in errors], ['post-measurement-resources', 'final-product-verification'])
            self.assertEqual(json.loads((out/'performance-fixture-cleanup.json').read_text())['state'], 'PASS')

    def test_cleanup_failure_prevents_pass_even_when_parser_accepts(self):
        with tempfile.TemporaryDirectory() as directory:
            code, result, *_ = self.exercise(Path(directory), cleanup_failure=True)
            self.assertEqual(code, 90)
            self.assertEqual(result['state'], 'FAIL')
            self.assertEqual(result['first_error'], 'PERFORMANCE_FIXTURE_RETAINED')

    def test_invalid_inventory_never_admits_measurement(self):
        with tempfile.TemporaryDirectory() as directory:
            code, result, calls, *_, parse = self.exercise(Path(directory), inventory_missing=True)
            self.assertEqual(code, 90)
            self.assertEqual(result['first_error'], 'MEASUREMENT_INVENTORY_SELECTION')
            self.assertFalse(result['measurement_attempted'])
            self.assertEqual([label for label, _ in calls][-1], 'measurement-inventory')
            parse.assert_not_called()

    def test_failed_measurement_process_preserves_error_and_final_checks_without_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code, result, calls, *_, parse = self.exercise(root, process_failure=True)
            self.assertEqual(code, 90)
            self.assertEqual(result['first_error'], 'CHILD_FAILED')
            self.assertEqual(sum(label == 'measurement' for label, _ in calls), 1)
            parse.assert_not_called()
            for name in ['post-measurement-resources', 'performance-fixture-cleanup', 'final-product-verification']:
                self.assertEqual(json.loads((root/'out'/(name+'.json')).read_text())['state'], 'PASS')

    def test_receipt_failure_does_not_skip_later_final_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out/'perf-tmp').mkdir()
            original = runner.write_json

            def sink(path, value):
                if path.name == 'post-measurement-resources.json':
                    raise OSError('synthetic receipt failure')
                original(path, value)

            with patch.object(runner, 'resource_sample', return_value={}), \
                 patch.object(runner, 'verify_product') as verify, patch.object(runner, 'write_json', sink):
                errors = runner.final_checks({}, out, out, True)
            self.assertEqual(errors, [{'check': 'post-measurement-resources', 'code': 'FINAL_CHECK_RECEIPT_FAILED'}])
            verify.assert_called_once()
            self.assertTrue((out/'performance-fixture-cleanup.json').exists())
            self.assertTrue((out/'final-product-verification.json').exists())


if __name__ == '__main__':
    unittest.main()
