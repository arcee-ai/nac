"""Owned upload characterization; files only, no process/network/runtime probes."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import artifact_upload as upload
import calendar_cost
from contract import artifact_manifest, sha256, write_json


def audit(event, _):
    if event.startswith(('subprocess.', 'ctypes.', 'socket.')) or event in ('os.kill', 'os.killpg', 'os.fork'):
        raise AssertionError('REAL_RUNTIME_FORBIDDEN')


sys.addaudithook(audit)


class UploadControls(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory).resolve()/'heartbeat-evidence'
        with patch.dict(os.environ, {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}):
            upload.initialize_output(root, 'a'*40)
        cache = root/'run/home/.cache/fontconfig'
        cache.mkdir(parents=True)
        (cache/'a-le64.cache-11').write_bytes(b'original cache bytes')
        write_json(root/'run/artifact-manifest.json', artifact_manifest(root/'run'))
        return root

    def validate(self, root):
        return upload.validate_upload(root, 'a'*40, '123', '1')

    def test_hidden_original_is_in_guard_and_complete_producer_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            result = self.validate(root)
            name = 'run/home/.cache/fontconfig/a-le64.cache-11'
            self.assertEqual(result['files'][name]['sha256'], sha256(root/name))
            self.assertEqual(result['producer_manifests'], [{'file': 'run/artifact-manifest.json', 'entries': 1}])
            self.assertEqual(result['excluded'], ['run-build/**'])
            build = root/'run-build'
            build.mkdir()
            (build/'.compiler-cache').write_bytes(b'not a producer original or upload input')
            self.assertEqual(self.validate(root)['files'], result['files'])

    def test_missing_changed_escaped_and_duplicate_manifest_originals_fail(self):
        for defect in ('missing', 'changed', 'escaped', 'duplicate'):
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as directory:
                root = self.fixture(directory)
                manifest = root/'run/artifact-manifest.json'
                data = json.loads(manifest.read_text())
                original = root/'run'/data['files'][0]['file']
                if defect == 'missing':
                    original.unlink()
                elif defect == 'changed':
                    original.write_bytes(b'changed')
                else:
                    if defect == 'escaped':
                        data['files'][0]['file'] = '../run-build/foreign'
                    else:
                        data['files'].append(copy.deepcopy(data['files'][0]))
                    write_json(manifest, data)
                with self.assertRaises(RuntimeError):
                    self.validate(root)

    def test_symlink_directory_file_hardlink_and_sensitive_paths_fail_closed(self):
        for defect in ('directory-link', 'file-link', 'hardlink', 'credentials', 'ssh', 'env', 'unexpected-root', 'unexpected-cache', 'unexpected-manifest'):
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as directory:
                root = self.fixture(directory)
                foreign = Path(directory)/'foreign'
                foreign.write_text('synthetic foreign data, never follow or export')
                if defect == 'directory-link':
                    (root/'run/linked').symlink_to(Path(directory), target_is_directory=True)
                elif defect == 'file-link':
                    (root/'run/linked').symlink_to(foreign)
                elif defect == 'hardlink':
                    os.link(foreign, root/'run/linked')
                else:
                    name = {'credentials': 'run/home/credentials.toml', 'ssh': 'run/home/.ssh/key',
                            'env': 'run/.env', 'unexpected-root': 'foreign/file',
                            'unexpected-cache': 'run/home/.cache/other/file',
                            'unexpected-manifest': 'run/visual/artifact-manifest.json'}[defect]
                    path = root/name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('synthetic forbidden path')
                with self.assertRaises(RuntimeError):
                    self.validate(root)

    def test_identity_reuse_root_mode_foreign_owner_and_root_symlink_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            with self.assertRaises(FileExistsError), patch.dict(os.environ, {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}):
                upload.initialize_output(root, 'a'*40)
            with self.assertRaisesRegex(RuntimeError, 'UPLOAD_OWNERSHIP_BINDING'), \
                 patch.object(upload.os, 'listdir', side_effect=AssertionError('NO_WALK_BEFORE_BINDING')):
                upload.validate_upload(root, 'b'*40, '123', '1')
            root.chmod(0o755)
            with self.assertRaisesRegex(RuntimeError, 'UPLOAD_ROOT_MODE'):
                self.validate(root)
            root.chmod(0o700)
            with patch.object(upload.os, 'getuid', return_value=os.getuid()+1):
                with self.assertRaisesRegex(RuntimeError, 'UPLOAD_FOREIGN_OWNER'):
                    self.validate(root)
            link = Path(directory)/'linked-parent'
            link.symlink_to(Path(directory), target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, 'UPLOAD_ROOT_PATH'):
                self.validate(link/'heartbeat-evidence')

    def retired_failure(self, directory):
        root = self.fixture(directory)
        write_json(root/'run/terminal.json', {'state': 'FAIL', 'namespace_retirement': {'state': 'RETIRED'}})
        (root/'run/after-size-record.json').write_text('{"state":"late diagnostic"}\n')
        (root/'setup.stdout').write_text('outer setup output')
        (root/'custody').mkdir()
        (root/'custody/diagnostic.json').write_text('{"state":"PASS_SCOPED_CUSTODY"}\n')
        write_json(root/'run/artifact-manifest.json', artifact_manifest(root/'run'))
        return root

    def finish(self, root, mode='calendar-cost'):
        return upload.finish_upload(root, 'a'*40, '123', '1', mode)

    def test_scaled_undersize_retired_failure_uploads_with_exact_final_aggregate(self):
        with tempfile.TemporaryDirectory() as d, patch.object(calendar_cost, 'EXPORT_BOUND', 64*1024):
            root = self.retired_failure(d)
            build = root/'run-build'
            build.mkdir()
            (build/'compiler-cache').write_bytes(b'x'*(64*1024))
            result = self.finish(root)
            actual = sum(x.stat().st_size for x in root.rglob('*')
                         if x.is_file() and 'run-build' not in x.relative_to(root).parts)
            self.assertEqual(result['aggregate_bytes'], actual)
            self.assertLessEqual(actual, 64*1024)
            self.assertIn('setup.stdout', result['files'])
            self.assertIn('custody/diagnostic.json', result['files'])
            self.assertIn('run/after-size-record.json', result['files'])
            self.assertIn('run/artifact-manifest.json', result['files'])
            self.assertEqual(json.loads((root/'run/terminal.json').read_text())['state'], 'FAIL')

    def test_oversize_retired_failure_is_withheld_without_deleting_originals(self):
        with tempfile.TemporaryDirectory() as d, patch.object(calendar_cost, 'EXPORT_BOUND', 64*1024):
            root = self.retired_failure(d)
            # Entire run is small; OUTER data alone makes the final bundle too large.
            (root/'setup.stdout').write_bytes(b'x'*(64*1024))
            before = {str(x.relative_to(root)): sha256(x) for x in root.rglob('*') if x.is_file()}
            with self.assertRaisesRegex(RuntimeError, 'CALENDAR_EXPORT_BOUND'):
                self.finish(root)
            self.assertFalse((root/'upload-validation.json').exists())
            self.assertEqual(before, {str(x.relative_to(root)): sha256(x)
                                      for x in root.rglob('*') if x.is_file()})

    def test_validation_receipt_itself_cannot_push_bundle_past_limit(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.retired_failure(d)
            base = sum(x['bytes'] for x in self.validate(root)['files'].values())
            with patch.object(calendar_cost, 'EXPORT_BOUND', base+1), \
                 self.assertRaisesRegex(RuntimeError, 'CALENDAR_EXPORT_BOUND'):
                self.finish(root)
            self.assertFalse((root/'upload-validation.json').exists())

    def test_record_created_after_initial_sum_fails_final_stable_tree_check(self):
        with tempfile.TemporaryDirectory() as d, patch.object(calendar_cost, 'EXPORT_BOUND', 64*1024):
            root = self.retired_failure(d)
            original = upload.write_json
            def write(path, value):
                original(path, value)
                (root/'setup.stderr').write_text('injected late writer; do not delete')
            with patch.object(upload, 'write_json', side_effect=write), \
                 self.assertRaisesRegex(RuntimeError, 'UPLOAD_FINAL_TREE_CHANGED'):
                self.finish(root)
            self.assertTrue((root/'setup.stderr').exists())

    def test_legacy_modes_keep_original_admission_behavior_and_receipt(self):
        with tempfile.TemporaryDirectory() as d, patch.object(calendar_cost, 'EXPORT_BOUND', 1):
            root = self.retired_failure(d)
            result = self.finish(root, 'matched-and-measure')
            self.assertEqual(result['state'], 'VALIDATED_OWNED_UPLOAD_TREE')
            self.assertNotIn('aggregate_bytes', result)
            self.assertEqual(json.loads((root/'upload-validation.json').read_text()), result)

    def test_real_mocked_workload_to_retired_failure_to_final_guard(self):
        # Reuse the actual orchestration fixture from the accepted 64 controls;
        # do not replace workload/finalizer/admission with a predicted outcome.
        spec = importlib.util.spec_from_file_location('calendar_control_fixture',
            Path(__file__).with_name('calendar_cost.test.py'))
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        for bound, cause in ((1, None), (64*1024, 'child')):
            with self.subTest(bound=bound), tempfile.TemporaryDirectory() as d, \
                 patch.object(calendar_cost, 'EXPORT_BOUND', bound):
                parent = Path(d).resolve()
                work = parent/'work'
                work.mkdir()
                helper = fixture.Workload('test_one_build_same_binary_order_and_full_finalizers')
                code, result, *_ = helper.exercise(work, cause)
                self.assertEqual(code, 90)
                self.assertEqual(result['first_error'], 'CALENDAR_EXPORT_BOUND' if bound == 1 else 'CHILD_FAILED')
                root = parent/'heartbeat-evidence'
                with patch.dict(os.environ, {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}):
                    upload.initialize_output(root, 'a'*40)
                (work/'out').rename(root/'run')
                with patch.object(fixture.runner, 'NamespaceCustody'), \
                     patch.object(fixture.runner, 'execute_namespace', return_value=(None, {'state': 'RETIRED'})), \
                     self.assertRaisesRegex(RuntimeError, 'FINITE_EVIDENCE_FAILED'):
                    fixture.runner.finalize_namespace([], {}, root/'run', work/'product',
                                                      {'mode': calendar_cost.MODE, 'control': 'a'*40})
                terminal = json.loads((root/'run/terminal.json').read_text())
                self.assertEqual((terminal['state'], terminal['namespace_retirement']['state']), ('FAIL', 'RETIRED'))
                originals = {str(x.relative_to(root)): sha256(x) for x in root.rglob('*') if x.is_file()}
                if bound == 1:
                    with self.assertRaisesRegex(RuntimeError, 'CALENDAR_EXPORT_BOUND'):
                        self.finish(root)
                    self.assertFalse((root/'upload-validation.json').exists())
                else:
                    self.assertLessEqual(self.finish(root)['aggregate_bytes'], bound)
                self.assertTrue(all(sha256(root/name) == digest for name, digest in originals.items()))


if __name__ == '__main__':
    unittest.main()
