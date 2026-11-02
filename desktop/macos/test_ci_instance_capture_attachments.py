"""Full-roster synthetic export and no-follow/retained-prefix controls."""
import copy
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ci_instance_capture_contract import MAX_IMAGES, MAX_PNG, MAX_TEXT, decode, digest, encoded, frames
from ci_instance_capture_attachments import (CollectionError, ExportDirectory, TEST_IDENTIFIER, TEST_URL, collect)
from test_ci_instance_capture_contract import PNG, SyntheticRun


class ExportFixture:
    def __init__(self, directory):
        self.directory = directory
        self.run = SyntheticRun()
        self.origin = dict(test_identifier=TEST_IDENTIFIER, test_identifier_url=TEST_URL,
            result_bundle_sha256='b' * 64, resource_sha256=digest(self.run.resource_raw), result='Passed')
        self.index = dict(schema='nac343-selected-export-v1', origin=copy.deepcopy(self.origin), attachments=[])
        self.metadata = []
        for frame, phase in zip(frames(), self.run.phases):
            app = self.run.resource['apps'][1 if frame['track'] == 'stable' else 0]
            value = dict(schema='nac343-public-capture-v1', resource_sha256=digest(self.run.resource_raw),
                phase_before=copy.deepcopy(phase), phase_after=copy.deepcopy(phase), bundle_path=app['bundle_path'],
                quartz_bounds=[0, 0, 1, 1], pixel_size=[1, 1], scale=1, png_sha256=digest(PNG), png_bytes=len(PNG), foreground=True)
            self.metadata.append(value)
            number = frame['ordinal']
            raw = encoded(value)
            entry = dict(ordinal=number, key=frame['key'], metadata='frame-%02d.json' % number,
                         png='frame-%02d.png' % number, metadata_sha256=digest(raw), png_sha256=digest(PNG))
            self.index['attachments'].append(entry)
            (directory / entry['metadata']).write_bytes(raw)
            (directory / entry['png']).write_bytes(PNG)
        self.evidence = self.run.evidence()

    def update(self, number, change):
        value = self.metadata[number - 1]
        change(value)
        raw = encoded(value)
        entry = self.index['attachments'][number - 1]
        (self.directory / entry['metadata']).write_bytes(raw)
        entry['metadata_sha256'] = digest(raw)

    def collect(self):
        return collect(self.directory, encoded(self.index, MAX_TEXT), self.run.resource_raw,
                       self.run.pins, self.origin, self.evidence)

    def rebind(self, number, before=None, request=None):
        """Change declared private/public data together, without a stale digest."""
        retained = self.evidence['frames'][number - 1]
        value = decode(retained['request'])
        if before:
            value['before'].update(before)
        if request:
            value.update(request)
        retained['request'] = encoded(value)
        fence = decode(retained['fence'])
        fence.update({k: value[k] for k in ('run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256')})
        fence.update(request_sha256=digest(retained['request']), before=value['before'], after=value['before'])
        retained['fence'] = encoded(fence)
        def metadata(v):
            for key in ('phase_before', 'phase_after'):
                v[key].update({k: value[k] for k in ('run_nonce', 'request_nonce', 'ordinal', 'key', 'configuration_sha256')})
                v[key].update({k: value['before'][k] for k in
                               ('track', 'app_pid', 'app_incarnation', 'app_launch_epoch', 'window_number')})
                v[key]['request_sha256'] = digest(retained['request'])
        self.update(number, metadata)


class CollectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()
        self.directory.chmod(0o700)
        self.fixture = ExportFixture(self.directory)

    def failure(self, prefix):
        with self.assertRaises(CollectionError) as caught:
            self.fixture.collect()
        partial = caught.exception.partial
        self.assertFalse(partial.report['structurally_complete'])
        self.assertFalse(partial.report['rejected_input_retained'])
        self.assertEqual(len(partial.report['frames']), prefix)
        self.assertEqual(len(partial.pairs), prefix)
        self.assertEqual(partial.report['native_acceptance'], 'unqualified')
        self.assertNotIn('capture_verified', partial.report)
        return partial

    def test_full_nineteen_pairs_join_all_eight_semantic_receipts_and_private_fences(self):
        before = {p.name: p.read_bytes() for p in self.directory.iterdir()}
        result = self.fixture.collect()
        self.assertTrue(result.report['structurally_complete'])
        self.assertEqual(len(result.pairs), 19)
        self.assertEqual([f['ordinal'] for f in result.report['frames']], list(range(1, 20)))
        self.assertEqual([f['key'] for f in result.report['frames']], list(self.fixture.run.manifest['frames'][i]['key'] for i in range(19)))
        self.assertEqual([c['scenario'] for c in result.report['semantic_receipts']],
                         ['simultaneous', 'cli', 'symlink', 'directory-symlink', 'crash', 'shutdown', 'app-crash', 'coexist'])
        self.assertEqual(result.report['frames'][18]['fence_sha256'], digest(self.fixture.evidence['frames'][18]['fence']))
        self.assertTrue(result.report['semantic_validation_required'])
        self.assertTrue(result.report['image_decoding_required'])
        self.assertEqual(result.report['native_acceptance'], 'unqualified')
        self.assertNotIn('capture_verified', result.report)
        self.assertEqual({p.name: p.read_bytes() for p in self.directory.iterdir()}, before)

    def test_complete_join_never_launches_calls_network_or_reopens_gone_t_roots(self):
        real_open = os.open
        def only_export(path, flags, *args, **kwargs):
            if os.fspath(path).startswith('/private/nonexistent'):
                raise AssertionError('T roots must not be reopened after their legitimate deletion')
            return real_open(path, flags, *args, **kwargs)
        with patch('os.open', side_effect=only_export), \
                patch.object(subprocess, 'Popen', side_effect=AssertionError('process')), \
                patch.object(subprocess, 'run', side_effect=AssertionError('process')), \
                patch.object(socket, 'socket', side_effect=AssertionError('network')):
            self.assertTrue(self.fixture.collect().report['structurally_complete'])

    def test_missing_last_pair_preserves_eighteen_and_never_infers_completion(self):
        self.fixture.index['attachments'].pop()
        self.failure(18)

    def test_index_gap_duplicate_order_boolean_key_and_extra_fields_fail(self):
        original = copy.deepcopy(self.fixture.index)
        for change, prefix in ((lambda rows: rows[2].update(ordinal=4), 2),
                               (lambda rows: rows[2].update(ordinal=True), 2),
                               (lambda rows: rows[2].update(key=rows[1]['key']), 2),
                               (lambda rows: rows.reverse(), 0),
                               (lambda rows: rows[2].update(private_path='/secret'), 0),
                               (lambda rows: rows.append(copy.deepcopy(rows[-1])), 0)):
            self.fixture.index = copy.deepcopy(original)
            change(self.fixture.index['attachments'])
            with self.subTest(change=change): self.failure(prefix)

    def test_foreign_test_result_resource_and_missing_origin_fail_before_any_pair(self):
        original = copy.deepcopy(self.fixture.index)
        for key, value in (('test_identifier_url', 'foreign'), ('test_identifier', 'otherTest()'),
                           ('result_bundle_sha256', 'c' * 64), ('resource_sha256', 'c' * 64), ('result', 'Failed')):
            self.fixture.index = copy.deepcopy(original)
            self.fixture.index['origin'][key] = value
            with self.subTest(field=key): self.failure(0)
        self.fixture.index = copy.deepcopy(original)
        self.fixture.origin['test_identifier'] = 'otherTest()'
        self.fixture.index['origin'] = copy.deepcopy(self.fixture.origin)
        self.failure(0)

    def test_aliases_escaping_absolute_and_unsafe_names_never_read(self):
        original = copy.deepcopy(self.fixture.index)
        for name in ('../frame-01.json', '/frame-03.json', 'nested/frame-03.json', 'frame-03.json\0', '.', ''):
            self.fixture.index = copy.deepcopy(original)
            self.fixture.index['attachments'][2]['metadata'] = name
            with self.subTest(name=name): self.failure(0)
        self.fixture.index = copy.deepcopy(original)
        self.fixture.index['attachments'][2]['metadata'] = self.fixture.index['attachments'][0]['metadata']
        self.failure(0)

    def test_every_public_phase_binding_and_wrong_type_stops_at_valid_prefix(self):
        original = copy.deepcopy(self.fixture.metadata[2])
        for field, value in (('run_nonce', 'f' * 32), ('request_nonce', 'f' * 32), ('ordinal', True),
            ('key', 'other'), ('configuration_sha256', 'f' * 64), ('manifest_sha256', 'f' * 64),
            ('request_sha256', 'f' * 64), ('track', 'stable'), ('app_pid', '999'),
            ('app_incarnation', '00000000-0000-4000-8000-000000000099'), ('app_launch_epoch', '999.0'),
            ('window_number', '999'), ('schema', 'retired')):
            self.fixture.metadata[2] = copy.deepcopy(original)
            self.fixture.update(3, lambda v: v['phase_before'].update({field: value}))
            with self.subTest(field=field): self.failure(2)
        self.fixture.metadata[2] = copy.deepcopy(original)
        self.fixture.update(3, lambda v: v['phase_after'].update(window_number='999'))
        self.failure(2)

    def test_unknown_actor_fields_private_data_wrong_bundle_geometry_and_png_digest_fail(self):
        original = copy.deepcopy(self.fixture.metadata[2])
        mutations = (lambda v: v.update(store='/secret'), lambda v: v['phase_after'].update(retired=True),
            lambda v: v.update(bundle_path='/foreign.app'), lambda v: v.update(foreground=False),
            lambda v: v.update(resource_sha256='f' * 64), lambda v: v.update(png_bytes=True),
            lambda v: v.update(png_sha256='f' * 64), lambda v: v.update(scale=True),
            lambda v: v.update(pixel_size=[True, 1]), lambda v: v.update(scale=2),
            lambda v: v.update(quartz_bounds=[0, 0, -1, 1]), lambda v: v.update(quartz_bounds=[0, 0, 1]))
        for mutate in mutations:
            self.fixture.metadata[2] = copy.deepcopy(original)
            self.fixture.update(3, mutate)
            with self.subTest(mutate=mutate): self.failure(2)

    def test_export_json_duplicate_nonfinite_and_foreign_hash_never_retained(self):
        entry = self.fixture.index['attachments'][2]
        for raw in (b'{"FOREIGN":', b'{"a":1,"a":2}', b'{"a":NaN}'):
            (self.directory / entry['metadata']).write_bytes(raw)
            entry['metadata_sha256'] = digest(raw)
            partial = self.failure(2)
            self.assertTrue(all(b'FOREIGN' not in metadata for metadata, _ in partial.pairs))
        self.fixture.update(3, lambda v: None)
        entry['metadata_sha256'] = 'f' * 64
        self.failure(2)

    def test_special_symlink_hardlink_and_group_writable_files_fail_without_following(self):
        path = self.directory / self.fixture.index['attachments'][2]['png']
        target = self.directory / 'target'
        target.write_bytes(PNG)
        for kind in ('symlink', 'directory', 'fifo', 'hardlink', 'writable'):
            path.unlink()
            if kind == 'symlink': path.symlink_to(target)
            elif kind == 'directory': path.mkdir()
            elif kind == 'fifo': os.mkfifo(path)
            elif kind == 'hardlink': os.link(target, path)
            else: path.write_bytes(PNG); path.chmod(0o666)
            with self.subTest(kind=kind): self.failure(2)
            if kind == 'directory': path.rmdir()
            else: path.unlink()
            path.write_bytes(PNG)

    def test_missing_oversized_empty_and_non_png_files_retain_only_valid_prefix(self):
        path = self.directory / self.fixture.index['attachments'][2]['png']
        path.unlink(); self.failure(2)
        for data in (b'', b'x' * (MAX_PNG + 1), b'not PNG'):
            path.write_bytes(data)
            self.fixture.index['attachments'][2]['png_sha256'] = digest(data)
            with self.subTest(size=len(data)): self.failure(2)

    def test_original_source_digest_or_preparation_mismatch_cannot_be_repaired_by_export(self):
        self.fixture.evidence['prepared'] += b' '
        self.failure(0)

    def test_private_after_fence_mutation_retirement_missing_diagnostic_and_boolean_fail(self):
        original = copy.deepcopy(self.fixture.evidence)
        for field, change in (('fence', lambda v: v['after'].update(loading='true')),
                              ('fence', lambda v: v.update(retired=True)),
                              ('request', lambda v: v.update(ordinal=True)),
                              ('request', lambda v: v.update(request_nonce='f' * 32))):
            self.fixture.evidence = copy.deepcopy(original)
            raw = self.fixture.evidence['frames'][2][field]
            value = decode(raw); change(value)
            self.fixture.evidence['frames'][2][field] = encoded(value)
            with self.subTest(field=field): self.failure(2)
        self.fixture.evidence = copy.deepcopy(original)
        self.fixture.evidence['frames'][2]['diagnostic'] = b''
        self.failure(2)

    def test_text_and_image_aggregate_bounds_are_enforced(self):
        self.fixture.evidence['summary'] = b' ' * (MAX_TEXT + 1)
        self.failure(0)
        self.fixture.evidence = self.fixture.run.evidence()
        # Seven individually legal 2MiB diagnostic images cross the total cap.
        for record in self.fixture.evidence['frames']:
            record['diagnostic'] = PNG + b'x' * (MAX_PNG - len(PNG))
        self.failure(5)

    def test_consistently_rebound_nonce_replay_and_mid_journey_replacement_still_fail(self):
        self.fixture.rebind(3, request=dict(request_nonce=self.fixture.run.phases[0]['request_nonce']))
        self.failure(2)
        self.fixture = ExportFixture(self.directory)
        self.fixture.rebind(2, before=dict(app_incarnation='00000000-0000-4000-8000-000000000099'))
        self.failure(1)

    def test_app_crash_requires_a_successor_and_coexist_requires_two_app_pids(self):
        initial = self.fixture.run.phases[12]
        self.fixture.rebind(14, before={k: initial[k] for k in ('app_pid', 'app_incarnation', 'app_launch_epoch')})
        self.failure(13)
        self.fixture = ExportFixture(self.directory)
        self.fixture.rebind(17, before=dict(app_pid=self.fixture.run.phases[15]['app_pid']))
        self.failure(16)

    def test_conflict_to_workspace_can_change_window_between_phases(self):
        self.fixture.rebind(4, before=dict(window_number='999'))
        self.assertTrue(self.fixture.collect().report['structurally_complete'])

    def test_aggregate_text_is_bounded_even_when_each_record_is_legal(self):
        # Legal summary alone is insufficient when the joined record set is
        # over budget. This padding is opaque extra diagnostic data, not proof.
        summary = decode(self.fixture.evidence['summary'])
        summary['diagnostic_padding'] = 'x' * (MAX_TEXT - len(encoded(summary)) - 100)
        self.fixture.evidence['summary'] = encoded(summary, MAX_TEXT)
        self.failure(0)

    def test_directory_close_failure_cannot_turn_a_partial_or_complete_join_into_success(self):
        original = ExportDirectory.close
        def failed_close(owner):
            original(owner)
            raise OSError('synthetic final close failure')
        with patch.object(ExportDirectory, 'close', failed_close):
            partial = self.failure(19)
        self.assertEqual(partial.report['failure_type'], 'export-close')
        self.fixture.update(3, lambda v: v.update(foreground=False))
        with patch.object(ExportDirectory, 'close', failed_close):
            partial = self.failure(2)
        self.assertTrue(partial.report['export_close_failed'])

    def test_interruption_keeps_original_identity_prefix_and_independent_close_error(self):
        original_read, original_close = ExportDirectory.read, ExportDirectory.close
        interruption = KeyboardInterrupt('synthetic interruption, no OS signal')
        def reading(owner, name, limit):
            if name == 'frame-03.json':
                raise interruption
            return original_read(owner, name, limit)
        def closing(owner):
            original_close(owner)
            raise OSError('synthetic final close failure')
        with patch.object(ExportDirectory, 'read', reading), patch.object(ExportDirectory, 'close', closing):
            with self.assertRaises(KeyboardInterrupt) as caught:
                self.fixture.collect()
        self.assertIs(caught.exception, interruption)
        partial = interruption.instance_capture_partial
        self.assertEqual(len(partial.pairs), 2)
        self.assertFalse(partial.report['structurally_complete'])
        self.assertTrue(partial.report['export_close_failed'])


