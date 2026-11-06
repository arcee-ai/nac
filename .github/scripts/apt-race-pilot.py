#!/usr/bin/env python3
"""PRIVATE payload-only dynamic-plan native APT race. Never an install/test verdict."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


native = module('native', 'browser-apt.py')
store = native.store
supervisor = native.supervisor
ROOT = Path(__file__).resolve().parents[2]
ROUTES = {'azure': 'http://azure.archive.ubuntu.com/ubuntu', 'official': 'http://archive.ubuntu.com/ubuntu'}
INDEX_CAP = 384*1024**2
TOTAL_CAP = 1536*1024**2
TEXT_CAP = 128*1024**2
WHOLE_SECONDS = 2100
JOB_SECONDS = 2400
CLEANUP_SECONDS = 30
MAX_PACKAGES = 32


class BudgetNotExecuted(RuntimeError):
    """Typed refusal: no performance/result credit and no automatic resume."""


def budget_deadline(job_started, now_wall, now_monotonic):
    elapsed = now_wall-float(job_started)
    require(0 <= elapsed <= JOB_SECONDS, 'invalid/expired first-step job clock')
    return now_monotonic+min(WHOLE_SECONDS, JOB_SECONDS-elapsed-CLEANUP_SECONDS)


def require(value, message):
    if not value:
        raise ValueError(message)


def write(path, value):
    with path.open('x') as out:
        json.dump(value, out, sort_keys=True, indent=2)
        out.write('\n')


def tree_bytes(root):
    total = 0
    for path in root.rglob('*'):
        info = path.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'link in owned tree')
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), 'nonregular owned tree')
        if stat.S_ISREG(info.st_mode):
            require(info.st_nlink == 1, 'linked owned file')
            total += info.st_size
    return total


def agree(canonical, alternate):
    store.validate_plan(canonical)
    store.validate_plan(alternate)
    require(canonical == alternate, 'fresh signed route plan differs')


def resource_plan(value):
    store.validate_plan(value)
    require(len(value['packages']) <= MAX_PACKAGES, 'full closure outside finite pilot package bound')
    size = sum(int(row['Size']) for row in value['packages'])
    # Baseline bytes are hashed then deleted before candidate starts. Two arms
    # plus winner immutable export coexist; this does not raise the old bound.
    require(3*size+1024**2 <= store.MAX_TOTAL, 'aggregate archive copy cap')
    return size


def config(root, architecture_configuration):
    require(re.fullmatch(r'/[A-Za-z0-9_./-]+', str(root)), 'unsafe APT root')
    lines = [f'Dir::Etc::main "{root}/empty.conf";', f'Dir::Etc::parts "{root}/conf.d";',
        f'Dir::Etc::sourcelist "{root}/sources.list";',
        f'Dir::Etc::sourceparts "{root}/sources.d";']
    # Canonical uses exact host sources, fresh private lists/cache, and no host
    # hooks. Payload routes replace only Ubuntu base URIs in private copies.
    lines += [f'Dir::State "{root}/state";', f'Dir::State::lists "{root}/state/lists";',
        'Dir::State::status "/var/lib/dpkg/status";', f'Dir::Cache "{root}/cache";',
        f'Dir::Cache::archives "{root}/cache/archives";', 'Dir::Cache::pkgcache "";',
        'Dir::Cache::srcpkgcache "";', f'Dir::Log "{root}/log";',
        architecture_configuration,
        'Acquire::Check-Date "true";', 'Acquire::Check-Valid-Until "true";',
        'Acquire::AllowInsecureRepositories "false";', 'Acquire::AllowDowngradeToInsecureRepositories "false";',
        'APT::Get::AllowUnauthenticated "false";']
    return '\n'.join(lines)+'\n'


def copy_sources(root, route):
    inputs = [Path('/etc/apt/sources.list'), *sorted(Path('/etc/apt/sources.list.d').glob('*'))]
    ubuntu = 0
    for source in inputs:
        if not source.exists() or source.suffix not in ('.list', '.sources'):
            continue
        with store.regular(source) as handle:
            raw = handle.read(128*1024+1)
        require(len(raw) <= 128*1024, 'source configuration bound')
        text = raw.decode()
        if route:
            # Retain suites/components/signing keys/native architectures. Never
            # rewrite other repositories or arbitrary substrings/credentials.
            pattern = r'(?:mirror\+file:/etc/apt/apt-mirrors\.txt|https?://(?:azure\.)?archive\.ubuntu\.com/ubuntu|https?://security\.ubuntu\.com/ubuntu)(?=[\s/]|$)'
            text, count = re.subn(pattern, ROUTES[route], text)
            ubuntu += count
            require('mirror+' not in text, 'unknown native mirror configuration')
        destination = root/'sources.list' if source.name == 'sources.list' else root/'sources.d'/source.name
        destination.write_text(text)
    if route:
        require(ubuntu > 0, 'no recognized native Ubuntu source')
    if not (root/'sources.list').exists():
        (root/'sources.list').touch()


def architecture(text):
    lines = [line for line in text.splitlines() if line.startswith('APT::Architectur')]
    fields = {}
    for line in lines:
        match = re.fullmatch(r'APT::(Architecture|Architecture-Variant|Architecture-Variants|Architectures|Architectures::) "([a-z0-9]*)";', line)
        require(match, 'unknown architecture configuration')
        fields.setdefault(match[1], []).append(match[2])
    values, arches = fields.get('Architecture', []), fields.get('Architectures::', [])
    require(values in (['amd64'], ['amd64v3']) and arches and len(arches) == len(set(arches)) and
            set(arches) <= {'amd64', 'amd64v3'} and values[0] in arches,
            'unsupported actual native architecture configuration')
    require(all(len(rows) == 1 for key, rows in fields.items() if key != 'Architectures::') and
            fields.get('Architectures', []) in ([], ['']), 'duplicate/conflicting architecture fields')
    variants = fields.get('Architecture-Variant', [])+fields.get('Architecture-Variants', [])
    require(len(variants) <= 1 and all(value == 'amd64v3' for value in variants), 'duplicate/conflicting/unsupported variant')
    return '\n'.join(lines)


def selection(solver, uris, records, repository):
    rows = native.selected(solver)
    offered = native.offers(uris)
    blocks = [dict(line.split(': ', 1) for line in part.splitlines()
                   if ': ' in line and not line[0].isspace()) for part in records.strip().split('\n\n')]
    pins = []
    for name, version in rows:
        matches = {store.canonical({key: row[key] for key in store.FIELDS}) for row in blocks
            if row.get('Package') == name and row.get('Version') == version and store.offer_name(row) in offered
            and offered[store.offer_name(row)] == (row['Filename'], int(row['Size']))}
        require(len(matches) == 1, 'signed selected identity missing/ambiguous')
        pins.append(json.loads(matches.pop()))
    require({store.offer_name(row) for row in pins} == set(offered), 'fresh selected URI inventory differs')
    value = {'schema': 1, 'repository': repository, 'platform': native.PLATFORM,
             'packages': sorted(pins, key=lambda row: row['Package'])}
    resource_plan(value)
    return value


def verified(directory, value):
    require({p.name for p in directory.iterdir()} == {store.offer_name(row) for row in value['packages']},
            'partial/extra download closure')
    result = {}
    for row in value['packages']:
        started = time.monotonic()
        path = directory/store.offer_name(row)
        with store.regular(path) as source:
            store.verify(source, row)
        result[row['Package']] = {'bytes': path.stat().st_size, 'sha256': native.digest(path),
                                 'verification_seconds': time.monotonic()-started}
    return result


def elect(results):
    # Inspect all observed completions before any winning election. A failure
    # cannot be ignored because another arm is first in an iteration/list.
    for value in results.values():
        require(value['reason'] == 'completed' and value['exit'] == 0 and not value['error'] and
                value['cleanup']['remaining'] == [], 'unexpected acquisition failure')
    return sorted(results)[0] if results else None


class Pilot:
    def __init__(self, output):
        self.output = output
        output.mkdir(mode=0o700)
        require(shutil.disk_usage(output).free >= 13*1024**3+TOTAL_CAP, 'initial reserved free-space fence')
        self.deadline = budget_deadline(os.environ['PILOT_JOB_STARTED'], time.time(), time.monotonic())
        self.root = Path(tempfile.mkdtemp(prefix='nac-apt-race-', dir=os.environ['RUNNER_TEMP']))
        self.owner = (self.root.stat().st_dev, self.root.stat().st_ino)
        self.started = time.monotonic()
        self.active = []
        self.commands = []
        self.report = {'status': 'failed', 'arms': [], 'bound_seconds': WHOLE_SECONDS,
                       'job_started_epoch': float(os.environ['PILOT_JOB_STARTED']), 'job_bound_seconds': JOB_SECONDS,
                       'controller_deadline_monotonic': self.deadline,
                       'scope': 'Private authenticated payload only; no installation/runtime/pipeline/cohort verdict.',
                       'resource_high_water': {'owned_bytes': 0, 'archive_bytes': 0, 'indexes_bytes': 0},
                       'minimum_observed_free_bytes': shutil.disk_usage(self.root).free}

    def guard(self):
        if time.monotonic() >= self.deadline:
            raise BudgetNotExecuted('controller budget exhausted; no result')
        self.resource_guard()

    def resource_guard(self):
        require(shutil.disk_usage(self.root).free >= 13*1024**3, '13GiB free-space fence')
        total = tree_bytes(self.root)+tree_bytes(self.output)
        require(total <= TOTAL_CAP, 'owned total byte fence')
        require(tree_bytes(self.output) <= TEXT_CAP, 'text evidence byte fence')
        indexes = 0
        for path in self.root.glob('*/state/lists'):
            require(tree_bytes(path) <= INDEX_CAP, 'per-authority index byte fence')
            indexes += tree_bytes(path)
        payload = sum(tree_bytes(p) for p in self.root.glob('*/downloads'))
        if (self.root/'snapshot').exists():
            payload += tree_bytes(self.root/'snapshot')
        require(payload <= store.MAX_TOTAL, 'aggregate archive byte fence')
        high = self.report['resource_high_water']
        for key, value in [('owned_bytes', total), ('archive_bytes', payload), ('indexes_bytes', indexes)]:
            high[key] = max(high[key], value)
        self.report['minimum_observed_free_bytes'] = min(self.report['minimum_observed_free_bytes'], shutil.disk_usage(self.root).free)

    def admit(self):
        self.guard()
        if self.deadline-time.monotonic() < 900+CLEANUP_SECONDS:
            raise BudgetNotExecuted('full 900s native operation plus cleanup cannot fit; not launched/no result')

    def start(self, label, argv, cwd, apt_config=None, file_limit=128*1024**2):
        self.admit()
        state = self.output/label
        state.mkdir(mode=0o700)
        nonce = secrets.token_hex(16)
        me = supervisor.process(os.getpid())
        command = [sys.executable, str(Path(__file__).with_name('apt-race-worker.py')), '--state', str(state),
            '--cwd', str(cwd), '--parent', str(me['pid']), '--start', str(me['start']), '--nonce', nonce]
        command += ['--file-limit', str(file_limit)]
        command += ['--deadline', str(self.deadline)]
        if apt_config:
            command += ['--apt-config', str(apt_config)]
        with (self.output/(label+'-worker.stderr')).open('xb') as stderr:
            child = subprocess.Popen([*command, '--', *argv], stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=stderr, start_new_session=True)
        value = {'label': label, 'args': argv, 'nonce': nonce, 'pid': child.pid, 'start': time.monotonic(),
                 'cwd': str(cwd), 'apt_config': str(apt_config) if apt_config else None,
                 'started_at': datetime.now(timezone.utc).isoformat()}
        self.commands.append(value)
        worker = {'child': child, 'state': state, 'row': value}
        self.active.append(worker)
        return worker

    def result(self, worker):
        if 'result' in worker['row']:
            return worker['row']['result']
        child, state = worker['child'], worker['state']
        if child.poll() is None:
            return None
        require((state/'result.json').is_file(), 'missing worker cleanup receipt')
        result = native.load(state/'result.json')
        require(result['nonce'] == worker['row']['nonce'] and result['cleanup']['remaining'] == [],
                'foreign worker or remaining descendants')
        require((result['reason'] != 'completed' or child.returncode == 0) and
                (result['reason'] != 'winner-cancelled' or child.returncode == 125), 'worker status/receipt disagreement')
        worker['row'].update(result=result, worker_exit=child.returncode,
                             wall_seconds=time.monotonic()-worker['row']['start'],
                             ended_at=datetime.now(timezone.utc).isoformat())
        if worker in self.active:
            self.active.remove(worker)
        if result['reason'] == 'budget-not-executed':
            raise BudgetNotExecuted('worker refused before native spawn; no result')
        return result

    def cancel(self, worker, reason):
        write(worker['state']/'stop', {'nonce': worker['row']['nonce'], 'reason': reason})
        child = worker['child']
        child.wait(timeout=8)
        result = self.result(worker)
        require(result and result['cleanup']['remaining'] == [], 'missing owned cancellation cleanup')
        return result

    def command(self, label, argv, cwd, apt_config=None):
        child = self.start(label, argv, cwd, apt_config)
        while True:
            self.guard()
            result = self.result(child)
            if result is not None:
                elect({label: result})
                return (child['state']/'stdout.log').read_text()
            time.sleep(.05)

    def authority(self, name, architecture_configuration, repository, requests, route=None):
        root = self.root/name
        for directory in ('conf.d', 'sources.d', 'state/lists/partial', 'cache/archives/partial', 'log', 'downloads'):
            (root/directory).mkdir(mode=0o700, parents=True, exist_ok=True)
        (root/'empty.conf').touch()
        copy_sources(root, route)
        apt_config = root/'apt.conf'
        apt_config.write_text(config(root, architecture_configuration))
        shutil.copytree(root/'sources.d', self.output/(name+'-sources'))
        shutil.copy2(root/'sources.list', self.output/(name+'-sources.list'))
        shutil.copy2(apt_config, self.output/(name+'-apt.conf'))
        self.command(name+'-update', ['/usr/bin/apt-get', 'update', '--error-on=any'], root, apt_config)
        releases = list((root/'state/lists').glob('*_InRelease'))
        require(0 < len(releases) <= 32, 'fresh signed release inventory')
        signed = [{'name': p.name, 'sha256': native.digest(p), 'bytes': p.stat().st_size} for p in releases]
        write(self.output/(name+'-signed-metadata.json'), signed)
        snapshot = self.output/(name+'-signed-metadata')
        snapshot.mkdir()
        for path in releases:
            shutil.copy2(path, snapshot/path.name)
        solver = self.command(name+'-solver', ['/usr/bin/apt-get', '-s', 'install', '--no-install-recommends', *requests], root, apt_config)
        rows = native.selected(solver)
        require(0 < len(rows) <= MAX_PACKAGES, 'empty/oversized full native missing closure')
        uris = self.command(name+'-uris', ['/usr/bin/apt-get', '--print-uris', '--download-only', '--yes',
                            'install', '--no-install-recommends', *requests], root, apt_config)
        records = self.command(name+'-records', ['/usr/bin/apt-cache', 'show', *[p+'='+v for p,v in rows]], root, apt_config)
        value = selection(solver, uris, records, repository)
        write(self.output/(name+'-plan.json'), value)
        return root, apt_config, value

    def acquire(self, label, root, apt_config, value):
        return self.start(label, ['/usr/bin/apt-get', 'download',
            *[row['Package']+'='+row['Version'] for row in value['packages']]], root/'downloads', apt_config,
            file_limit=max(int(row['Size']) for row in value['packages']))

    def signature_negative(self, canonical):
        releases = [path for path in (canonical/'state/lists').glob('*_InRelease') if b'Origin: Ubuntu\n' in path.read_bytes()]
        require(releases, 'Ubuntu signed negative source missing')
        raw = releases[0].read_bytes()
        bad = raw.replace(b'Origin: Ubuntu\n', b'Origin: Invalid-offline-control\n', 1)
        require(bad != raw, 'signature negative not mutated')
        path = self.root/'bad-InRelease'
        path.write_bytes(bad)
        worker = self.start('signature-negative', ['/usr/bin/gpgv', '--keyring',
            '/usr/share/keyrings/ubuntu-archive-keyring.gpg', str(path)], self.root)
        while (result := self.result(worker)) is None:
            self.guard()
            time.sleep(.05)
        require(result['reason'] == 'failed' and result['exit'] == 1 and
                'BAD signature' in (worker['state']/'stderr.log').read_text(), 'wrong signature negative failure')
        self.report['signature_negative'] = 'native gpgv rejected mutated current Ubuntu InRelease'

    def race(self, arms, value):
        self.admit()
        workers = {name: self.acquire('race-'+name, root, cfg, value) for name, root, cfg in arms}
        while True:
            self.guard()
            results = {name: result for name, worker in workers.items() if (result := self.result(worker)) is not None}
            winner = elect(results)
            if winner:
                # Verify every already-completed closure, including a loser that
                # exits zero with invalid bytes; it cannot hide behind a winner.
                checks = {}
                for name in results:
                    checks[name] = verified(next(root for key, root, _ in arms if key == name)/'downloads', value)
                for name, worker in workers.items():
                    result = self.result(worker)
                    if result is not None:
                        elect({name: result})
                        if name not in checks:
                            checks[name] = verified(next(root for key, root, _ in arms if key == name)/'downloads', value)
                        continue
                    cancelled = self.cancel(worker, 'winner-cancelled')
                    if cancelled['reason'] == 'completed':
                        elect({name: cancelled})
                        checks[name] = verified(next(root for key, root, _ in arms if key == name)/'downloads', value)
                    else:
                        require(cancelled['reason'] == 'winner-cancelled' and not cancelled['error'] and
                                worker['child'].returncode == 125, 'unexpected loser failure during winner cancellation')
                self.report['race'] = {'winner': winner, 'completed_verified': checks,
                    'arms': {name: worker['row'] for name, worker in workers.items()},
                    'retained_download_bytes': {name: tree_bytes(root/'downloads') for name,root,_ in arms},
                    'tie_rule': 'lexical only among completions observed together; all failures inspected first'}
                return next(root for name, root, _ in arms if name == winner)
            time.sleep(.05)

    def drain_budget(self):
        # Never turn admission refusal for a later operation into a shortened
        # timeout for an already admitted native operation. Its worker retains
        # the full 900s clock and own cleanup inside the admitted deadline.
        while self.active and time.monotonic() < self.deadline+8:
            self.resource_guard()
            for worker in list(self.active):
                try:
                    self.result(worker)
                except BudgetNotExecuted:
                    pass
            self.resource_guard()
            time.sleep(.025)

    def finish(self):
        failures = []
        if self.report.get('budget_not_executed'):
            try:
                self.drain_budget()
            except BaseException as error:
                failures.append('budget drain failed: '+str(error))
        for worker in list(self.active):
            try:
                self.cancel(worker, 'controller-stop')
            except BaseException as error:
                failures.append(str(error))
        try:
            info = self.root.lstat()
            require(stat.S_ISDIR(info.st_mode) and (info.st_dev, info.st_ino) == self.owner,
                    'refuse foreign replacement cleanup')
            self.report['private_bytes_before_cleanup'] = tree_bytes(self.root)
            shutil.rmtree(self.root)
        except BaseException as error:
            failures.append(str(error))
        self.report.update(cleanup_failures=failures, private_root_removed=not self.root.exists(),
                           seconds=time.monotonic()-self.started,
                           controller_usage=list(resource.getrusage(resource.RUSAGE_SELF)))
        if failures:
            self.report['status'] = 'failed'
        write(self.output/'commands.json', self.commands)
        write(self.output/'report.json', self.report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(native.supported() and os.getuid() > 0, 'ordinary supported GNU runner required')
    os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:2])
    require(Path(os.environ.get('RUNNER_TEMP', '')).is_absolute(), 'private runner temp required')
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == args.source and
            re.fullmatch(r'[0-9a-f]{40}', args.source), 'immutable source mismatch')
    pilot = Pilot(args.output.absolute())
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda _s, _f: (_ for _ in ()).throw(InterruptedError('controller signal')))
    try:
        identity = native.source_identity(args.source)
        identity['dpkg_status_sha256'] = native.digest(Path('/var/lib/dpkg/status'))
        pilot.report['identity'] = identity
        pilot.report['source_files'] = {name: native.digest(Path(__file__).with_name(name)) for name in
            ('apt-race-pilot.py', 'apt-race-worker.py', 'browser-apt.py', 'browser-apt-supervisor.py', 'apt-archive-store.py')}
        pilot.report['native_tools'] = {name: native.digest(Path('/usr/bin')/name) for name in
            ('apt-config', 'apt-get', 'apt-cache', 'gpgv', 'dpkg-deb')}
        names, tool = native.requests(ROOT/'crates/nac-server/web')
        pilot.report.update(requests=names, tool=tool)
        architecture_configuration = architecture(pilot.command('native-config', ['/usr/bin/apt-config', 'dump'], ROOT))
        canonical, canonical_cfg, value = pilot.authority('canonical', architecture_configuration, identity['repository'], names)
        arms = []
        for name in ROUTES:
            root, cfg, alternate = pilot.authority(name, architecture_configuration, identity['repository'], names, name)
            agree(value, alternate)
            arms.append((name, root, cfg))
        require(native.digest(Path('/var/lib/dpkg/status')) == identity['dpkg_status_sha256'], 'native baseline drift')
        pilot.signature_negative(canonical)
        baseline = pilot.acquire('baseline-native', canonical, canonical_cfg, value)
        while pilot.result(baseline) is None:
            pilot.guard()
            time.sleep(.05)
        elect({'baseline': pilot.result(baseline)})
        pilot.report['baseline_verified'] = verified(canonical/'downloads', value)
        pilot.report['baseline'] = baseline['row']
        for path in (canonical/'downloads').iterdir():
            path.unlink()
        winner = pilot.race(arms, value)
        pilot.report['export'] = store.export(value, {row['Package']: winner/'downloads'/store.offer_name(row)
            for row in value['packages']}, pilot.root/'snapshot', {'source': args.source, 'origin': 'private-native-race-payload-only'})
        # Retain manifest, not duplicate payload/index copies in artifact service.
        shutil.copy2(pilot.root/'snapshot/manifest.json', pilot.output/'winner-manifest.json')
        pilot.guard()
        pilot.report['status'] = 'complete-payload-comparison-only'
    except BaseException as error:
        pilot.report['error'] = type(error).__name__+': '+str(error)
        if isinstance(error, BudgetNotExecuted):
            pilot.report['budget_not_executed'] = True
            pilot.report['status'] = 'budget-not-executed-no-result'
    finally:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        pilot.finish()
    return 0 if pilot.report['status'] == 'complete-payload-comparison-only' else 1


if __name__ == '__main__':
    sys.exit(main())
