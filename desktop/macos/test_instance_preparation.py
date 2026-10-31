"""Prepared-file controls: synthetic inert bundles and mocked runtime only."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import json
import os
from pathlib import Path
import plistlib
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import instance_capture as capture
import instance_smoke as smoke


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.metadata = self.base / 'capture'
        self.destination = self.base / 'instances with spaces'
        self.observer = self.base / 'observer'
        self.observer.write_bytes(b'inert observer; never execute')
        self.target, self.harness = 'a' * 40, 'b' * 40
        capture.prepare(self.metadata, self.target, self.harness)
        self.run = capture.CaptureRun(self.metadata)
        self.sources = capture.source_snapshot()
        self.apps = [self.bundle(track) for track in ('dev', 'stable')]

    def bundle(self, track):
        app = self.base / track / 'NAC Instance Smoke.app'
        resources = app / 'Contents/Resources'
        resources.mkdir(parents=True)
        native = app / 'Contents/MacOS/NACPreview'
        native.parent.mkdir()
        native.write_bytes(b'inert native ' + track.encode())
        engine = resources / 'nac-web'
        engine.write_bytes(b'inert engine ' + track.encode())
        identifier = ('ai.arcee.nac.dev' if track == 'dev' else 'ai.arcee.nac') + '.instance-smoke'
        plist = app / 'Contents/Info.plist'
        plist.write_bytes(plistlib.dumps(dict(CFBundleIdentifier=identifier)))
        identity = dict(product_version='0.0.0', build_id='synthetic', source_revision=self.target, track=track)
        (resources / 'engine-identity.json').write_text(json.dumps(identity, indent=2) + '\n')
        receipt = dict(version=1, phase='unsigned-build', mode='instance-build',
            source_head=self.target, source_dirty=False, normal_startup=True, smoke_instrumentation=True,
            instance_smoke_instrumentation=True, preview_definitions_excluded=True,
            engine_identity=identity, bundle_identifier=identifier,
            bundle_name='synthetic', compiler_flags=[], sdk_version='synthetic',
            os_qualification='not_established_by_compilation',
            native_source_files={'desktop/macos/' + n + '.swift': self.sources[n + '.swift'] for n in capture.NATIVE_INPUTS},
            build_support_files={'desktop/macos/' + n: self.sources[n] for n in
                                 ('preview.sh', 'BundleIdentity.sh', 'build_receipt.py')},
            native_sha256=capture.sha(native.read_bytes()), engine_sha256=capture.sha(engine.read_bytes()),
            info_plist_sha256=capture.sha(plist.read_bytes()))
        (resources / 'build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        return app

    def prepare(self):
        return self.run.prepare_fixture(*self.apps, self.destination, self.observer)

    def consume(self, ready):
        return self.run.consume_prepared(ready['sha256'], *self.apps, self.destination, self.observer)

    def rewrite(self, name, value):
        path = self.metadata / name
        path.write_bytes(capture.encoded(value))
        path.chmod(0o600)

    def reject_overlap_without_input_mutation(self, destination):
        before = [capture.artifact_tree(app) for app in self.apps]
        existed = destination.exists()
        with patch.object(capture.os, 'mkdir', wraps=os.mkdir) as mkdir:
            with self.assertRaises(ValueError):
                self.run.prepare_fixture(*self.apps, destination, self.observer)
        after = [capture.artifact_tree(app) for app in self.apps]
        self.assertEqual(before, after, 'Rejected destination changed an original bundle inventory/identity/hash')
        self.assertEqual(destination.exists(), existed, 'Rejected destination changed the source namespace')
        mkdir.assert_not_called()
        self.assertFalse((self.metadata / 'preparation-resources.json').exists())
        self.assertFalse((self.metadata / 'prepared-fixture.json').exists())
        with self.assertRaises(ValueError):
            self.run.require_inline()

    def private_bundles(self):
        for track, app in zip(('dev', 'stable'), self.apps):
            app.chmod(0o700)
            (app / 'Contents').chmod(0o700)
            # Private ordinary bundle directories are valid builder artifacts.
            capture.bundle_snapshot(app, track, self.target, self.sources)

    def test_nested_dev_destination_rejects_before_mutating_private_input(self):
        self.private_bundles()
        self.reject_overlap_without_input_mutation(self.apps[0] / 'Contents/nested-fixture')

    def test_nested_stable_destination_rejects_before_mutating_private_input(self):
        self.private_bundles()
        self.reject_overlap_without_input_mutation(self.apps[1] / 'Contents/nested-fixture')

    def test_dev_and_stable_exact_ancestor_and_descendant_overlaps_reject_before_mkdir(self):
        self.private_bundles()
        for track, app in zip(('dev', 'stable'), self.apps):
            for relation, destination in (('exact', app), ('ancestor', app.parent), ('descendant', app / 'nested-fixture')):
                with self.subTest(track=track, relation=relation):
                    self.metadata = self.base / ('capture-' + track + '-' + relation)
                    capture.prepare(self.metadata, self.target, self.harness)
                    self.run = capture.CaptureRun(self.metadata)
                    self.reject_overlap_without_input_mutation(destination)

    def test_noncanonical_input_cannot_hide_destination_overlap(self):
        self.private_bundles()
        original = self.apps[0]
        self.apps[0] = original.parent / 'alias.app'
        self.apps[0].symlink_to(original, target_is_directory=True)
        before = [capture.artifact_tree(app) for app in (original, self.apps[1])]
        destination = original / 'Contents/nested-fixture'
        with patch.object(capture.os, 'mkdir', wraps=os.mkdir) as mkdir:
            with self.assertRaises(ValueError):
                self.run.prepare_fixture(*self.apps, destination, self.observer)
        self.assertEqual(before, [capture.artifact_tree(app) for app in (original, self.apps[1])])
        self.assertFalse(destination.exists())
        mkdir.assert_not_called()

    def test_separate_adjacent_private_destination_preserves_both_inputs(self):
        self.private_bundles()
        self.apps[0].parent.chmod(0o700)
        self.destination = self.apps[0].parent / 'NAC Instance Smoke.app.adjacent-fixture'
        before = [capture.artifact_tree(app) for app in self.apps]
        ready = self.prepare()
        self.assertEqual(before, [capture.artifact_tree(app) for app in self.apps])
        self.assertTrue(self.destination.is_dir())
        self.assertEqual(self.consume(ready), ready['receipt'])

    def test_file_only_preparation_binds_full_inventory_without_profiles(self):
        before = [capture.artifact_tree(app) for app in self.apps]
        with ExitStack() as stack:
            for name in ('Popen', 'run', 'check_output', 'call'):
                stack.enter_context(patch.object(subprocess, name, side_effect=AssertionError('child spawned')))
            stack.enter_context(patch.object(os, 'system', side_effect=AssertionError('shell')))
            stack.enter_context(patch.object(os, 'posix_spawn', side_effect=AssertionError('spawn')))
            stack.enter_context(patch.object(socket, 'socket', side_effect=AssertionError('network')))
            ready = self.prepare()
        self.assertEqual(before, [capture.artifact_tree(app) for app in self.apps])
        self.assertEqual(len(ready['receipt']['apps']), 2)
        self.assertEqual(len(self.run.manifest['frames']), 19)
        root = Path(ready['receipt']['root']['path'])
        self.assertEqual(sorted(p.name for p in root.iterdir()), ['Moved app with spaces 0', 'Moved app with spaces 1'])
        self.assertFalse((self.metadata / 'admission.json').exists())
        self.assertFalse(any(p.name.startswith('journey-') for p in self.metadata.iterdir()))
        for path in self.metadata.iterdir():
            self.assertLessEqual(path.stat().st_size, capture.LIMIT)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(ready['sha256'], capture.sha((self.metadata / 'prepared-fixture.json').read_bytes()))
        self.assertEqual(self.consume(ready), ready['receipt'])
        with self.assertRaises(OSError):
            self.consume(ready)
        with self.assertRaises(ValueError):
            self.prepare()

    def test_concurrent_preparations_and_consumers_have_one_winner(self):
        def attempt(function):
            try:
                return function()
            except OSError:
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(self.prepare), range(2)))
        ready, = [r for r in results if r is not None]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(lambda: self.consume(ready)), range(2)))
        self.assertEqual(sum(r is not None for r in results), 1)

    def test_fresh_attempt_nonces_differ(self):
        first = self.prepare()['receipt']
        other = self.base / 'other-capture'
        capture.prepare(other, self.target, self.harness)
        second = capture.CaptureRun(other).prepare_fixture(*self.apps, self.base / 'other-instances', self.observer)['receipt']
        self.assertNotEqual(first['run_nonce'], second['run_nonce'])
        self.assertNotEqual(first['preparation_nonce'], second['preparation_nonce'])

    def test_wrong_digest_context_source_and_manifest_fail_closed(self):
        ready = self.prepare()
        with self.assertRaises(ValueError):
            self.run.consume_prepared('0' * 64, *self.apps, self.destination, self.observer)
        with self.assertRaises(ValueError):
            self.run.require_inline()
        with patch.object(capture, 'source_snapshot', return_value={}):
            with self.assertRaises(ValueError):
                self.consume(ready)
        manifest = dict(self.run.manifest, frames=self.run.manifest['frames'][:-1])
        self.rewrite('manifest.json', manifest)
        with self.assertRaises(ValueError):
            self.consume(ready)
        self.assertFalse((self.metadata / 'admission.json').exists())

    def test_nested_extra_fields_and_pid_are_rejected_even_with_new_digest(self):
        ready = self.prepare()
        ready['receipt']['apps'][0]['moved']['pid'] = 123
        self.rewrite('prepared-fixture.json', ready['receipt'])
        ready['sha256'] = capture.sha(capture.encoded(ready['receipt']))
        with self.assertRaises(ValueError):
            self.consume(ready)

    def test_missing_registration_and_consumption_admission_gap_never_resume(self):
        ready = self.prepare()
        resources = self.metadata / 'preparation-resources.json'
        saved = resources.read_bytes()
        resources.unlink()
        with self.assertRaises(FileNotFoundError):
            self.consume(ready)
        resources.write_bytes(saved)
        resources.chmod(0o600)
        with patch.object(self.run, 'admit', side_effect=RuntimeError('admission gap')):
            with self.assertRaisesRegex(RuntimeError, 'admission gap'):
                self.consume(ready)
        self.assertTrue((self.metadata / 'preparation-consumption.json').exists())
        self.assertFalse((self.metadata / 'admission.json').exists())
        with self.assertRaises(OSError):
            self.consume(ready)

    def test_same_bytes_replaced_moved_inode_is_rejected(self):
        ready = self.prepare()
        engine = Path(ready['receipt']['apps'][0]['moved']['path']) / 'Contents/Resources/nac-web'
        original = engine.read_bytes()
        replacement = engine.with_name('replacement')
        replacement.write_bytes(original)
        os.replace(replacement, engine)
        with self.assertRaises(ValueError):
            self.consume(ready)

    def test_observer_and_foreign_destination_cannot_select_resources(self):
        ready = self.prepare()
        with self.assertRaises(ValueError):
            self.run.consume_prepared(ready['sha256'], *self.apps, self.base / 'foreign', self.observer)
        self.observer.write_bytes(b'substituted')
        with self.assertRaises(ValueError):
            self.consume(ready)

    def test_source_track_support_and_bool_schema_tampering_reject(self):
        path = self.apps[0] / 'Contents/Resources/build-receipt.json'
        original = json.loads(path.read_bytes())
        mutations = [dict(source_head='c' * 40), dict(version=True), dict(source_dirty=True),
                     dict(build_support_files={}), dict(native_source_files={}), dict(bundle_identifier='wrong'),
                     dict(executed_version='not actually executed')]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                path.write_text(json.dumps(dict(original, **mutation)))
                with self.assertRaises(ValueError):
                    capture.bundle_snapshot(self.apps[0], 'dev', self.target, self.sources)
        path.write_text(json.dumps(original))
        with self.assertRaises(ValueError):
            capture.bundle_snapshot(self.apps[0], 'stable', self.target, self.sources)

    def test_private_record_duplicate_noncanonical_oversize_and_extras_reject(self):
        ready = self.prepare()
        path = self.metadata / 'prepared-fixture.json'
        original = path.read_bytes()
        for raw in (b'{"schema":1,"schema":1}', b'{}\n', b' ' * (capture.LIMIT + 1),
                    capture.encoded(dict(ready['receipt'], pid=123))):
            with self.subTest(raw=raw[:50]):
                path.write_bytes(raw)
                with self.assertRaises(ValueError):
                    self.consume(dict(ready, sha256=capture.sha(raw)))
        path.write_bytes(original)

    def test_ordinary_metadata_accepts_pretty_json_but_rejects_duplicate_and_oversize(self):
        path = self.apps[0] / 'Contents/Resources/engine-identity.json'
        self.assertIsInstance(capture.artifact_record(path)[0], dict)
        for raw in (b'{"track":"dev","track":"dev"}', b'{"n":NaN}', b' ' * (capture.LIMIT + 1)):
            path.write_bytes(raw)
            with self.assertRaises(ValueError):
                capture.artifact_record(path)

    def test_no_follow_fifo_hardlink_writable_and_unexpected_layout_reject(self):
        engine = self.apps[0] / 'Contents/Resources/nac-web'
        raw = engine.read_bytes()
        engine.unlink()
        engine.symlink_to(self.observer)
        with self.assertRaises(ValueError):
            capture.artifact_tree(self.apps[0])
        engine.unlink()
        os.mkfifo(engine)
        with self.assertRaises(ValueError):
            capture.artifact_tree(self.apps[0])
        engine.unlink()
        os.link(self.observer, engine)
        with self.assertRaises(ValueError):
            capture.artifact_tree(self.apps[0])
        engine.unlink()
        engine.write_bytes(raw)
        engine.chmod(0o666)
        with self.assertRaises(ValueError):
            capture.artifact_tree(self.apps[0])
        engine.chmod(0o644)
        (engine.parent / 'unexpected').write_bytes(b'x')
        with self.assertRaises(ValueError):
            capture.bundle_snapshot(self.apps[0], 'dev', self.target, self.sources)

    def test_symlinked_artifact_ancestor_and_destination_reject(self):
        link = self.base / 'alias'
        link.symlink_to(self.apps[0].parent, target_is_directory=True)
        with self.assertRaises(ValueError):
            capture.artifact_tree(link / self.apps[0].name)
        link.unlink()
        link.symlink_to(self.base, target_is_directory=True)
        self.destination = link / 'foreign-root'
        with self.assertRaises(ValueError):
            self.prepare()

    def test_failure_before_registration_retains_unknown_and_denies_retry(self):
        original = capture.Directory.write
        def fail_resources(files, name, value):
            if name == 'preparation-resources.json':
                raise RuntimeError('registration interrupted')
            return original(files, name, value)
        with patch.object(capture.Directory, 'write', fail_resources):
            with self.assertRaisesRegex(RuntimeError, 'registration interrupted') as caught:
                self.prepare()
        status = caught.exception.instance_preparation_status
        self.assertEqual(status['registration'], 'unproved')
        self.assertTrue(status['unknown_resources'])
        self.assertTrue(status['retention_required'])
        self.assertTrue(self.destination.exists())
        with self.assertRaises(OSError):
            self.prepare()
        with self.assertRaises(ValueError):
            self.run.require_inline()

    def test_copy_ready_and_failure_record_faults_preserve_primary_and_quarantine(self):
        primary = RuntimeError('copy failed')
        original = capture.Directory.write
        def fail_status(files, name, value):
            if name == 'preparation-failure.json':
                raise OSError('status write failed')
            return original(files, name, value)
        with patch.object(capture, 'artifact_tree', side_effect=primary), patch.object(capture.Directory, 'write', fail_status):
            with self.assertRaises(RuntimeError) as caught:
                self.prepare()
        self.assertIs(caught.exception, primary)
        self.assertEqual(primary.instance_preparation_status['registration'], 'registered')
        self.assertFalse(primary.instance_preparation_status['unknown_resources'])
        self.assertEqual(primary.instance_cleanup_errors[0]['message'], 'status write failed')
        self.assertTrue(self.destination.exists())
        self.assertFalse((self.metadata / 'prepared-fixture.json').exists())

    def test_descriptor_close_fault_attempts_remaining_descriptors_preserves_primary(self):
        primary = RuntimeError('read failed')
        with patch.object(capture.os, 'close', side_effect=[OSError('first close'), None]) as close:
            capture.artifact_close(primary, 1000, 1001)
        self.assertEqual(close.call_args_list[1].args, (1001,))
        self.assertEqual(primary.instance_cleanup_errors[0]['owner'], 'artifact-descriptor')

    def test_faults_at_claim_registration_copy_and_ready_publication_quarantine(self):
        original_write, original_bundle = capture.Directory.write, capture.bundle_snapshot
        for index, stage in enumerate(('preparation-admission.json', 'preparation-resources.json',
                                       'first-copied', 'second-copied', 'prepared-fixture.json')):
            with self.subTest(stage=stage):
                metadata, destination = self.base / ('fault-' + str(index)), self.base / ('files-' + str(index))
                capture.prepare(metadata, self.target, self.harness)
                run = capture.CaptureRun(metadata)
                primary = RuntimeError(stage)
                calls = []
                def write(files, name, value):
                    if name == stage:
                        raise primary
                    return original_write(files, name, value)
                def bundle(*args):
                    calls.append(args[0])
                    result = original_bundle(*args)
                    if (stage == 'first-copied' and len(calls) == 2) or (stage == 'second-copied' and len(calls) == 4):
                        raise primary
                    return result
                with patch.object(capture.Directory, 'write', write), patch.object(capture, 'bundle_snapshot', bundle):
                    with self.assertRaises(RuntimeError) as caught:
                        run.prepare_fixture(*self.apps, destination, self.observer)
                self.assertIs(caught.exception, primary)
                self.assertFalse((metadata / 'prepared-fixture.json').exists())
                if stage != 'preparation-admission.json':
                    self.assertTrue(destination.exists())
                    status = primary.instance_preparation_status
                    self.assertEqual(status['registration'], 'unproved' if stage == 'preparation-resources.json' else 'registered')
                    self.assertTrue(status['retention_required'])
                    with self.assertRaises(ValueError):
                        run.require_inline()

    def test_replaced_root_same_files_is_rejected_without_adopting_it(self):
        ready = self.prepare()
        root = Path(ready['receipt']['root']['path'])
        saved = root.with_name('saved')
        root.rename(saved)
        shutil.copytree(saved, root)
        with self.assertRaises(ValueError):
            self.consume(ready)
        self.assertTrue(saved.exists())
        self.assertTrue(root.exists())

    def test_foreign_owner_private_record_mode_and_ancestor_link_are_denied(self):
        with patch.object(capture.os, 'geteuid', return_value=-1):
            with self.assertRaises(ValueError):
                capture.artifact_tree(self.apps[0])
        ready = self.prepare()
        record = self.metadata / 'prepared-fixture.json'
        record.chmod(0o644)
        with self.assertRaises(ValueError):
            self.consume(ready)
        record.chmod(0o600)
        link = self.base / 'metadata-alias'
        link.symlink_to(self.metadata, target_is_directory=True)
        with self.assertRaises(ValueError):
            capture.CaptureRun(link)

    def test_prepared_directory_close_preserves_primary(self):
        primary = RuntimeError('metadata operation')
        original = os.close
        owned = {}
        def close(value):
            original(value)
            if value == owned.get('fd'):
                raise OSError('descriptor close unproved')
        with self.assertRaises(RuntimeError) as caught:
            with patch.object(capture.os, 'close', side_effect=close):
                with capture.prepared_directory(self.metadata) as files:
                    owned['fd'] = files.fd
                    raise primary
        self.assertIs(caught.exception, primary)
        self.assertIn('descriptor close unproved', [r['message'] for r in primary.instance_cleanup_errors])

    def test_artifact_open_close_failure_closes_new_handle_without_retrying_old(self):
        original, closed = os.close, []
        primary = OSError('ancestor close unproved')
        def close(fd):
            closed.append(fd)
            original(fd)
            if len(closed) == 1:
                raise primary
        with patch.object(capture.os, 'close', side_effect=close):
            with self.assertRaises(OSError) as caught:
                capture.artifact_open(self.observer)
        self.assertIs(caught.exception, primary)
        self.assertEqual(len(closed), 2)
        self.assertNotEqual(closed[0], closed[1])

    def runtime(self, ready=None, fail=None, summary_failure=False, forbid_probes=False, capture_disabled=False):
        events = []
        def output(argv, **kwargs):
            if argv == ['git', 'rev-parse', 'HEAD']:
                return self.target + '\n'
            if argv[:2] == ['git', 'status']:
                return b''
            if forbid_probes:
                raise AssertionError('product or SDK probe reached')
            if argv[-1] == '--version' and 'nac-web' in argv[0]:
                events.append('version-' + ('stable' if 'spaces 1' in argv[0] else 'dev'))
            return 'mock'
        original_copy = shutil.copytree
        def copy(source, target, *args, **kwargs):
            if source in self.apps:
                events.append('copy-' + ('stable' if source == self.apps[1] else 'dev'))
            return original_copy(source, target, *args, **kwargs)
        def case(name, *_):
            events.append('case-' + name)
            if fail is not None:
                raise fail
            return dict(passed=True)
        env = {} if capture_disabled else {capture.ENVIRONMENT: str(self.metadata)}
        if ready is not None:
            env[capture.PREPARED_ENVIRONMENT] = ready['sha256']
        argv = ['instance_smoke.py', str(self.apps[0]), str(self.destination), str(self.observer), str(self.apps[1])]
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            stack.enter_context(patch.object(sys, 'argv', argv))
            stack.enter_context(patch.object(smoke.subprocess, 'check_output', side_effect=output))
            stack.enter_context(patch.object(smoke.subprocess, 'run', return_value=Mock(returncode=0, stdout='', stderr='')))
            stack.enter_context(patch.object(smoke, 'require_console', return_value={},
                side_effect=AssertionError('console reached') if forbid_probes else None))
            stack.enter_context(patch.object(smoke.shutil, 'copytree', side_effect=copy))
            stack.enter_context(patch.object(smoke, 'workspace_case', side_effect=lambda *args: case('simultaneous', *args)))
            stack.enter_context(patch.object(smoke, 'app_crash_case', side_effect=lambda *args: case('app-crash', *args)))
            stack.enter_context(patch.object(smoke, 'coexist_case', side_effect=lambda *args: case('coexist', *args)))
            stack.enter_context(patch.object(smoke, 'conflict_case', side_effect=case))
            stack.enter_context(patch.object(capture.CaptureRun, 'final_receipt', return_value=dict(capture_verified=False)))
            if summary_failure:
                stack.enter_context(patch.object(Path, 'write_text', side_effect=OSError('summary write failed')))
            smoke.main()
        return events

    def test_default_inline_preserves_copy_version_and_full_case_order(self):
        self.assertEqual(self.runtime(capture_disabled=True), ['copy-dev', 'version-dev', 'copy-stable', 'version-stable'] +
                         ['case-' + case for case in smoke.SCENARIOS])
        summary = json.loads((self.destination / 'summary.json').read_bytes())
        self.assertNotIn('preparation', summary)
        self.assertNotIn('capture_fixture', summary)

    def test_prepared_runtime_versions_then_full_cases_and_removes_only_owned_root(self):
        ready = self.prepare()
        self.assertEqual(self.runtime(ready), ['version-dev', 'version-stable'] + ['case-' + case for case in smoke.SCENARIOS])
        summary = json.loads((self.destination / 'summary.json').read_bytes())
        self.assertTrue(summary['runtime_passed'])
        self.assertFalse(summary['capture_fixture']['capture_verified'])
        self.assertFalse(Path(ready['receipt']['root']['path']).exists())
        self.assertTrue(all(app.exists() for app in self.apps))
        self.assertTrue(self.metadata.exists())

    def test_runtime_failure_retains_root_primary_and_summary_error(self):
        ready = self.prepare()
        primary = RuntimeError('journey failed')
        with self.assertRaises(RuntimeError) as caught:
            self.runtime(ready, fail=primary, summary_failure=True)
        self.assertIs(caught.exception, primary)
        self.assertEqual(primary.instance_cleanup_errors[0]['owner'], 'instance-summary')
        self.assertTrue(Path(ready['receipt']['root']['path']).exists())

    def test_success_still_deletes_root_when_summary_publication_fails(self):
        ready = self.prepare()
        with self.assertRaises(OSError) as caught:
            self.runtime(ready, summary_failure=True)
        self.assertTrue(caught.exception.instance_cleanup_only)
        self.assertFalse(Path(ready['receipt']['root']['path']).exists())
        self.assertTrue(all(app.exists() for app in self.apps))

    def test_bad_prepared_runtime_does_not_reach_console_or_product_probes(self):
        ready = self.prepare()
        self.observer.write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            self.runtime(ready, forbid_probes=True)
        summary = json.loads((self.destination / 'summary.json').read_bytes())
        self.assertEqual(summary['preparation']['registration'], 'unproved')
        self.assertTrue(summary['preparation']['unknown_resources'])
        self.assertTrue(summary['preparation']['retention_required'])
        self.assertFalse(summary['fixture_retained'])  # Legacy field is not a settlement proof.
        self.assertTrue(Path(ready['receipt']['root']['path']).exists())

    def test_selector_without_context_or_bad_digest_rejects_before_children(self):
        for env in ({capture.PREPARED_ENVIRONMENT: 'a' * 64},
                    {capture.PREPARED_ENVIRONMENT: 'BAD', capture.ENVIRONMENT: str(self.metadata)}):
            with patch.dict(os.environ, env, clear=True), patch.object(subprocess, 'check_output', side_effect=AssertionError('probe')):
                with self.assertRaises(ValueError):
                    smoke.main()


if __name__ == '__main__':
    unittest.main()
