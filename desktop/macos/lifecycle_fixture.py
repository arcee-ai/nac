"""Bounded external controls for actual-app death and persistence-drain cases."""
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import threading
import time

CASES = ('parent-loss-startup', 'parent-loss-active', 'channel-loss-startup',
         'channel-loss-active', 'parent-loss-initialization', 'channel-loss-initialization',
         'slow-drain', 'watchdog', 'stale-launch')


def alive(pid):
    state = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith('Z')


def wait_dead(pid, timeout=24):
    end = time.monotonic() + timeout
    while alive(pid) and time.monotonic() < end:
        time.sleep(.05)
    assert not alive(pid), f'Owned fixture {pid} survived shutdown'


class LifecycleControl:
    def __init__(self, scenario, evidence, bundle):
        self.scenario, self.evidence, self.bundle = scenario, evidence, bundle
        self.error = None
        self.result = None
        self.thread = threading.Thread(target=self.run, daemon=True)

    def start(self):
        if self.scenario.startswith('parent-loss') or self.scenario.endswith('initialization') or self.scenario in ('slow-drain', 'watchdog'):
            self.thread.start()

    def finish(self):
        if self.thread.ident is not None:
            self.thread.join(timeout=80)
            assert not self.thread.is_alive(), 'Lifecycle control exceeded deadline'
        if self.error:
            raise self.error
        return self.result

    def run(self):
        startup_connection = None
        try:
            end = time.monotonic() + 65
            while time.monotonic() < end:
                try:
                    record = json.loads(self.evidence.read_text())
                    if self.scenario.endswith('initialization') and startup_connection is None and record.get('startup_store_barrier_ready'):
                        profile = Path(record['profile']).resolve()
                        startup_connection = sqlite3.connect(profile / 'store.db')
                        startup_connection.execute('BEGIN EXCLUSIVE')
                        (profile / 'startup-go').touch()
                    if record.get('lifecycle_ready'):
                        break
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                time.sleep(.025)
            else:
                raise TimeoutError('Native lifecycle barrier not reached')
            profile = Path(record['profile']).resolve()
            pid = record['engine_pid']
            if self.scenario.startswith('parent-loss'):
                # Validate exact ownership before any signal, as in cleanup.
                for key, executable in [('app_pid', self.bundle / 'Contents/MacOS/NACPreview'),
                                        ('engine_pid', self.bundle / 'Contents/Resources/nac-web')]:
                    command = subprocess.check_output(['/bin/ps', '-p', str(record[key]), '-o', 'command='], text=True)
                    assert str(executable) in command, (key, command)
                helper = record['app_helper_pid']
                helper_command = subprocess.check_output(['/bin/ps', '-p', str(helper), '-o', 'command='], text=True).strip()
                assert helper_command == '/bin/sleep ' + record['app_helper_argument'], helper_command
                try:
                    for child in (helper, record.get('descendant_pid')):
                        if child:
                            unix = subprocess.run(['/usr/sbin/lsof', '-a', '-p', str(child), '-U', '-Fn'], capture_output=True, text=True)
                            assert not unix.stdout.strip(), f'Private channel leaked into descendant {child}: {unix.stdout}'
                    started = time.monotonic()
                    os.kill(record['app_pid'], signal.SIGKILL)
                    if startup_connection is not None:
                        time.sleep(2)
                        assert alive(pid), 'Engine was killed instead of settling startup'
                        startup_connection.rollback()
                        startup_connection.close()
                        startup_connection = None
                    wait_dead(pid)
                    assert alive(helper), 'Reverse inheritance fixture did not outlive owning app'
                    if record.get('descendant_pid'):
                        wait_dead(record['descendant_pid'], timeout=3)
                    if (profile / 'store.db').exists():
                        with sqlite3.connect(profile / 'store.db') as connection:
                            assert connection.execute('PRAGMA quick_check').fetchone() == ('ok',)
                    record.update(passed=True, parent_killed=True, engine_reaped=True,
                                  reverse_fd_inheritance_closed=True, descendant_fd_inheritance_closed=True,
                                  shutdown_seconds=round(time.monotonic()-started, 3))
                    # Parent death cannot run AppKit's profile deletion callback.
                    import shutil
                    shutil.rmtree(profile)
                    record['profile_removed'] = not profile.exists()
                    self.evidence.write_text(json.dumps(record, indent=2) + '\n')
                    self.result = record
                finally:
                    if alive(helper):
                        actual = subprocess.check_output(['/bin/ps', '-p', str(helper), '-o', 'command='], text=True).strip()
                        assert actual == helper_command, 'Refusing cleanup of a replaced app helper'
                        os.kill(helper, signal.SIGTERM)
                        wait_dead(helper, timeout=3)
            elif self.scenario == 'channel-loss-initialization':
                time.sleep(2)
                assert alive(pid), 'Channel loss killed the engine during store initialization'
                startup_connection.rollback()
                startup_connection.close()
                startup_connection = None
                wait_dead(pid)
                self.result = dict(startup_store_barrier_seconds=2)
            else:
                connection = sqlite3.connect(profile / 'store.db', timeout=2)
                try:
                    connection.execute('BEGIN IMMEDIATE')
                    (profile / 'shutdown-go').touch()
                    started = time.monotonic()
                    hold = 5.5 if self.scenario == 'slow-drain' else 24
                    if self.scenario == 'watchdog':
                        wait_dead(pid, timeout=23)
                        elapsed = time.monotonic() - started
                        assert 19.5 <= elapsed <= 23, elapsed
                    else:
                        time.sleep(hold)
                    if self.scenario == 'slow-drain':
                        assert alive(pid), 'Persistence drain ended before the blocked write settled'
                    try:
                        connection.rollback()
                    except sqlite3.Error:
                        if self.scenario != 'watchdog':
                            raise
                    self.result = dict(store_barrier_seconds=round(time.monotonic()-started, 3))
                finally:
                    connection.close()
        except BaseException as error:
            self.error = error
        finally:
            if startup_connection is not None:
                startup_connection.close()