class DescriptorControls(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.parent = Path(temporary.name).resolve()
        self.parent.chmod(0o700)
        self.export = self.parent / 'export'
        self.export.mkdir(mode=0o700)
        self.fixture = ExportFixture(self.export)

    def test_symlink_ancestor_and_nonprivate_export_refuse(self):
        alias = self.parent / 'alias'; alias.symlink_to(self.export, target_is_directory=True)
        with self.assertRaises(OSError): ExportDirectory(alias)
        self.export.chmod(0o755)
        with self.assertRaises(ValueError): ExportDirectory(self.export)

    def test_short_read_retains_two_pairs_and_closes_all_export_descriptors(self):
        target = (self.export / 'frame-03.json').stat().st_ino
        real_read, real_open, real_close = os.read, os.open, os.close
        opened, closed = [], []
        def opening(*args, **kwargs):
            fd = real_open(*args, **kwargs); opened.append(fd); return fd
        def closing(fd):
            closed.append(fd); return real_close(fd)
        def reading(fd, count):
            return b'' if os.fstat(fd).st_ino == target else real_read(fd, count)
        with patch('os.open', side_effect=opening), patch('os.close', side_effect=closing), patch('os.read', side_effect=reading):
            with self.assertRaises(CollectionError) as caught: self.fixture.collect()
        self.assertEqual(len(caught.exception.partial.pairs), 2)
        self.assertEqual(sorted(opened), sorted(closed))

    def test_named_file_replacement_during_read_is_rejected(self):
        path = self.export / 'frame-03.json'; target = path.stat().st_ino
        real_read = os.read
        replaced = False
        def reading(fd, count):
            nonlocal replaced
            data = real_read(fd, count)
            if not replaced and os.fstat(fd).st_ino == target:
                replaced = True
                replacement = self.export / 'replacement'; replacement.write_bytes(path.read_bytes())
                os.replace(replacement, path)
            return data
        with patch('os.read', side_effect=reading), self.assertRaises(CollectionError) as caught:
            self.fixture.collect()
        self.assertEqual(len(caught.exception.partial.pairs), 2)

    def test_file_close_failure_does_not_replace_short_read_primary(self):
        directory = ExportDirectory(self.export)
        self.addCleanup(directory.close)
        target = (self.export / 'frame-03.json').stat().st_ino
        real_read, real_close = os.read, os.close
        def reading(fd, count):
            return b'' if os.fstat(fd).st_ino == target else real_read(fd, count)
        def closing(fd):
            affected = os.fstat(fd).st_ino == target
            real_close(fd)
            if affected:
                raise OSError('synthetic close failure after descriptor retirement')
        with patch('os.read', side_effect=reading), patch('os.close', side_effect=closing):
            with self.assertRaisesRegex(ValueError, 'short read') as caught:
                directory.read('frame-03.json', MAX_TEXT)
        self.assertTrue(caught.exception.instance_capture_close_failed)

    def test_export_replacement_after_open_cannot_redirect_retained_descriptor(self):
        directory = ExportDirectory(self.export)
        self.addCleanup(directory.close)
        renamed = self.parent / 'old'; self.export.rename(renamed)
        self.export.mkdir(mode=0o700)
        (self.export / 'frame-01.json').write_bytes(b'foreign')
        with self.assertRaisesRegex(ValueError, 'replaced'): directory.read('frame-01.json', MAX_TEXT)

    def test_read_owner_check_is_not_inferred_from_filename(self):
        directory = ExportDirectory(self.export)
        self.addCleanup(directory.close)
        with patch('ci_instance_capture_attachments.os.geteuid', return_value=os.geteuid() + 1):
            with self.assertRaisesRegex(ValueError, 'private'): directory.read('frame-01.json', MAX_TEXT)


if __name__ == '__main__':
    unittest.main()
