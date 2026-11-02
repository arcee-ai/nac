"""Reset-case oracle/readout controls. Private files/DBs and stubs only, no NAC."""
import copy
from contextlib import ExitStack, closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import patch

from attention_reset_ack import ResetOracle, observe_release, prepare_store, run_contract
from attention_reset_readout import ResetReadout, canonical_matches


STORE = '10000000-0000-0000-0000-000000000001'
SOURCE = 'a' * 40
HOME = '/owned/profile'


def initial():
    return dict(app_pid=11, engine_pid=22, control_nonce='10000000-0000-0000-0000-000000000002',
                window_number=33, ready_receipt=dict(kind='ready', incarnation=STORE,
                    store=HOME + '/selected store.db', identity=dict(source_revision=SOURCE, track='dev')),
                native_os_delivery=False, stopped=False, same_engine=True, same_view=True, failure=None,
                window_visible=True, dock='', stage='ready',
                attention=dict(loaded=True, enabled=False, muted=False, saving=False, suspended=False,
                    unread=0, receipts=0, frontier='', cutoff='', generation=0, revision=0, retired=False,
                    work_pending=False, observer_connections=0, observer_draining=0, audit_overflow=False,
                    accepted_items=[], pending_decisions=0, observation_paused=False, message='Off'),
                center=dict(adds=0, pending_ack=0, present=0, permission_requests=0, deliveries=[],
                            retired=False, foreground_delivery_allowed=False, titles=[]))


def case():
    ready = initial()
    oracle = ResetOracle(ready, HOME, SOURCE)
    enabled = copy.deepcopy(ready)
    enabled['attention'].update(enabled=True, generation=1, revision=1,
                                observer_connections=1, cutoff=STORE + ':0', frontier=STORE + ':0')
    enabled['center']['permission_requests'] = 1
    oracle.enabled(enabled)
    oracle.bind_request('session-1', 'run-1')
    # Construct input independently of oracle.delivery, and check the public
    # profile/identifier byte domains rather than accepting a count-only log.
    profile = hashlib.sha256(b'nac-presentation-v1\0/owned/profile\0dev\0/owned/profile/selected store.db').hexdigest()
    identifier = hashlib.sha256(('nac-attention-v1\0' + profile + '\0session-1\0' + STORE + ':1').encode()).hexdigest()
    held = copy.deepcopy(enabled)
    held.update(window_visible=False)
    held['attention'].update(revision=2, unread=1, receipts=1, work_pending=True)
    held['center'].update(adds=1, pending_ack=1, present=1, titles=['Request completed'], deliveries=[
        dict(session='session-1', occurrence=STORE + ':1', identifier='nac-attention-' + identifier, title='Request completed')])
    reserved = dict(version=2, profile=profile, values=dict(preferences={}, drafts={}), native=dict(notifications=dict(
        enabled=True, muted=False, unreadCompletions=1, deliveryUncertain=False, seenDecisions=[],
        cutoff=STORE + ':0', frontier=STORE + ':0', receipts=[dict(occurrence=STORE + ':1',
            session='session-1', cursor=STORE + ':1', phase='reserved')])))
    reset = copy.deepcopy(held)
    reset['attention'].update(enabled=False, generation=2, revision=3, unread=0, receipts=0,
                             cutoff='', frontier='', work_pending=False, observer_connections=0, message='Saved')
    reset['center'].update(present=0, foreground_delivery_allowed=False)
    tombstone = dict(version=1, profile=profile, values=dict(preferences={}, drafts={}))
    released = copy.deepcopy(reset)
    released.update(stage='attention-0005')
    released['center']['pending_ack'] = 0
    return oracle, held, reserved, reset, tombstone, released


def at_reset():
    oracle, held, reserved, reset, tombstone, released = case()
    oracle.held(held)
    oracle.checkpoint(reserved, reserved=True)
    oracle.reset(reset)
    oracle.checkpoint(tombstone)
    return oracle, released


