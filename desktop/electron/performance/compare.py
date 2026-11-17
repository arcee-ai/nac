#!/usr/bin/env python3
"""Bounded normal-package Mac comparison; no browser debug port or OS input.

All controls name the uniquely launched bundle plus its captured PID/launch time.
Counters are read-only, and no discovered child is signalled. Failure preserves
profiles until exact app/engine settlement is observed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import re
import sqlite3
import statistics
import subprocess
import time


HERE = Path(__file__).resolve().parent


def run(args, **kwargs):
    return subprocess.check_output([str(arg) for arg in args], timeout=15, **kwargs)


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def wait(predicate, label, seconds=35):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.05)
    raise TimeoutError(label)


def distribution(values):
    ordered = sorted(values)
    def percentile(p):
        return ordered[max(0, min(len(ordered) - 1, __import__('math').ceil(p * len(ordered)) - 1))]
    return dict(n=len(values), min=ordered[0], median=statistics.median(ordered),
                p95=percentile(.95), max=ordered[-1]) if values else None


def process_table():
    table = {}
    for line in run(['/bin/ps', '-axo', 'pid=,ppid=,comm='], text=True).splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            table[int(parts[0])] = dict(ppid=int(parts[1]), executable=parts[2])
    return table


def pid_census():
    values = run(['/bin/ps', '-axo', 'pid='], text=True).splitlines()
    # A malformed/incomplete observation is never proof of process retirement.
    result = {int(value.strip()) for value in values}
    if not result:
        raise RuntimeError('Independent PID census unavailable')
    return result


def identities_settled(known, samples, census):
    records = {value['pid']: value for value in samples}
    for pid, birth in known.items():
        value = records.get(pid)
        if value and value['valid']:
            if (value['birth_sec'], value['birth_usec']) == birth:
                return False
        elif pid in census:
            # Counter failure may mean denied/unknown inspection of a live PID.
            return False
    return True


def display_metadata():
    # Select reproducibility fields only; never retain display serial numbers.
    hardware = json.loads(run(['system_profiler', 'SPDisplaysDataType', '-json']))
    return [dict(gpu=gpu.get('_name'), name=display.get('_name'),
                 pixels=display.get('_spdisplays_pixels'),
                 resolution=display.get('_spdisplays_resolution'),
                 automatic_brightness=display.get('spdisplays_ambient_brightness'),
                 main=display.get('spdisplays_main'))
            for gpu in hardware['SPDisplaysDataType']
            for display in gpu.get('spdisplays_ndrvs', [])]


def coalition(root_pid, bundle):
    # LaunchServices reports detached XPC/WebKit helpers in the app coalition.
    # Raw lsappinfo contains unrelated app metadata and is deliberately not saved.
    listing = run(['/usr/bin/lsappinfo', 'list'], text=True)
    matches = [block for block in re.split(r'(?m)^\s*\d+\)', listing)
               if re.search(r'\bpid = ' + str(root_pid) + r'\b', block)
               and 'bundle path="' + str(bundle) + '"' in block]
    if len(matches) != 1:
        raise RuntimeError('Exact app coalition unavailable; totals cannot be established')
    record = re.search(r'coalition:\s*(\d+)(?:\s*\{([^}]+)\})?', matches[0])
    if not record:
        raise RuntimeError('App coalition membership unavailable')
    members = set(map(int, (record[2] or '').split())) | {root_pid}
    return int(record[1]), members


def admitted_geometry(state):
    windows = state.get('native_windows', [])
    if len(windows) != 1:
        raise RuntimeError('Missing or ambiguous exact native window geometry')
    window = windows[0]
    displays = window.get('displays', [])
    if not window.get('display_metadata_available') or len(displays) != 1:
        raise RuntimeError('Missing or ambiguous actual window display')
    display = displays[0]
    if display.get('scale', 0) <= 0 or display.get('refresh_hz', 0) <= 0:
        raise RuntimeError('Actual display scale or refresh rate unavailable')
    return window


class Candidate:
    def __init__(self, name, bundle, root, observer, sampler, seed_store=None):
        self.name, self.bundle = name, bundle.resolve()
        self.root = root / name
        self.root.mkdir(mode=0o700)
        self.home = self.root / 'home'
        self.home.mkdir(mode=0o700)
        self.nac_home = self.home / '.nac'
        self.nac_home.mkdir(mode=0o700)
        self.workspace = self.root / 'workspace'
        self.workspace.mkdir(mode=0o700)
        self.store = self.root / 'fixture.db'
        if seed_store:
            # Read-only SQLite backup makes equivalent independent live copies.
            with sqlite3.connect(seed_store.as_uri() + '?mode=ro', uri=True) as source:
                with sqlite3.connect(self.store) as target:
                    source.backup(target)
        self.observer, self.sampler = observer, sampler
        self.identity = None
        self.coalition_id = None
        self.known = {}
        self.geometry = None
        self.steady_geometry = None
        self.observations = {}
        info = plistlib.loads((self.bundle / 'Contents/Info.plist').read_bytes())
        self.executable = self.bundle / 'Contents/MacOS' / info['CFBundleExecutable']
        self.engine = self.bundle / 'Contents/Resources/nac-web'
        if not self.engine.exists():
            raise FileNotFoundError(self.engine)
        self.provenance = dict(engine_sha256=digest(self.engine),
                               shell_sha256=digest(self.executable),
                               engine_identity=json.loads(run([self.engine, '__desktop-identity'])),
                               bundle_name=self.bundle.name)

    def state(self):
        state = json.loads(run([self.observer, 'state', self.bundle]))
        if not state['window_metadata_available']:
            raise RuntimeError('Window metadata unavailable')
        if len(state['apps']) > 1:
            raise RuntimeError('Ambiguous candidate app; no control authorized')
        if state['apps'] and not state['apps'][0].get('identity_available'):
            if state['apps'][0]['pid'] not in pid_census():
                return None  # LaunchServices can retain a just-exited app record.
            raise RuntimeError('Candidate PID is present but exact kernel birth is unknown')
        if self.identity and state['apps'] and any(
                state['apps'][0][key] != self.identity[key] for key in ('pid', 'birth_sec', 'birth_usec')):
            raise RuntimeError('Candidate app incarnation changed')
        return state['apps'][0] if state['apps'] else None

    def launch(self):
        assert not self.state(), 'Candidate bundle already running'
        began = time.monotonic()
        env = ['--env', 'HOME=' + str(self.home), '--env', 'NAC_HOME=' + str(self.nac_home),
               '--env', 'NAC_ELECTRON_DATA_HOME=' + str(self.root / 'electron-data'),
               '--env', 'XDG_CONFIG_HOME=' + str(self.home / '.config'),
               '--env', 'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin']
        run(['/usr/bin/open', '-n', *env, '-a', self.bundle, '--args',
             '--directory', self.workspace, '--store-path', self.store])
        self.identity = wait(self.state, 'Candidate app process')
        wait(lambda: (self.state() or {}).get('visible_window'), 'Native visible window')
        visible_ms = (time.monotonic() - began) * 1000
        state = self.state()
        self.launch_displays = admitted_geometry(state)['displays']
        self.geometry = None
        self.observations = {'launch': state}
        return visible_ms

    def geometry_current(self):
        state = self.state()
        geometry = admitted_geometry(state)
        if geometry['displays'] != self.launch_displays:
            raise RuntimeError('Actual window display changed after launch')
        if self.geometry is None:
            # First visible CG bounds can describe macOS's opening animation.
            # Admit resource geometry only after the configured settle allowance.
            if self.steady_geometry is not None and geometry != self.steady_geometry:
                raise RuntimeError('Actual settled geometry or display changed between arm trials')
            self.geometry = self.steady_geometry = geometry
            self.observations['settled'] = state
        elif geometry != self.geometry:
            raise RuntimeError('Actual window geometry or display changed within trial')
        return state

    def control(self, verb):
        assert self.identity and self.state(), 'No current owned app'
        return json.loads(run([self.observer, verb, self.bundle,
                               self.identity['pid'], self.identity['birth_sec'], self.identity['birth_usec']]))

    def reopen(self):
        if not self.state()['active']:
            assert self.control('activate')['accepted'], 'Owned app activation rejected'
            wait(lambda: self.state()['active'], 'Owned app foreground before hide')
        self.control('hide')
        wait(lambda: self.state()['hidden'], 'App hidden')
        began = time.monotonic()
        run(['/usr/bin/open', '-a', self.bundle])
        wait(lambda: not self.state()['hidden'] and self.state()['visible_window'], 'Same app reopen')
        elapsed = (time.monotonic() - began) * 1000
        def geometry_restored():
            state = self.state()
            geometry = admitted_geometry(state)
            if geometry['displays'] != self.geometry['displays']:
                raise RuntimeError('Actual window display changed during reopen')
            if geometry != self.geometry:
                return False
            self.observations['reopen'] = state
            return True
        wait(geometry_restored, 'Same settled native geometry after reopen', seconds=5)
        self.observations['reopen_geometry_settlement_ms'] = (time.monotonic() - began) * 1000 - elapsed
        return elapsed

    def sample(self, require_engine=True):
        state = self.geometry_current() if require_engine else self.state()
        assert state, 'Owned app disappeared during sample'
        began = time.monotonic()
        group, members = coalition(self.identity['pid'], self.bundle)
        if self.coalition_id is not None and group != self.coalition_id:
            raise RuntimeError('App coalition changed')
        self.coalition_id = group
        table = process_table()
        # Include exact app descendants even if a runtime changes coalition.
        while True:
            expanded = members | {pid for pid, entry in table.items() if entry['ppid'] in members}
            if expanded == members:
                break
            members = expanded
        samples = json.loads(run([self.sampler, *sorted(members)]))
        valid = []
        for sample in samples:
            if not sample['valid']:
                # A disappearing helper is recorded, not silently counted as zero.
                continue
            sample['role'] = Path(table.get(sample['pid'], {}).get('executable', 'unknown')).name
            sample['is_engine'] = table.get(sample['pid'], {}).get('executable') == str(self.engine)
            self.known[sample['pid']] = (sample['birth_sec'], sample['birth_usec'])
            valid.append(sample)
        if require_engine and not any(item['is_engine'] for item in valid):
            raise RuntimeError('Exact bundled engine absent; this is not a usable candidate sample')
        return dict(monotonic=time.monotonic(), coalition=group, processes=valid,
                    native_window=state,
                    unavailable_pids=[s['pid'] for s in samples if not s['valid']],
                    collector_ms=(time.monotonic() - began) * 1000)

    def stop(self, quit_wait_seconds=35):
        capture_error = None
        if self.identity is None and self.state():
            raise RuntimeError('App launched without captured incarnation; cleanup cannot be asserted')
        if self.identity and self.state():
            # Capture detached helpers before asking the native Quit owner.
            try:
                self.sample(require_engine=False)
            except Exception as error:
                capture_error = error
            assert self.control('terminate')['accepted'], 'Native protected Quit refused'
            print(json.dumps(dict(waiting_for_protected_quit=self.name, bundle=str(self.bundle))), flush=True)
            # A public native confirmation is deliberately not bypassed. A
            # separate supported UI actor may choose Stop and Quit if shown.
            wait(lambda: not self.state(), 'Protected Quit/app exit', seconds=quit_wait_seconds)
        # Observed children only supply negative cleanup evidence, never kill authority.
        def settled():
            if not self.known:
                return True
            values = json.loads(run([self.sampler, *sorted(self.known)]))
            return identities_settled(self.known, values, pid_census())
        wait(settled, 'Exact app/helper/engine process settlement', seconds=35)
        if any(entry['executable'].startswith(str(self.bundle) + '/') for entry in process_table().values()):
            raise RuntimeError('Bundle process remains after Quit; cleanup cannot be asserted')
        self.identity = None
        self.coalition_id = None
        self.known = {}
        if capture_error:
            raise RuntimeError('App retired, but complete pre-Quit helper census failed') from capture_error


def idle_summary(samples):
    cpu = []
    engine_cpu = []
    for before, after in zip(samples, samples[1:]):
        elapsed = after['monotonic'] - before['monotonic']
        previous = {(v['pid'], v['birth_sec'], v['birth_usec']): v for v in before['processes']}
        deltas = [(v, v['cpu_ns'] - previous[key]['cpu_ns'])
                  for v in after['processes']
                  if (key := (v['pid'], v['birth_sec'], v['birth_usec'])) in previous]
        cpu.append(sum(delta for _, delta in deltas) / 1e9 / elapsed * 100)
        engine_cpu.append(sum(delta for v, delta in deltas if v['is_engine']) / 1e9 / elapsed * 100)
    membership_changes = sum(
        {(p['pid'], p['birth_sec'], p['birth_usec']) for p in left['processes']} !=
        {(p['pid'], p['birth_sec'], p['birth_usec']) for p in right['processes']}
        for left, right in zip(samples, samples[1:]))
    return dict(cpu_percent_one_core=distribution(cpu), engine_cpu_percent_one_core=distribution(engine_cpu),
                physical_footprint_mib=distribution([
                    sum(v['physical_footprint_bytes'] for v in s['processes']) / 2**20 for s in samples]),
                process_count=distribution([len(s['processes']) for s in samples]),
                collector_ms=distribution([s['collector_ms'] for s in samples]),
                unavailable_pid_samples=sum(len(s['unavailable_pids']) for s in samples),
                membership_changes=membership_changes,
                complete_stable_intervals=not membership_changes and not any(s['unavailable_pids'] for s in samples))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--swift', type=Path, required=True)
    parser.add_argument('--electron', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=5)
    parser.add_argument('--settle-seconds', type=float, default=10)
    parser.add_argument('--idle-seconds', type=int, default=10)
    parser.add_argument('--quit-wait-seconds', type=int, default=35,
                        help='allow a supported native UI actor to answer protected Quit (max 180)')
    parser.add_argument('--seed-store', type=Path)
    args = parser.parse_args()
    assert 1 <= args.samples <= 30 and 1 <= args.idle_seconds <= 600
    assert 0 <= args.settle_seconds <= 600
    assert 1 <= args.quit_wait_seconds <= 180
    args.output.mkdir(parents=True, exist_ok=False)
    tools = args.output / 'tools'
    tools.mkdir()
    sampler, observer = tools / 'process-sample', tools / 'window-observer'
    run(['xcrun', 'clang', '-O2', '-Wall', '-Wextra', HERE / 'process_sample.c', '-o', sampler])
    subprocess.run(['xcrun', 'swiftc', '-parse-as-library', '-O', '-framework', 'AppKit',
                    str(HERE / 'WindowObserver.swift'), '-o', str(observer)], check=True, timeout=60)
    fixture = args.output / 'profiles'
    fixture.mkdir(mode=0o700)
    candidates = [Candidate('swift', args.swift, fixture, observer, sampler, args.seed_store),
                  Candidate('electron', args.electron, fixture, observer, sampler, args.seed_store)]
    assert candidates[0].provenance['engine_sha256'] == candidates[1].provenance['engine_sha256'], 'Engine mismatch'
    result = dict(schema_version=1, acceptance='early-development-proxies-only',
                  recorded_at_utc=datetime.now(timezone.utc).isoformat(),
                  source_revision=candidates[0].provenance['engine_identity']['source_revision'],
                  observer_provenance=dict(
                      checkout_revision=run(['git', '-C', HERE, 'rev-parse', 'HEAD'], text=True).strip(),
                      source_sha256={name: digest(HERE / name) for name in
                                     ('compare.py', 'WindowObserver.swift', 'process_sample.c')},
                      executable_sha256={'window-observer': digest(observer), 'process-sample': digest(sampler)}),
                  host=dict(os=run(['sw_vers', '-productVersion'], text=True).strip(),
                            cpu=run(['sysctl', '-n', 'machdep.cpu.brand_string'], text=True).strip(),
                            memory_bytes=int(run(['sysctl', '-n', 'hw.memsize'])),
                            displays=display_metadata(),
                            power=run(['pmset', '-g', 'batt'], text=True).strip()),
                  arms={c.name: c.provenance for c in candidates}, trials=[], failures=[],
                  settings=dict(samples=args.samples, settle_seconds=args.settle_seconds,
                                idle_seconds=args.idle_seconds,
                                cache_state='OS caches retained; no purge; independent persistent app profiles',
                                workload='equivalent cloned seed store' if args.seed_store else 'empty disposable store',
                                seed_store_sha256=digest(args.seed_store) if args.seed_store else None))
    receipt = args.output / 'samples.json'
    def save():
        receipt.write_text(json.dumps(result, indent=2) + '\n')
    for trial in range(args.samples):
        for candidate in candidates[::1 if trial % 2 == 0 else -1]:
            entry = dict(arm=candidate.name, trial=trial, store_state='fresh' if trial == 0 else 'returning')
            try:
                entry['launch_to_visible_native_window_ms'] = candidate.launch()
                time.sleep(args.settle_seconds)
                snapshots = [candidate.sample()]
                for _ in range(args.idle_seconds):
                    time.sleep(1)
                    snapshots.append(candidate.sample())
                entry['idle_samples'] = snapshots
                entry['idle_summary'] = idle_summary(snapshots)
                entry['hide_to_launchservices_reopen_ms'] = candidate.reopen()
            except Exception as error:
                entry['error'] = type(error).__name__ + ': ' + str(error)
                result['failures'].append(dict(arm=candidate.name, trial=trial, error=entry['error']))
            finally:
                try:
                    candidate.stop(args.quit_wait_seconds)
                    entry['native_observations'] = candidate.observations
                    entry['cleanup_settled'] = True
                except Exception as error:
                    entry['cleanup_settled'] = False
                    result['failures'].append(dict(arm=candidate.name, trial=trial,
                                                  error='Cleanup: ' + type(error).__name__ + ': ' + str(error)))
                result['trials'].append(entry)
                save()
            if not entry.get('cleanup_settled'):
                raise RuntimeError('Cleanup remains pending; profiles retained, no further launches')
            if entry.get('error'):
                raise RuntimeError('Trial admission failed after settled cleanup; no further launches')
    result['summary'] = {c.name: {
        metric: distribution([v[metric] for v in result['trials'] if v['arm'] == c.name and metric in v])
        for metric in ('launch_to_visible_native_window_ms', 'hide_to_launchservices_reopen_ms')}
        for c in candidates}
    for candidate in candidates:
        trials = [v for v in result['trials'] if v['arm'] == candidate.name and 'idle_summary' in v
                  and v['idle_summary']['complete_stable_intervals'] and 'error' not in v
                  and v.get('cleanup_settled')]
        result['summary'][candidate.name]['resource_trials_included'] = len(trials)
        result['summary'][candidate.name]['resource_trials_excluded'] = sum(
            v['arm'] == candidate.name and 'idle_summary' in v for v in result['trials']) - len(trials)
        result['summary'][candidate.name]['idle_trial_median_cpu_percent_one_core'] = distribution([
            v['idle_summary']['cpu_percent_one_core']['median'] for v in trials])
        result['summary'][candidate.name]['idle_trial_median_physical_footprint_mib'] = distribution([
            v['idle_summary']['physical_footprint_mib']['median'] for v in trials])
    result['host']['power_after'] = run(['pmset', '-g', 'batt'], text=True).strip()
    save()
    print(receipt)
    if result['failures']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
