"""Inert routing/custody controls; no network, archive command or runtime."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('launch', Path(__file__).with_name('launch.py'))
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)


class LauncherControls(unittest.TestCase):
    def admission(self):
        return dict(scope=launch.case.SCOPE, controller_sha='a' * 40, allocation_id='Root-one',
            attempt=1, retries=0, manifest_sha256='b' * 64,
            producer=dict(run_id=123, artifact_id=456, controller_sha='c' * 40,
                          branch='codex/experimental-producer-post648', artifact_name='package-123-1'),
            clock=dict(STARTED=1000, WORK_DEADLINE=1900, CLEANUP_DEADLINE=2260, HARD_DEADLINE=2380))

    def test_phase_timeouts_keep_original_work_cleanup_and_retention(self):
        value = self.admission()
        self.assertEqual(launch.minutes(value, 'download', now=1700), 2)
        self.assertEqual(launch.minutes(value, 'case', now=1800), 6)
        for phase in ('rust', 'node', 'download', 'metadata', 'prepare', 'case'):
            with self.subTest(phase=phase), self.assertRaises(RuntimeError):
                launch.minutes(value, phase, now=1900)
        self.assertEqual(launch.retention_minutes(value, now=2260), 1)
        self.assertEqual(value['clock']['WORK_DEADLINE'], 1900)
        self.assertEqual(value['clock']['CLEANUP_DEADLINE'], 2260)

    def identity(self):
        value = self.admission()
        p = value['producer']
        run = dict(id=p['run_id'], head_sha=p['controller_sha'], head_branch=p['branch'],
            event='workflow_dispatch', run_attempt=1, status='completed', conclusion='success',
            repository=dict(full_name=launch.REPOSITORY), head_repository=dict(full_name=launch.REPOSITORY))
        artifact = dict(id=p['artifact_id'], name=p['artifact_name'], expired=False,
            workflow_run=dict(id=p['run_id'], head_sha=p['controller_sha'], head_branch=p['branch'],
                              repository_id=10, head_repository_id=10))
        return value, run, artifact

    def test_exact_run_artifact_source_and_repository_required(self):
        value, run, artifact = self.identity()
        self.assertEqual(launch.artifact_identity(value, run, artifact)['artifact_id'], 456)
        for changed in (dict(id=999), dict(head_sha='d' * 40), dict(head_branch='other'),
                        dict(conclusion='failure'), dict(run_attempt=2), dict(event='push'),
                        dict(repository=dict(full_name='other/repo'))):
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                launch.artifact_identity(value, {**run, **changed}, artifact)
        for changed in (dict(id=999), dict(name='other'), dict(expired=True),
                        dict(workflow_run={**artifact['workflow_run'], 'id': 999}),
                        dict(workflow_run={**artifact['workflow_run'], 'head_repository_id': 11})):
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                launch.artifact_identity(value, run, {**artifact, **changed})

    def test_only_root_bound_manifest_and_unchanged_current_product_zip_transfer(self):
        value = self.admission()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            archive = root / 'NAC-normal-arm64.zip'
            archive.write_bytes(b'inert bytes, never extracted')
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps(dict(identity=dict(source=dict(revision='e' * 40)),
                container=dict(name=archive.name, size=archive.stat().st_size, sha256=launch.case.digest(archive)))))
            value['manifest_sha256'] = launch.case.digest(manifest)
            receipt = dict(status='PASS', runtime=False, SDK_actor=False, producer_attempts=1, retries=0,
                pair=dict(P='e' * 40), admission=dict(controller_sha=value['producer']['controller_sha']),
                handoff={f.name: dict(sha256=launch.case.digest(f), bytes=f.stat().st_size) for f in (manifest, archive)})
            sink = root / 'host-package.json'
            sink.write_text(json.dumps(receipt))
            self.assertEqual(launch.handoff_files(root, value, 'e' * 40), (manifest, archive))
            bad = copy.deepcopy(receipt)
            bad['pair']['P'] = 'f' * 40
            sink.write_text(json.dumps(bad))
            with self.assertRaises(RuntimeError):
                launch.handoff_files(root, value, 'e' * 40)
            sink.write_text(json.dumps(receipt))
            archive.write_bytes(b'tampered')
            with self.assertRaises(RuntimeError):
                launch.handoff_files(root, value, 'e' * 40)
