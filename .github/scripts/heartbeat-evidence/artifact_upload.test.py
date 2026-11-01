"""Owned upload characterization; files only, no process/network/runtime probes."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import artifact_upload as upload
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


if __name__ == '__main__':
    unittest.main()