class ResetOracleTests(unittest.TestCase):
    def test_exact_original_callback_reset_order_and_full_window(self):
        oracle, released = at_reset()
        oracle.released(released, 'attention-0005', 100)
        for i in range(1, 42):
            oracle.sample(released, 100 + i * 0.05)
        oracle.observed(102.05)
        stopped = copy.deepcopy(released)
        stopped.update(stopped=True, passed=True)
        stopped['attention']['retired'] = True
        stopped['center']['retired'] = True
        oracle.stopped(stopped)
        self.assertEqual(oracle.phase, 'observed')

    def test_held_requires_one_exact_pending_callback_and_durable_reservation(self):
        for section, key, value in [('center', 'pending_ack', 0), ('center', 'pending_ack', 2),
                                   ('center', 'present', 0), ('center', 'adds', 2),
                                   ('attention', 'frontier', STORE + ':1'), ('attention', 'revision', 3),
                                   ('attention', 'accepted_items', [dict(sequence=1)])]:
            oracle, held, *_ = case()
            held[section][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                oracle.held(held)
        oracle, held, _, reset, *_ = case()
        oracle.held(held)
        with self.assertRaisesRegex(AssertionError, 'reservation'):
            oracle.reset(reset)

    def test_wrong_session_occurrence_identifier_and_title_rejected(self):
        for key in ('session', 'occurrence', 'identifier', 'title'):
            oracle, held, *_ = case()
            held['center']['deliveries'][0][key] = 'foreign'
            with self.subTest(key=key), self.assertRaises(AssertionError):
                oracle.held(held)

    def test_fake_saved_flush_only_early_callback_and_intent_off_are_not_reset(self):
        for section, key, value in [('attention', 'saving', True), ('attention', 'suspended', True),
                                   ('attention', 'message', 'Off'), ('attention', 'revision', 2),
                                   ('attention', 'generation', 1), ('attention', 'unread', 1),
                                   ('attention', 'receipts', 1), ('attention', 'observer_draining', 1),
                                   ('center', 'pending_ack', 0), ('center', 'present', 1),
                                   ('center', 'adds', 0), ('center', 'deliveries', [])]:
            oracle, held, reserved, reset, *_ = case()
            oracle.held(held); oracle.checkpoint(reserved, reserved=True)
            reset[section][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                oracle.reset(reset)

    def test_snapshot_alone_cannot_replace_reset_checkpoint_and_stale_stage_fails(self):
        oracle, held, reserved, reset, _, released = case()
        oracle.held(held); oracle.checkpoint(reserved, reserved=True); oracle.reset(reset)
        with self.assertRaisesRegex(AssertionError, 'durable reset'):
            oracle.released(released, 'attention-0005', 100)
        oracle, released = at_reset()
        with self.assertRaises(AssertionError):
            oracle.released(released, 'old-control', 100)

    def test_version2_or_scheduled_reservation_is_not_durable_clear(self):
        oracle, held, reserved, reset, _, _ = case()
        oracle.held(held)
        wrong = copy.deepcopy(reserved)
        wrong['native']['notifications']['receipts'][0]['phase'] = 'scheduled'
        with self.assertRaises(AssertionError): oracle.checkpoint(wrong, reserved=True)
        oracle.checkpoint(reserved, reserved=True); oracle.reset(reset)
        with self.assertRaises(AssertionError): oracle.checkpoint(reserved)

    def test_late_resurrection_extra_event_wrong_incarnation_and_boolean_counts_fail(self):
        for section, key, value in [('attention', 'generation', 3), ('attention', 'revision', 4),
                                   ('attention', 'unread', 1), ('attention', 'receipts', 1),
                                   ('attention', 'frontier', STORE + ':1'), ('attention', 'enabled', True),
                                   ('attention', 'pending_decisions', 1), ('attention', 'observer_connections', 1),
                                   ('center', 'pending_ack', 1), ('center', 'present', 1),
                                   ('center', 'adds', True), ('center', 'permission_requests', 2)]:
            oracle, released = at_reset(); oracle.released(released, 'attention-0005', 100)
            released[section][key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError): oracle.sample(released, 100.05)
        oracle, released = at_reset(); oracle.released(released, 'attention-0005', 100)
        released['ready_receipt']['incarnation'] = '20000000-0000-0000-0000-000000000002'
        with self.assertRaises(AssertionError): oracle.sample(released, 100.05)

    def test_short_window_gap_backwards_clock_and_late_truthy_sample_rejected(self):
        oracle, released = at_reset(); oracle.released(released, 'attention-0005', 100)
        oracle.sample(released, 100.05)
        with self.assertRaisesRegex(AssertionError, 'two-second'): oracle.observed(100.05)
        for now in (99, 101):
            with self.assertRaises(AssertionError): oracle.sample(released, now)
        with patch('attention_reset_ack.remaining', return_value=1), self.assertRaisesRegex(AssertionError, 'Late truthy'):
            observe_release(oracle, lambda: released, lambda *_: None, 101, clock=lambda: 102)

    def test_actual_sampling_loop_keeps_every_sample_and_refuses_one_green_shortcut(self):
        oracle, released = at_reset(); oracle.released(released, 'attention-0005', 100)
        clock = [100.0]; saved = []
        def pause(seconds): clock[0] += seconds
        with patch('attention_reset_ack.remaining', return_value=1):
            observe_release(oracle, lambda: copy.deepcopy(released), lambda s, t: saved.append(t),
                            105, clock=lambda: clock[0], pause=pause)
        self.assertGreaterEqual(saved[-1] - 100, 2)
        self.assertGreaterEqual(len(saved), 40)
        self.assertEqual(oracle.phase, 'observed')

    def test_late_receipt_cannot_complete_window(self):
        oracle, released = at_reset(); oracle.released(released, 'attention-0005', 100)
        clock = [100.05]
        def slow_receipt(*_): clock[0] = 106
        with patch('attention_reset_ack.remaining', return_value=1), self.assertRaisesRegex(AssertionError, 'receipt'):
            observe_release(oracle, lambda: released, slow_receipt, 105, clock=lambda: clock[0])

    def test_source_guard_runs_before_console_provider_or_app(self):
        with patch('attention_reset_ack.source_binding', side_effect=AssertionError('source mismatch')), \
                patch('attention_reset_ack.console_facts') as console, \
                patch('attention_reset_ack.SemanticProvider') as provider, \
                patch('attention_reset_ack.AttentionJourney') as journey:
            with self.assertRaisesRegex(AssertionError, 'source mismatch'):
                run_contract('/unused', '/unused', '/unused', SOURCE, time.monotonic() + 1000)
        console.assert_not_called(); provider.assert_not_called(); journey.assert_not_called()


class ResetReadoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='nac-attention-app-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.owner = ResetReadout(self.root)
        self.addCleanup(self.owner.close)

    def file(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(0o600)
        return path

    def test_private_regular_stable_bounded_read(self):
        self.file('profile/file', b'original')
        data, receipt = self.owner.read('profile/file', 8)
        self.assertEqual(data, b'original')
        self.assertEqual(receipt['sha256'], hashlib.sha256(b'original').hexdigest())
        with self.assertRaisesRegex(AssertionError, 'bound'): self.owner.read('profile/file', 7)
        with self.assertRaises(AssertionError): self.owner.read('../foreign')
        with patch('attention_reset_readout.time.monotonic', side_effect=[10, 10, 12]):
            with self.assertRaisesRegex(AssertionError, 'deadline'):
                self.owner.read('profile/file', deadline=11)

    def test_symlink_file_ancestor_hardlink_nonprivate_and_replaced_root_rejected(self):
        path = self.file('profile/original', b'private')
        (path.parent / 'link').symlink_to(path)
        with self.assertRaises(OSError): self.owner.read('profile/link')
        (self.root / 'alias').symlink_to(path.parent)
        with self.assertRaises(OSError): self.owner.read('alias/original')
        os.link(path, path.parent / 'hardlink')
        with self.assertRaises(AssertionError): self.owner.read('profile/hardlink')
        (path.parent / 'hardlink').unlink(); path.chmod(0o644)
        with self.assertRaises(AssertionError): self.owner.read('profile/original')
        moved = self.root.with_name(self.root.name + '-old')
        self.root.rename(moved); self.root.mkdir(mode=0o700)
        try:
            with self.assertRaisesRegex(AssertionError, 'replaced'): self.owner.read('profile/original')
        finally:
            self.root.rmdir(); moved.rename(self.root)

    def test_mid_read_mutation_and_named_file_replacement_rejected(self):
        path = self.file('profile/file', b'original')
        original = os.read
        def changed(fd, amount):
            data = original(fd, amount)
            if data: path.write_bytes(b'changed!')
            return data
        with patch('attention_reset_readout.os.read', side_effect=changed):
            with self.assertRaisesRegex(AssertionError, 'Unstable'): self.owner.read('profile/file')
        def replaced(fd, amount):
            data = original(fd, amount)
            if data:
                path.unlink(); path.write_bytes(b'original'); path.chmod(0o600)
            return data
        with patch('attention_reset_readout.os.read', side_effect=replaced):
            with self.assertRaisesRegex(AssertionError, 'Unstable'): self.owner.read('profile/file')

    def test_foreign_uid_special_file_and_replaced_ancestor_fail_closed(self):
        self.file('profile/file', b'original')
        with patch('attention_reset_readout.os.getuid', return_value=os.getuid() + 1):
            with self.assertRaises(AssertionError): self.owner.read('profile/file')
        os.mkfifo(self.root / 'fifo', 0o600)
        with self.assertRaisesRegex(AssertionError, 'regular'): self.owner.read('fifo')
        original = os.read
        moved = self.root / 'old-profile'
        def replace(fd, amount):
            data = original(fd, amount)
            if data:
                (self.root / 'profile').rename(moved)
                (self.root / 'profile').mkdir(mode=0o700)
            return data
        try:
            with patch('attention_reset_readout.os.read', side_effect=replace):
                with self.assertRaisesRegex(AssertionError, 'ancestor replaced'): self.owner.read('profile/file')
        finally:
            (self.root / 'profile').rmdir(); moved.rename(self.root / 'profile')

    def test_checkpoint_profile_duplicate_json_and_native_clear_schema(self):
        digest = 'b' * 64
        relative = 'profile/Library/Application Support/NAC/Presentation/dev/' + digest + '/checkpoint.json'
        value = dict(version=1, profile=digest, values=dict(preferences={'key': 'value'}, drafts={}))
        self.file(relative, json.dumps(value).encode())
        read, _, _ = self.owner.checkpoint(self.root / 'profile', 'dev', digest)
        self.assertEqual(read, value)
        self.file(relative, json.dumps(dict(value, profile='foreign')).encode())
        with self.assertRaises(AssertionError): self.owner.checkpoint(self.root / 'profile', 'dev', digest)
        self.file(relative, b'{"version":1,"version":2}')
        with self.assertRaisesRegex(AssertionError, 'Duplicate'): self.owner.checkpoint(self.root / 'profile', 'dev', digest)
        with self.assertRaises(AssertionError): self.owner.checkpoint('/foreign', 'dev', digest)

    def database(self):
        (self.root / 'profile').mkdir(mode=0o700)
        path = prepare_store(self.owner)
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript('''CREATE TABLE sessions(session_id TEXT); CREATE TABLE session_goals(goal_id TEXT);
                CREATE TABLE session_run_outcomes(session_id TEXT,run_id TEXT,disposition TEXT);
                CREATE TABLE session_completion_feed(singleton INTEGER,store_id TEXT);
                CREATE TABLE session_completion_occurrences(sequence INTEGER,session_id TEXT,run_id TEXT,
                    behavior TEXT,kind TEXT,goal_id TEXT,mark_version INTEGER);
                INSERT INTO sessions VALUES('session-1');
                INSERT INTO session_run_outcomes VALUES('session-1','run-1','completed');
                INSERT INTO session_completion_occurrences VALUES(1,'session-1','run-1','direct','request',NULL,NULL);''')
            db.execute('INSERT INTO session_completion_feed VALUES(1,?)', [STORE])
        return path

    def test_case_specific_backup_reads_only_artifact_copy_and_exact_single_outcome(self):
        path = self.database()
        expected = case()[0]; expected.bind_request('session-1', 'run-1')
        before = path.read_bytes(); original_connect = sqlite3.connect; calls = []
        def connect(target, *args, **kwargs):
            calls.append(str(target))
            self.assertNotIn(str(self.root / 'profile'), str(target))
            return original_connect(target, *args, **kwargs)
        with tempfile.TemporaryDirectory() as destination, patch('attention_reset_readout.sqlite3.connect', side_effect=connect):
            result = self.owner.canonical(Path(destination).resolve() / 'copy', expected.expected,
                                          owners_exited=True, deadline=time.monotonic() + 5)
        self.assertEqual(len(result['rows']), 1); self.assertEqual(len(calls), 3)
        self.assertEqual(path.read_bytes(), before)
        self.assertFalse(path.with_name(path.name + '-wal').exists())
        self.assertFalse(path.with_name(path.name + '-shm').exists())

    def test_canonical_copy_preserves_original_wal_and_uses_it_for_backup(self):
        path = self.database()
        db = sqlite3.connect(path)
        self.addCleanup(db.close)
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('UPDATE session_run_outcomes SET run_id=?', ['wal-run'])
        db.execute('UPDATE session_completion_occurrences SET run_id=?', ['wal-run'])
        db.commit()
        expected = dict(store=STORE, session='session-1', run='wal-run', behavior='direct', kind='request', goal=None, mark_version=None)
        before = {p: p.read_bytes() for p in path.parent.iterdir()}
        with tempfile.TemporaryDirectory() as output:
            result = self.owner.canonical(Path(output).resolve() / 'copy', expected,
                                          owners_exited=True, deadline=time.monotonic() + 5)
        self.assertIsNotNone(result['copied']['-wal'])
        self.assertEqual(result['rows'][0]['run_id'], 'wal-run')
        self.assertEqual({p: p.read_bytes() for p in before}, before)

    def test_canonical_unknown_cleanup_ownership_and_wrong_event_fail_closed(self):
        with tempfile.TemporaryDirectory() as output:
            with self.assertRaisesRegex(AssertionError, 'exit not proved'):
                self.owner.canonical(Path(output) / 'copy', {}, owners_exited=False, deadline=time.monotonic() + 5)
            self.assertFalse((Path(output) / 'copy').exists())
        with self.assertRaisesRegex(AssertionError, 'UNKNOWN'):
            self.owner.remove(dict(native=True, provider=False, website=True))
        self.assertTrue(self.root.exists())
        expected = dict(store=STORE, session='s', run='r', behavior='direct', kind='request', goal=None, mark_version=None)
        row = dict(sequence=1, session_id='s', run_id='r', behavior='direct', kind='request', goal_id=None, mark_version=None)
        outcome = dict(session_id='s', run_id='r', disposition='completed')
        counts = dict(sessions=1, session_goals=0, session_run_outcomes=1)
        canonical_matches([row], [outcome], [STORE], counts, expected)
        for key, value in [('run_id', 'other'), ('sequence', 2), ('goal_id', 'goal'), ('behavior', 'orchestrator')]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                canonical_matches([dict(row, **{key: value})], [outcome], [STORE], counts, expected)
        with self.assertRaises(AssertionError): canonical_matches([row, row], [outcome], [STORE], counts, expected)

    def test_prepare_store_is_empty_private_and_closes_descriptors(self):
        (self.root / 'profile').mkdir(mode=0o700)
        opened = []; original = os.open
        def capture(*args, **kwargs):
            fd = original(*args, **kwargs); opened.append(fd); return fd
        with patch('attention_reset_ack.os.open', side_effect=capture):
            store = prepare_store(self.owner)
        self.assertEqual(store.read_bytes(), b'')
        self.assertEqual(stat.S_IMODE(store.stat().st_mode), 0o600)
        self.assertEqual(len(opened), 2)
        for fd in opened:
            with self.assertRaises(OSError): os.fstat(fd)
        self.owner.validate()

    def test_prepare_store_refuses_existing_and_symlink_without_modification(self):
        (self.root / 'profile').mkdir(mode=0o700)
        path = self.file('profile/selected store.db', b'existing')
        path.chmod(0o640)
        before = path.stat()
        opened = []; original = os.open
        def capture(*args, **kwargs):
            fd = original(*args, **kwargs); opened.append(fd); return fd
        with patch('attention_reset_ack.os.open', side_effect=capture):
            with self.assertRaises(FileExistsError): prepare_store(self.owner)
        for fd in opened:
            with self.assertRaises(OSError): os.fstat(fd)
        self.assertEqual(path.read_bytes(), b'existing')
        self.assertEqual((path.stat().st_ino, path.stat().st_mode), (before.st_ino, before.st_mode))
        path.unlink()
        target = self.file('foreign', b'untouched'); target.chmod(0o640)
        path.symlink_to(target)
        with self.assertRaises(FileExistsError): prepare_store(self.owner)
        self.assertTrue(path.is_symlink()); self.assertEqual(target.read_bytes(), b'untouched')
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)

    def test_prepare_store_refuses_symlink_nonprivate_and_replaced_profile(self):
        profile = self.root / 'profile'; foreign = self.root / 'foreign'
        foreign.mkdir(mode=0o700); profile.symlink_to(foreign)
        with self.assertRaises(OSError): prepare_store(self.owner)
        self.assertEqual(list(foreign.iterdir()), [])
        profile.unlink(); profile.mkdir(mode=0o755)
        with self.assertRaisesRegex(AssertionError, 'not private'): prepare_store(self.owner)
        self.assertEqual(list(profile.iterdir()), [])
        profile.chmod(0o700)
        original = self.owner.validate; calls = [0]; retained = self.root / 'retained-profile'
        def replace():
            original(); calls[0] += 1
            if calls[0] == 2:
                profile.rename(retained); profile.mkdir(mode=0o700)
        try:
            with patch.object(self.owner, 'validate', side_effect=replace):
                with self.assertRaisesRegex(AssertionError, 'profile replaced'): prepare_store(self.owner)
            self.assertEqual(list(profile.iterdir()), []); self.assertEqual(list(retained.iterdir()), [])
        finally:
            profile.rmdir(); retained.rename(profile)

    def test_prepare_store_postcreate_failure_closes_all_descriptors(self):
        (self.root / 'profile').mkdir(mode=0o700)
        opened = []; original_open = os.open; original_validate = self.owner.validate; calls = [0]
        def capture(*args, **kwargs):
            fd = original_open(*args, **kwargs); opened.append(fd); return fd
        def fail():
            original_validate(); calls[0] += 1
            if calls[0] == 3: raise OSError('injected post-create failure')
        with patch('attention_reset_ack.os.open', side_effect=capture), patch.object(self.owner, 'validate', side_effect=fail):
            with self.assertRaisesRegex(OSError, 'post-create'): prepare_store(self.owner)
        self.assertEqual(len(opened), 2)
        for fd in opened:
            with self.assertRaises(OSError): os.fstat(fd)
        self.assertEqual((self.root / 'profile/selected store.db').read_bytes(), b'')
        self.owner.validate()


class MaintainedDriverTests(unittest.TestCase):
    def drive(self, failure=None):
        """Actual maintained sequence/readouts, private files and inert ports."""
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name).resolve()
        bundle = base / 'Fixture.app'
        resources = bundle / 'Contents/Resources'
        resources.mkdir(parents=True)
        build_identity = dict(source_revision=SOURCE, track='dev', build_id='dev-' + SOURCE)
        (resources / 'build-receipt.json').write_text(json.dumps(dict(source_head=SOURCE, source_dirty=False,
            engine_identity=build_identity, normal_startup=True, attention_smoke_instrumentation=True,
            native_sha256='hash', engine_sha256='hash', native_source_files={'dummy-source': 'hash'},
            compiler_flags=['LOCAL_APP', 'PREVIEW_SMOKE', 'ATTENTION_SMOKE'])))
        actions = []; actors = []; providers = []; helpers = []; preparers = []; sqlite_modes = []
        test = self
        class Provider:
            def __init__(self, profile, evidence):
                self.evidence = evidence; self.endpoint = 'http://127.0.0.1:12345'
                self.requests = []; self.errors = []; self.closed = False
                self.protocol = SimpleNamespace(register=lambda token: test.assertEqual(token, 'SEMANTIC_RESET_ACK_DIRECT'))
                self.lock = threading.Lock(); self.handlers = []
                self.thread = SimpleNamespace(is_alive=lambda: False)
                providers.append(self)
            def close(self): self.closed = True
        class Journey:
            def __init__(self, moved, output, profile, environment, store, observer):
                info = store.lstat()
                test.assertTrue(stat.S_ISREG(info.st_mode)); test.assertEqual(info.st_size, 0)
                test.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
                self.profile = profile; self.output = output
                self.log = output.with_suffix('.log').open('w'); self.exited = False; self.engine_pid = 22
                self.current = initial(); self.current['ready_receipt'].update(store=str(store), endpoint='http://127.0.0.1:12346', identity=build_identity)
                self.current['base_url'] = 'http://127.0.0.1:12346/'
                self.digest = hashlib.sha256(('nac-presentation-v1\0' + str(profile) + '\0dev\0' + str(store)).encode()).hexdigest()
                self.custody = SimpleNamespace(check=lambda *a, **k: None, publish=self.publish,
                                              cleanup=lambda *a: self.publish(None, 'attention-cleanup', 'cleanup'), close=lambda: None)
                actors.append(self)
            def launch(self): pass
            def stage(self, name, **kwargs): return copy.deepcopy(self.current)
            def read(self, **kwargs): return copy.deepcopy(self.current)
            def observe(self, **kwargs): return dict(apps=[] if self.exited else [dict(pid=11)])
            def checkpoint(self, reserved):
                value = dict(version=1, profile=self.digest, values=dict(preferences={}, drafts={}))
                if reserved:
                    value.update(version=2, native=dict(notifications=dict(enabled=True, muted=False,
                        unreadCompletions=1, deliveryUncertain=False, seenDecisions=[], frontier=STORE + ':0', cutoff=STORE + ':0',
                        receipts=[dict(occurrence=STORE + ':1', session='session-1', cursor=STORE + ':1', phase='reserved')])))
                path = self.profile / ('Library/Application Support/NAC/Presentation/dev/' + self.digest + '/checkpoint.json')
                path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(value)); path.chmod(0o600)
            def publish(self, _, name, action, **kwargs):
                actions.append(action); self.current['stage'] = name
                a, c = self.current['attention'], self.current['center']
                if action == 'enable':
                    a.update(enabled=True, generation=1, revision=1, observer_connections=1, cutoff=STORE + ':0', frontier=STORE + ':0')
                    c['permission_requests'] = 1
                elif action == 'close': self.current['window_visible'] = False
                elif action == 'reset':
                    a.update(enabled=False, generation=2, revision=2 if failure == 'reset' else 3, unread=0,
                             receipts=0, frontier='', cutoff='', work_pending=False, observer_connections=0, message='Saved')
                    c['present'] = 0; self.checkpoint(False)
                    if failure == 'incarnation':
                        self.current['ready_receipt']['incarnation'] = '20000000-0000-0000-0000-000000000002'
                elif action == 'release': c['pending_ack'] = 0
                elif action in ('finish', 'cleanup'):
                    self.exited = True; self.current.update(stopped=True, passed=action == 'finish')
                    a.update(retired=True, observer_connections=0, observer_draining=0); c['retired'] = True
        def http(endpoint, path, body):
            actor = actors[0]
            if path == '/projects': return dict(project_id='p')
            if path == '/sessions': return dict(metadata=dict(session_id='session-1', behavior='direct'))
            test.assertEqual(path, '/sessions/session-1/runs')
            actor.current['attention'].update(revision=2, unread=1, receipts=1, work_pending=True)
            raw = 'nac-attention-v1\0' + actor.digest + '\0session-1\0' + STORE + ':1'
            actor.current['center'].update(adds=1, pending_ack=1, present=1, titles=['Request completed'], deliveries=[
                dict(session='session-1', occurrence=STORE + ':1', identifier='nac-attention-' + hashlib.sha256(raw.encode()).hexdigest(), title='Request completed')])
            actor.checkpoint(True)
            # Build a standalone private DB, never NAC or an original user store.
            with closing(sqlite3.connect(actor.profile / 'selected store.db')) as db, db:
                db.execute('PRAGMA journal_mode=WAL')
                db.executescript('''CREATE TABLE sessions(session_id TEXT); INSERT INTO sessions VALUES('session-1');
                    CREATE TABLE session_goals(goal_id TEXT);
                    CREATE TABLE session_run_outcomes(session_id TEXT,run_id TEXT,disposition TEXT);
                    INSERT INTO session_run_outcomes VALUES('session-1','run-1','completed');
                    CREATE TABLE session_completion_feed(singleton INTEGER,store_id TEXT);
                    CREATE TABLE session_completion_occurrences(sequence INTEGER,session_id TEXT,run_id TEXT,behavior TEXT,kind TEXT,goal_id TEXT,mark_version INTEGER);
                    INSERT INTO session_completion_occurrences VALUES(1,'session-1','run-1','direct','request',NULL,NULL);''')
                db.execute('INSERT INTO session_completion_feed VALUES(1,?)', [STORE])
                db.commit()
                modes = [stat.S_IMODE((actor.profile / ('selected store.db' + suffix)).stat().st_mode)
                         for suffix in ('', '-wal', '-shm')]
                test.assertEqual(modes, [0o600] * 3); sqlite_modes.append(modes)
            providers[0].requests.append(dict(token='SEMANTIC_RESET_ACK_DIRECT'))
            providers[0].evidence.write_text('\n'.join(json.dumps(dict(operation=op, token='SEMANTIC_RESET_ACK_DIRECT'))
                for op in ('model-request', 'model-response')) + '\n')
            return dict(run_id='run-1')
        class Helper:
            def __init__(self, args, **kwargs):
                self.args = args; self.pid = 99; self.returncode = None; self.polls = 0; helpers.append(self)
                root = Path(args[1]); actor = actors[0]
                if failure == 'helper-replace':
                    root.rename(root.with_name(root.name + '-retained'))
                    root.mkdir(mode=0o700)
                    (root / 'successor-sentinel').write_text('preserve')
                held, parent = os.fstat(int(args[2])), os.fstat(int(args[3]))
                receipt = dict(root=str(root), profile=actor.digest, initialization_ephemeral=True,
                    website_store_removed=str(uuid.UUID(bytes=bytes.fromhex(actor.digest)[:16], version=5)),
                    root_device=held.st_dev, root_inode=held.st_ino,
                    parent_device=parent.st_dev, parent_inode=parent.st_ino)
                fd = os.open(root / 'cleanup-result.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w') as stream: json.dump(receipt, stream)
            def wait(self, **kwargs):
                if failure == 'helper-timeout' and 'timeout' in kwargs: raise subprocess.TimeoutExpired(self.args, 15)
                self.returncode = 0; return 0
            def poll(self):
                self.polls += 1
                if failure == 'helper-timeout' and self.polls >= 3: self.returncode = 0
                return self.returncode
        def wait(label, predicate, **kwargs):
            value = predicate()
            assert value, label + ' incomplete'
            return value
        def observe(oracle, sample, record, deadline):
            clock = [oracle.release_time]
            def pause(seconds): clock[0] += seconds
            observe_release(oracle, sample, record, deadline, clock=lambda: clock[0], pause=pause)
        original_write = Path.write_text
        def write(path, *args, **kwargs):
            if failure == 'receipt' and path.name.endswith('-release.json'): raise OSError('injected receipt failure')
            return original_write(path, *args, **kwargs)
        output = base / 'output'
        def prepare(owned):
            preparers.append(owned)
            if failure == 'store-collision':
                (owned.root / 'profile/selected store.db').write_bytes(b'collision retained')
            return prepare_store(owned)
        with ExitStack() as stack:
            for name, replacement in dict(source_binding=lambda *a: dict(source_revision=SOURCE), console_facts=lambda **k: {},
                require_console=lambda _: None, digest=lambda p: 'hash', AttentionJourney=Journey, SemanticProvider=Provider,
                request=http, wait_for=wait, engine_settled=lambda *a: True, observe_release=observe, prepare_store=prepare).items():
                stack.enter_context(patch('attention_reset_ack.' + name, replacement))
            stack.enter_context(patch('attention_reset_ack.subprocess.run', return_value=SimpleNamespace(returncode=0)))
            stack.enter_context(patch('attention_reset_ack.subprocess.Popen', Helper))
            stack.enter_context(patch.object(Path, 'write_text', write))
            if failure:
                with self.assertRaises(AssertionError): run_contract(bundle, output, base / 'InstanceObservation', SOURCE, time.monotonic() + 1000)
            else:
                run_contract(bundle, output, base / 'InstanceObservation', SOURCE, time.monotonic() + 1000)
        summary = json.loads((output / 'summary.json').read_text())
        self.assertIsNone(preparers[0].fd); self.assertIsNone(preparers[0].parent_fd)
        if failure == 'store-collision':
            self.assertEqual(actors + providers + helpers, [])
            self.assertEqual((Path(summary['fixture_root']) / 'profile/selected store.db').read_bytes(), b'collision retained')
            return actions, summary
        self.assertTrue(providers[0].closed); self.assertTrue(actors[0].log.closed)
        self.assertEqual(sqlite_modes, [[0o600] * 3])
        self.assertTrue(summary['native_settled']); self.assertEqual(helpers[0].returncode, 0)
        if failure == 'incarnation': self.assertTrue((output / 'invalid-native.json').exists())
        return actions, summary

    def test_maintained_sequence_with_private_readouts_and_inert_native_ports(self):
        actions, result = self.drive()
        self.assertEqual(actions, ['enable', 'hold', 'close', 'reset', 'release', 'finish'])
        self.assertTrue(result['passed']); self.assertTrue(result['private_root_removed'])

    def test_failed_reset_never_releases_callback_and_uses_exact_cleanup(self):
        actions, result = self.drive('reset')
        self.assertEqual(actions, ['enable', 'hold', 'close', 'reset', 'cleanup'])
        self.assertFalse(result['passed']); self.assertTrue(Path(result['fixture_root']).exists())

    def test_receipt_failure_after_release_does_not_repeat_control_or_skip_cleanup(self):
        actions, result = self.drive('receipt')
        self.assertEqual(actions, ['enable', 'hold', 'close', 'reset', 'release', 'cleanup'])
        self.assertFalse(result['passed']); self.assertIn('receipt failure', result['error'])

    def test_helper_root_replacement_retains_original_and_successor(self):
        actions, result = self.drive('helper-replace')
        self.assertFalse(result['passed'])
        root = Path(result['fixture_root'])
        self.assertEqual((root / 'successor-sentinel').read_text(), 'preserve')
        self.assertTrue(root.with_name(root.name + '-retained').exists())

    def test_cleanup_helper_timeout_retains_original_until_late_exit_and_is_not_pass(self):
        actions, result = self.drive('helper-timeout')
        self.assertEqual(actions[-2:], ['release', 'finish'])
        self.assertFalse(result['passed']); self.assertEqual(result['cleanup_helper']['exit_code'], 0)
        self.assertTrue(any('TimeoutExpired' in error for error in result['cleanup_errors']))

    def test_changed_incarnation_retains_invalid_readout_and_refuses_release(self):
        actions, result = self.drive('incarnation')
        self.assertEqual(actions, ['enable', 'hold', 'close', 'reset', 'cleanup'])
        self.assertFalse(result['passed']); self.assertIn('ready_receipt', result['error'])

    def test_store_collision_refuses_before_provider_or_app_and_closes_root(self):
        actions, result = self.drive('store-collision')
        self.assertEqual(actions, []); self.assertFalse(result['passed'])
        self.assertIn('FileExistsError', result['error'])

    def test_ordinary_sqlite_022_in_isolated_child_without_test_chmod(self):
        script = '''import os,unittest
from test_attention_semantic_reset_ack import MaintainedDriverTests
previous=os.umask(0o022)
try:
    result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([
        MaintainedDriverTests('test_maintained_sequence_with_private_readouts_and_inert_native_ports')]))
finally:
    os.umask(previous)
raise SystemExit(not result.wasSuccessful())
'''
        result = subprocess.run([sys.executable, '-B', '-W', 'error::ResourceWarning', '-c', script],
                                cwd=Path(__file__).resolve().parent, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
