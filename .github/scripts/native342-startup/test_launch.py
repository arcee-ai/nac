"""Inert routing/custody controls; no network, archive command or runtime."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('launch', Path(__file__).with_name('launch.py'))
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)


class LauncherControls(unittest.TestCase):
    def admission(self):
        return dict(scope=launch.case.SCOPE, controller_sha='a' * 40, allocation_id='Root-one',
            attempt=1, retries=0, manifest_sha256='b' * 64,
            producer=dict(run_id=123, artifact_id=456, controller_sha=launch.case.PRODUCER,
                          branch=launch.case.PRODUCER_BRANCH, artifact_name='package-123-1'),
            clock=dict(STARTED=1000, WORK_DEADLINE=3880, CLEANUP_DEADLINE=4480, HARD_DEADLINE=4600))

    def test_phase_timeouts_keep_original_work_cleanup_and_retention(self):
        value = self.admission()
        self.assertEqual(launch.minutes(value, 'download', now=1700), 2)
        self.assertEqual(launch.minutes(value, 'episode', now=1800), 43)
        for phase in ('rust', 'node', 'download', 'metadata', 'prepare', 'episode', 'checkout-R'):
            with self.subTest(phase=phase), self.assertRaises(RuntimeError):
                launch.minutes(value, phase, now=3880)
        self.assertEqual(launch.retention_minutes(value, now=4480), 1)
        self.assertEqual(value['clock']['WORK_DEADLINE'], 3880)
        self.assertEqual(value['clock']['CLEANUP_DEADLINE'], 4480)

    def test_new_branch_admission_rejects_old_onboarding_ref_and_legacy_producer(self):
        value = self.admission()
        env = dict(ROOT_STARTUP_ADMISSION=json.dumps(value), GITHUB_SHA='a' * 40,
            GITHUB_REF=launch.case.BRANCH, GITHUB_EVENT_NAME='workflow_dispatch',
            GITHUB_RUN_ATTEMPT='1', GITHUB_REPOSITORY=launch.REPOSITORY)
        with patch.dict(launch.os.environ, env), patch.object(launch.time, 'time', return_value=1001):
            self.assertEqual(launch.inputs(), value)
            for changed in (dict(GITHUB_REF='refs/heads/codex/experimental-native342-onboarding-post648-p9'),
                            dict(GITHUB_RUN_ATTEMPT='2'), dict(GITHUB_EVENT_NAME='push')):
                with patch.dict(launch.os.environ, changed), self.assertRaises(RuntimeError):
                    launch.inputs()
            old = {**value, 'producer': {**value['producer'], 'controller_sha': 'c' * 40}}
            with patch.dict(launch.os.environ, ROOT_STARTUP_ADMISSION=json.dumps(old)), self.assertRaises(RuntimeError):
                launch.inputs()

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
            manifest.write_text(json.dumps(dict(identity=dict(source=dict(revision='ef2cce9141973f37bf35e33d113e35eaa7a91f19')),
                container=dict(name=archive.name, size=archive.stat().st_size, sha256=launch.case.digest(archive)))))
            value['manifest_sha256'] = launch.case.digest(manifest)
            receipt = dict(status='PASS', runtime=False, SDK_actor=False, producer_attempts=1, retries=0,
                pair=dict(P='ef2cce9141973f37bf35e33d113e35eaa7a91f19'), admission=dict(controller_sha=value['producer']['controller_sha']),
                handoff={f.name: dict(sha256=launch.case.digest(f), bytes=f.stat().st_size) for f in (manifest, archive)})
            sink = root / 'host-package.json'
            sink.write_text(json.dumps(receipt))
            self.assertEqual(launch.handoff_files(root, value, 'ef2cce9141973f37bf35e33d113e35eaa7a91f19'), (manifest, archive))
            bad = copy.deepcopy(receipt)
            bad['pair']['P'] = '9ec88bd3397ccca192b2e9a95b6bd9a80b4067e3'
            sink.write_text(json.dumps(bad))
            with self.assertRaises(RuntimeError):
                launch.handoff_files(root, value, 'ef2cce9141973f37bf35e33d113e35eaa7a91f19')
            sink.write_text(json.dumps(receipt))
            archive.write_bytes(b'tampered')
            with self.assertRaises(RuntimeError):
                launch.handoff_files(root, value, 'ef2cce9141973f37bf35e33d113e35eaa7a91f19')
