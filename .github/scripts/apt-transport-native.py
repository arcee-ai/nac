#!/usr/bin/env python3
"""Private, unprivileged AB/BA APT transport diagnostic; never a CI verdict."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('archive_probe',
    Path(__file__).with_name('apt-transport-probe.py'))
archive = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(archive)
ORDER = ('azure', 'official', 'official', 'azure')
ROUTES = dict(archive.ROUTES)
PINS = Path(__file__).resolve().parents[2]/'docs/ci/evidence/all-582/apt-transport-local.json'


def apt_config(root):
    """Load no host hooks/config and write all APT state only below this root."""
    if not root.is_absolute() or not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(root)):
        raise ValueError('unsafe private APT root')
    return f'''Dir::Etc::main "{root}/empty.conf";
Dir::Etc::parts "{root}/apt.conf.d";
Dir::Etc::sourcelist "{root}/sources.list";
Dir::Etc::sourceparts "{root}/sourceparts";
Dir::State "{root}/state";
Dir::State::lists "{root}/state/lists";
Dir::State::status "/var/lib/dpkg/status";
Dir::Cache "{root}/cache";
Dir::Cache::archives "{root}/cache/archives";
Dir::Cache::pkgcache "";
Dir::Cache::srcpkgcache "";
Dir::Log "{root}/log";
APT::Architecture "amd64v3";
APT::Architectures {{ "amd64v3"; }};
Acquire::Check-Date "true";
Acquire::Check-Valid-Until "true";
Acquire::AllowInsecureRepositories "false";
Acquire::AllowDowngradeToInsecureRepositories "false";
'''


def child_limits():
    os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:2])
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024**2, 768 * 1024**2))
    resource.setrlimit(resource.RLIMIT_CPU, (1800, 1800))
    # The authenticated universe Packages index is 77,706,789 bytes uncompressed.
    resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024**2, 128 * 1024**2))


class NativeProbe:
    def __init__(self, args):
        self.args = args
        self.output = args.output.resolve()
        self.output.mkdir(mode=0o700)
        self.started = time.monotonic()
        self.env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL') if k in os.environ}
        self.commands = []
        self.private_roots = []
        self.expected_packages = json.loads(PINS.read_text())['packages']
        self.report = {'started_at': archive.now(), 'source': args.source,
            'historical_source': '57f08f8442bdb1186b99958a178edc1c9e104368',
            'script_sha256': archive.digest(Path(__file__).read_bytes()),
            'shared_validation_sha256': archive.digest(Path(archive.__file__).read_bytes()),
            'package_pins_sha256': archive.digest(PINS.read_bytes()),
            'order': ORDER, 'arms': [], 'status': 'failed',
            'coverage': 'Diagnostic transport only; no package install/test/ordinary PR verdict.',
            'limits': {'child_address_space_bytes': 805306368, 'child_cpu_seconds': 1800,
                       'child_file_bytes': 134217728, 'whole_seconds': 1800,
                       'output_bytes': 1073741824, 'host_free_stop_bytes': 13958643712}}

    def guard(self):
        if time.monotonic()-self.started > 1800:
            raise RuntimeError('whole diagnostic bound reached')
        if shutil.disk_usage(self.output).free < 13 * 1024**3:
            raise RuntimeError('host reserve reached')
        if sum(p.stat().st_size for p in self.output.rglob('*') if p.is_file()) > 1024**3:
            raise RuntimeError('output bound reached')

    def command(self, label, argv, *, cwd=None, env=None, expected=0, timeout=900):
        self.guard()
        tick = time.monotonic()
        row = {'label': label, 'argv': argv, 'started_at': archive.now()}
        child = subprocess.Popen(argv, cwd=cwd, env=env or self.env, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, start_new_session=True, preexec_fn=child_limits)
        try:
            out, err = child.communicate(timeout=min(timeout, max(1, 1800-(tick-self.started))))
        except BaseException:
            # Only the process group created for this command, never other jobs.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            out, err = child.communicate(timeout=10)
            (self.output/(label+'.stdout')).write_bytes(out)
            (self.output/(label+'.stderr')).write_bytes(err)
            row.update(exit=child.returncode, seconds=time.monotonic()-tick,
                       ended_at=archive.now(), interrupted_or_timed_out=True)
            self.commands.append(row)
            (self.output/'commands.json').write_text(json.dumps(self.commands, indent=2)+'\n')
            raise
        (self.output/(label+'.stdout')).write_bytes(out)
        (self.output/(label+'.stderr')).write_bytes(err)
        row.update(exit=child.returncode, seconds=time.monotonic()-tick, ended_at=archive.now())
        self.commands.append(row)
        (self.output/'commands.json').write_text(json.dumps(self.commands, indent=2)+'\n')
        if child.returncode != expected:
            raise RuntimeError(f'{label}: exit {child.returncode}; retained, no retry')
        return out

    def arm(self, index, name, prior):
        label = f'{index}-{name}'
        # Each arm gets new private lists and archives outside workspace/compiler caches.
        with tempfile.TemporaryDirectory(prefix='nac-apt-', dir=self.args.temp_root) as value:
            root = Path(value)
            self.private_roots.append(root)
            for directory in ('apt.conf.d', 'sourceparts', 'state/lists/partial',
                              'cache/archives/partial', 'log', 'downloads'):
                (root/directory).mkdir(parents=True, exist_ok=True)
            (root/'empty.conf').touch()
            (root/'apt.conf').write_text(apt_config(root))
            (root/'sources.list').write_text(
                f'deb [arch=amd64v3 signed-by={archive.KEYRING}] {ROUTES[name]} resolute main universe\n')
            for filename in ('apt.conf', 'sources.list'):
                (self.output/(label+'-'+filename)).write_bytes((root/filename).read_bytes())
            env = {**self.env, 'APT_CONFIG': str(root/'apt.conf'), 'HOME': str(root)}
            self.command(label+'-update', ['apt-get', 'update', '--error-on=any'], env=env)
            releases = list((root/'state/lists').glob('*_InRelease'))
            if len(releases) != 1:
                raise RuntimeError('wrong signed release inventory')
            release = releases[0].read_bytes()
            (self.output/(label+'-InRelease')).write_bytes(release)
            self.command(label+'-signature', ['gpgv', '--keyring', archive.KEYRING,
                                           str(releases[0])], env=env)
            pins = [archive.metadata(self.command(f'{label}-metadata-{i}',
                    ['apt-cache', 'show', package+'='+version], env=env).decode(), package)
                    for i, (package, version) in enumerate(archive.PACKAGES.items())]
            if pins != self.expected_packages:
                raise RuntimeError('exact signed archive pins differ from corrected local pair')
            identity = {'release_sha256': archive.digest(release), 'packages': pins}
            if prior and identity != prior:
                raise RuntimeError('signed release or exact package bytes differ; comparison stopped')
            row = {'name': name, 'label': label, 'route': ROUTES[name], **identity,
                   'private_root': str(root), 'private_root_removed': False,
                   'release_date_fields': {k:v for k,v in archive.fields(release.decode()).items()
                                          if k in ('Date', 'Valid-Until', 'Suite', 'Codename')}}
            self.report['arms'].append(row)
            tick = time.monotonic()
            self.command(label+'-download', ['apt-get', 'download',
                         *[k+'='+v for k,v in archive.PACKAGES.items()]],
                         cwd=root/'downloads', env=env)
            row['archive_transfer_seconds'] = time.monotonic()-tick
            files = list((root/'downloads').glob('*.deb'))
            if len(files) != 9:
                raise RuntimeError('wrong archive count')
            seen = set()
            first = None
            for i, path in enumerate(sorted(files)):
                actual = archive.fields(self.command(f'{label}-control-{i}',
                    ['dpkg-deb', '-f', str(path), 'Package', 'Version', 'Architecture'], env=env).decode())
                pin = next((p for p in pins if p['Package']==actual.get('Package')), None)
                if pin is None or pin['Package'] in seen or path.stat().st_size > 32*1024**2:
                    raise RuntimeError('unexpected archive or size')
                seen.add(pin['Package'])
                data = path.read_bytes()
                archive.verify(data, pin, actual)
                (self.output/(label+'-'+path.name)).write_bytes(data)
                first = first or (data, pin, actual)
            if index == 0:
                self.controls(label, root, release, first, env)
            row['private_writable_bytes'] = sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
            if row['private_writable_bytes'] > 768*1024**2:
                raise RuntimeError('private state bound reached')
        row['private_root_removed'] = not root.exists()
        if not row['private_root_removed']:
            raise RuntimeError('private state cleanup failed')
        return identity

    def controls(self, label, root, release, first, env):
        data, pin, actual = first
        try:
            archive.verify(data, {**pin, 'SHA256': '0'*64}, actual)
        except ValueError:
            self.report['wrong_hash_rejected'] = True
        else:
            raise RuntimeError('hash negative accepted')
        tampered = release.replace(b'Suite: resolute', b'Suite: invalid-control', 1)
        if tampered == release:
            raise RuntimeError('signature negative unavailable')
        bad = root/'tampered-InRelease'
        bad.write_bytes(tampered)
        self.command(label+'-bad-signature', ['gpgv', '--keyring', archive.KEYRING, str(bad)],
                     env=env, expected=1)
        if b'BAD signature' not in (self.output/(label+'-bad-signature.stderr')).read_bytes():
            raise RuntimeError('wrong signature failure')
        self.command(label+'-missing', ['apt-get', 'download',
                     'all582-definitely-missing-font-control'], cwd=root/'downloads', env=env, expected=100)
        if b'Unable to locate package all582-definitely-missing-font-control' not in (
                self.output/(label+'-missing.stderr')).read_bytes():
            raise RuntimeError('wrong missing-package failure')
        self.report['negative_controls'] = {'signature_exit': 1, 'missing_package_exit': 100}

    def run(self):
        try:
            if platform.system() != 'Linux' or os.geteuid() == 0:
                raise RuntimeError('requires unprivileged Linux runner')
            release = Path('/etc/os-release').read_text()
            if 'VERSION="26.04.1 LTS' not in release or platform.machine() != 'x86_64':
                raise RuntimeError('actual runner release/platform differs from retained source')
            self.report['runner'] = {k: os.environ.get(k, '') for k in (
                'ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH', 'GITHUB_REPOSITORY',
                'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REF', 'GITHUB_EVENT_NAME')}
            if not all(self.report['runner'].values()):
                raise RuntimeError('missing actual runner/run identity')
            if self.command('source', ['git', 'rev-parse', 'HEAD']).decode().strip() != self.args.source:
                raise RuntimeError('checkout source mismatch')
            self.report['os_release'] = release
            for tool in ('apt-get', 'apt-cache', 'gpgv', 'dpkg-deb', 'dpkg'):
                path = shutil.which(tool, path=self.env['PATH'])
                if not path:
                    raise RuntimeError('required existing tool unavailable')
                self.report.setdefault('tools', {})[tool] = {'path': path,
                    'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest()}
                self.command(tool+'-version', [path, '--version'])
            self.report['dpkg_architecture'] = self.command(
                'dpkg-architecture', ['dpkg', '--print-architecture']).decode().strip()
            if self.report['dpkg_architecture'] != 'amd64':
                raise RuntimeError('unexpected actual dpkg architecture')
            prior = None
            for i, name in enumerate(ORDER):
                prior = self.arm(i, name, prior)
            self.report['status'] = 'AB/BA exact archives verified; diagnostic only'
        except Exception as error:
            self.report['error'] = str(error)
        finally:
            self.report['private_state_cleanup'] = [
                {'path': str(p), 'removed': not p.exists()} for p in self.private_roots]
            if any(p.exists() for p in self.private_roots):
                self.report['status'] = 'failed'
                self.report['cleanup_error'] = 'owned private APT state remains'
            self.report['ended_at'] = archive.now()
            self.report['elapsed_seconds'] = time.monotonic()-self.started
            (self.output/'report.json').write_text(json.dumps(self.report, indent=2)+'\n')
        return 0 if self.report['status']=='AB/BA exact archives verified; diagnostic only' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.source):
        parser.error('requires immutable checkout source')
    args.temp_root = os.environ.get('RUNNER_TEMP', '')
    if not args.temp_root or not Path(args.temp_root).is_absolute():
        parser.error('requires existing absolute RUNNER_TEMP')
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, interrupted)
    return NativeProbe(args).run()


if __name__ == '__main__':
    raise SystemExit(main())
