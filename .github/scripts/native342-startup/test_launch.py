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
        return dict(scope=launch.case.SCOPE, controller_sha='a' * 40, purpose='native', allocation_id='Root-one',
            attempt=1, retries=0, manifest_sha256=launch.case.MANIFEST_SHA256,
            producer=dict(run_id=launch.case.PRODUCER_RUN, artifact_id=launch.case.PRODUCER_ARTIFACT, controller_sha=launch.case.PRODUCER,
                          branch=launch.case.PRODUCER_BRANCH, artifact_name=launch.case.PRODUCER_ARTIFACT_NAME),
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
                            dict(GITHUB_REF='refs/heads/codex/experimental-native342-four-startup-post657-p10'),
                            dict(GITHUB_REF='refs/heads/codex/experimental-native342-four-startup-r7325-source01'),
                            dict(GITHUB_REF='refs/heads/codex/experimental-native-p12-ax-startup-source01'),
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
            size_in_bytes=launch.ARTIFACT['outer_bytes'], digest='sha256:'+launch.ARTIFACT['outer_sha256'],
            workflow_run=dict(id=p['run_id'], head_sha=p['controller_sha'], head_branch=p['branch'],
                              repository_id=10, head_repository_id=10))
        return value, run, artifact

    def test_exact_run_artifact_source_and_repository_required(self):
        value, run, artifact = self.identity()
        self.assertEqual(launch.artifact_identity(value, run, artifact)['artifact_id'], launch.case.PRODUCER_ARTIFACT)
        for changed in (dict(id=999), dict(head_sha='d' * 40), dict(head_branch='other'),
                        dict(conclusion='failure'), dict(run_attempt=2), dict(event='push'),
                        dict(repository=dict(full_name='other/repo'))):
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                launch.artifact_identity(value, {**run, **changed}, artifact)
        for changed in (dict(id=999), dict(name='other'), dict(expired=True),
                        dict(size_in_bytes=1), dict(digest='sha256:'+'0'*64),
                        dict(workflow_run={**artifact['workflow_run'], 'id': 999}),
                        dict(workflow_run={**artifact['workflow_run'], 'head_repository_id': 11})):
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                launch.artifact_identity(value, run, {**artifact, **changed})

    def test_original_P12_closed_outer_layout_selects_only_normal_role(self):
        # Immutable supplied bytes only: no ZIP extraction, signing or binary execution.
        import os
        root = Path(os.environ['P12_ORIGINAL_OUTER'])
        value = self.admission()
        manifest, archive = launch.handoff_files(root, value, launch.ARTIFACT['P'])
        self.assertEqual(manifest.relative_to(root).as_posix(), launch.ARTIFACT['normal_manifest'])
        self.assertEqual(archive.relative_to(root).as_posix(), launch.ARTIFACT['normal_archive'])
        self.assertNotIn('lifecycle', archive.parts)

    def inert_outer(self, root):
        roster = copy.deepcopy(launch.ARTIFACT)
        roster['files'] = {'normal/manifest.json': {}, 'normal/host-package.json': {},
                           'normal/normal.zip': {}, 'normal/lifecycle/fixture.zip': {}}
        roster['normal_manifest'], roster['normal_archive'] = 'normal/manifest.json', 'normal/normal.zip'
        folder = root / 'normal'; (folder/'lifecycle').mkdir(parents=True)
        archive = folder/'normal.zip'; archive.write_bytes(b'inert normal role')
        (folder/'lifecycle/fixture.zip').write_bytes(b'inert separate role')
        manifest = folder/'manifest.json'
        manifest.write_text(json.dumps(dict(identity=dict(purpose='normal-app-preparation',
            source=dict(revision=roster['P'])), container=dict(name=archive.name,
                size=archive.stat().st_size,sha256=launch.case.digest(archive)))))
        receipt = dict(status='PASS', scope=roster['producer_scope'], clock_failures=[], stop_signals=[],
            runtime=False, SDK_actor=False, producer_attempts=1, retries=0, pair=dict(P=roster['P']),
            admission=dict(controller_sha=launch.case.PRODUCER),
            handoff={f.name:dict(sha256=launch.case.digest(f),bytes=f.stat().st_size) for f in (manifest,archive)})
        (folder/'host-package.json').write_text(json.dumps(receipt))
        for name in roster['files']:
            file=root/name;roster['files'][name]=dict(bytes=file.stat().st_size,sha256=launch.case.digest(file))
        value=self.admission();value['manifest_sha256']=launch.case.digest(manifest)
        return roster,value

    def test_outer_layout_digest_type_and_role_refuse_adverse_members(self):
        for attack in ('extra','missing','symlink','hardlink','tamper','empty_directory','foreign_product','wrong_role'):
            with self.subTest(attack=attack), tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary).resolve();roster,value=self.inert_outer(root)
                with patch.object(launch,'ARTIFACT',roster):
                    self.assertEqual(launch.handoff_files(root,value,roster['P'])[1],root/'normal/normal.zip')
                    target=root/'normal/lifecycle/fixture.zip'
                    if attack=='extra': (root/'unadmitted').write_bytes(b'foreign')
                    elif attack=='missing': target.unlink()
                    elif attack=='symlink': target.unlink();target.symlink_to(root/'normal/normal.zip')
                    elif attack=='hardlink':
                        import os
                        target.unlink();os.link(root/'normal/normal.zip',target)
                    elif attack=='tamper': target.write_bytes(b'changed')
                    elif attack=='empty_directory': (root/'foreign-empty').mkdir()
                    elif attack=='foreign_product': roster['P']='f'*40
                    else: roster['normal_archive']='normal/lifecycle/fixture.zip'
                    with self.assertRaises(RuntimeError):launch.handoff_files(root,value,roster['P'])
