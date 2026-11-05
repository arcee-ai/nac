#!/usr/bin/env python3
"""Private, read-only-to-host paired APT archive probe; never a CI verdict.

Requires an already available Docker Engine and immutable Ubuntu 26.04.1 amd64
image. Downloads only the nine exact archives observed in run42078117303.
Normal APT authentication/date checks stay enabled. No package is installed.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid

PACKAGES = {
    'fonts-ipafont-gothic': '00303-23ubuntu1',
    'fonts-freefont-ttf': '20211204+svn4273-4build1',
    'fonts-tlwg-loma-otf': '1:0.7.3-1build1',
    'fonts-unifont': '1:16.0.04-1build1',
    'fonts-wqy-zenhei': '0.9.45-8build1',
    'xfonts-encodings': '1:1.0.5-0ubuntu3',
    'xfonts-utils': '1:7.7+7build1',
    'xfonts-cyrillic': '1:1.0.5+nmu1build1',
    'xfonts-scalable': '1:1.0.3-1.3build1',
}
ROUTES = [('azure', 'http://azure.archive.ubuntu.com/ubuntu'),
          ('official', 'http://archive.ubuntu.com/ubuntu')]
KEYRING = '/usr/share/keyrings/ubuntu-archive-keyring.gpg'
APT = ['apt-get', '-o', 'Acquire::Check-Valid-Until=true', '-o',
       'Acquire::Check-Date=true', '-o', 'Acquire::AllowInsecureRepositories=false',
       '-o', 'Acquire::AllowDowngradeToInsecureRepositories=false']


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fields(text):
    result = {}
    for line in text.splitlines():
        if not line or line.startswith(' '):
            continue
        key, sep, value = line.partition(': ')
        if sep:
            if key in result:
                raise ValueError('duplicate package metadata field')
            result[key] = value
    return result


def metadata(text, package):
    records = [fields(part) for part in text.strip().split('\n\n')]
    matches = [r for r in records if r.get('Package') == package
               and r.get('Version') == PACKAGES[package]]
    if len(matches) != 1:
        raise ValueError(f'exact package unavailable or ambiguous: {package}')
    row = matches[0]
    expected_arch = 'amd64' if package == 'xfonts-utils' else 'all'
    if row['Architecture'] != expected_arch:
        raise ValueError('historical architecture changed')
    # Resolute's amd64v3 index carries an amd64 control-architecture archive.
    # The hosted unpack log identifies its filename variant explicitly.
    if package == 'xfonts-utils' and not row['Filename'].endswith('_amd64v3.deb'):
        raise ValueError('historical xfonts-utils filename variant changed')
    if not re.fullmatch(r'[0-9a-f]{64}', row['SHA256']):
        raise ValueError('missing authenticated archive hash')
    if not 0 < int(row['Size']) <= 32 * 1024 * 1024:
        raise ValueError('archive size outside bound')
    if not re.fullmatch(r'pool/[A-Za-z0-9_./+:%~-]+\.deb', row['Filename']) or '..' in row['Filename']:
        raise ValueError('unsafe archive filename')
    return {k: row[k] for k in ('Package', 'Version', 'Architecture', 'Size', 'SHA256', 'Filename')}


def verify(data, pin, actual):
    if len(data) != int(pin['Size']) or digest(data) != pin['SHA256']:
        raise ValueError('archive content mismatch')
    if actual != {k: pin[k] for k in ('Package', 'Version', 'Architecture')}:
        raise ValueError('archive control metadata mismatch')


class Probe:
    def __init__(self, args):
        self.args = args
        self.output = args.output.resolve()
        self.output.mkdir(mode=0o700)
        self.requests = []
        self.container = None
        self.started = time.monotonic()
        self.report = {'started_at': now(), 'image': args.image, 'source': args.source,
                       'script_sha256': digest(Path(__file__).read_bytes()), 'arms': [],
                       'limits': {'cpus': 2, 'memory': '768m', 'pids': 128,
                                  'added_owned_bytes': 1073741824, 'host_free_stop': 13958643712},
                       'historical_hash_limit': 'Historical log has no authenticated archive hashes; '
                           'new signed-index hashes are prospective pair pins, not historical byte attestation.',
                       'coverage': 'Transport only; no package install, production journey or hosted acceptance.',
                       'status': 'failed'}

    def guard(self):
        if shutil.disk_usage(self.output).free < 13 * 1024**3:
            raise RuntimeError('host reserve reached')
        if time.monotonic() - self.started > 1800:
            raise RuntimeError('whole-probe time bound reached')
        if sum(p.stat().st_size for p in self.output.rglob('*') if p.is_file()) > 1024**3:
            raise RuntimeError('owned output bound reached')

    def command(self, label, argv, *, input_data=None, expected=0, timeout=900):
        self.guard()
        started = now()
        tick = time.monotonic()
        result = subprocess.run(argv, input=input_data, capture_output=True, timeout=timeout)
        if len(result.stdout) + len(result.stderr) > 64 * 1024 * 1024:
            raise RuntimeError('command output bound reached')
        (self.output / (label + '.stdout')).write_bytes(result.stdout)
        (self.output / (label + '.stderr')).write_bytes(result.stderr)
        self.requests.append({'label': label, 'argv': argv, 'started_at': started,
                              'ended_at': now(), 'seconds': time.monotonic()-tick,
                              'exit': result.returncode})
        (self.output/'commands.json').write_text(json.dumps(self.requests, indent=2)+'\n')
        if result.returncode != expected:
            raise RuntimeError(f'{label}: exit{result.returncode}; retained, no automatic retry')
        return result.stdout

    def execute(self, label, argv, **kwargs):
        return self.command(label, ['docker', 'exec', '-i', self.container, *argv], **kwargs)

    def cleanup(self):
        if self.container:
            value = subprocess.run(['docker', 'rm', '-f', self.container], capture_output=True, timeout=30)
            (self.output/(self.container+'-cleanup.stdout')).write_bytes(value.stdout)
            (self.output/(self.container+'-cleanup.stderr')).write_bytes(value.stderr)
            if value.returncode:
                raise RuntimeError('owned container cleanup failed')
            self.container = None

    def container_bound(self, name):
        raw = self.command(name+'-writable-bytes', ['docker', 'container', 'inspect', '--size',
            '--format', '{{.SizeRw}}', self.container], timeout=30)
        if int(raw) > 768 * 1024**2:
            raise RuntimeError('owned container writable bound reached')

    def arm(self, name, route, prior):
        self.container = 'nac-apt-' + uuid.uuid4().hex[:12]
        self.command(name+'-start', ['docker', 'run', '-d', '--rm', '--name', self.container,
            '--platform', 'linux/amd64', '--cpus', '2', '--memory', '768m', '--memory-swap', '768m',
            '--pids-limit', '128', self.args.image, 'sleep', '1800'], timeout=30)
        os_release = self.execute(name+'-os', ['cat', '/etc/os-release']).decode()
        arch = self.execute(name+'-arch', ['dpkg', '--print-architecture']).decode().strip()
        if 'VERSION="26.04.1 LTS' not in os_release or arch != 'amd64':
            raise RuntimeError('pinned release/architecture unavailable')
        self.execute(name+'-mkdir', ['mkdir', '-p', '/probe/downloads'])
        self.execute(name+'-remove-default-source', ['rm', '-f', '/etc/apt/sources.list.d/ubuntu.sources'])
        self.execute(name+'-apt-architecture', ['tee', '/etc/apt/apt.conf.d/99-all582-architecture'],
                     input_data=b'APT::Architecture "amd64v3";\nAPT::Architectures { "amd64v3"; };\n')
        source = f'deb [arch=amd64v3 signed-by={KEYRING}] {route} resolute main universe\n'
        self.execute(name+'-sources', ['tee', '/etc/apt/sources.list'], input_data=source.encode())
        # Fresh container lists/cache only. No host or other owner's APT state.
        self.execute(name+'-apt-update', [*APT, 'update', '--error-on=any'])
        self.container_bound(name+'-after-index')
        release_files = self.execute(name+'-release-paths', ['find', '/var/lib/apt/lists',
            '-maxdepth', '1', '-type', 'f', '-name', '*_InRelease']).decode().splitlines()
        if len(release_files) != 1:
            raise RuntimeError('expected one authenticated resolute base release')
        release_path = release_files[0]
        release = self.execute(name+'-release', ['cat', release_path])
        self.execute(name+'-signature-positive', ['gpgv', '--keyring', KEYRING, release_path])
        if prior and digest(release) != prior['release_sha256']:
            raise RuntimeError('mirror release source differs; stop rather than compare')
        pin_rows = []
        for index, package in enumerate(PACKAGES):
            raw = self.execute(f'{name}-metadata-{index}', ['apt-cache', 'show',
                               package+'='+PACKAGES[package]]).decode()
            pin_rows.append(metadata(raw, package))
        if prior and pin_rows != prior['packages']:
            raise RuntimeError('mirror package identity/content differs')
        arm = {'name': name, 'route': route, 'release_sha256': digest(release),
               'packages': pin_rows, 'timing_seconds': None,
               'release_date_fields': {k:v for k,v in fields(release.decode()).items()
                                       if k in ('Date','Valid-Until','Suite','Codename')},
               'freshness': 'Fresh lists; apt-get update --error-on=any with Check-Date '
                   'and Check-Valid-Until enabled. Immutable base Release may omit Valid-Until; '
                   'no arbitrary maximum-age claim or disabled expiry check.'}
        self.report['arms'].append(arm)
        # Measure only archive transfer. Index/signature/setup durations remain separate.
        tick = time.monotonic()
        self.execute(name+'-download', ['sh', '-c', 'cd /probe/downloads && exec "$@"', 'probe',
                                      *APT, 'download', *[k+'='+v for k,v in PACKAGES.items()]])
        arm['timing_seconds'] = time.monotonic()-tick
        self.container_bound(name+'-after-download')
        files = self.execute(name+'-archives', ['find', '/probe/downloads', '-maxdepth', '1',
                                               '-type', 'f', '-name', '*.deb']).decode().splitlines()
        if len(files) != len(PACKAGES):
            raise RuntimeError('archive inventory mismatch')
        first = None
        seen = set()
        for index, path in enumerate(sorted(files)):
            if not re.fullmatch(r'/probe/downloads/[A-Za-z0-9_.+:%~-]+\.deb', path):
                raise RuntimeError('unsafe downloaded archive path')
            actual = fields(self.execute(f'{name}-control-{index}',
                ['dpkg-deb', '-f', path, 'Package', 'Version', 'Architecture']).decode())
            pin = next((p for p in pin_rows if p['Package']==actual.get('Package')), None)
            if pin is None or pin['Package'] in seen:
                raise RuntimeError('unexpected or duplicate archive package')
            seen.add(pin['Package'])
            data = self.execute(f'{name}-bytes-{index}', ['cat', path])
            verify(data, pin, actual)
            first = first or (data, pin, actual)
        if not prior:
            self.controls(name, release, first)
        self.cleanup()
        return arm

    def controls(self, name, release, first):
        data, pin, actual = first
        try:
            verify(data, {**pin, 'SHA256': '0'*64}, actual)
        except ValueError:
            self.report['wrong_hash_rejected'] = True
        else:
            raise RuntimeError('hash mismatch accepted')
        tampered = release.replace(b'Suite: resolute', b'Suite: invalid-control', 1)
        if tampered == release:
            raise RuntimeError('cannot form signature negative')
        self.execute(name+'-tamper-copy', ['tee', '/probe/tampered-InRelease'], input_data=tampered)
        self.execute(name+'-signature-negative', ['gpgv', '--keyring', KEYRING,
                                                '/probe/tampered-InRelease'], expected=1)
        if b'BAD signature' not in (self.output/(name+'-signature-negative.stderr')).read_bytes():
            raise RuntimeError('signature negative did not reach cryptographic mismatch')
        self.execute(name+'-missing-package', [*APT, 'download',
            'all582-definitely-missing-font-control'], expected=100)
        if b'Unable to locate package all582-definitely-missing-font-control' not in (
                self.output/(name+'-missing-package.stderr')).read_bytes():
            raise RuntimeError('missing-package control failed for another reason')
        self.report['signature_negative_exit'] = 1
        self.report['missing_package_exit'] = 100

    def run(self):
        try:
            inspect = json.loads(self.command('image-inspect', ['docker', 'image', 'inspect', self.args.image]))
            if len(inspect)!=1 or inspect[0]['Architecture']!='amd64':
                raise RuntimeError('image platform mismatch')
            self.report['image_id'] = inspect[0]['Id']
            previous = None
            for name, route in ROUTES:
                previous = self.arm(name, route, previous)
            self.report['status'] = 'paired archives verified; local mechanism only'
        except Exception as error:
            self.report['error'] = str(error)
        finally:
            try:
                self.cleanup()
            except Exception as error:
                self.report['cleanup_error'] = str(error)
                self.report['status'] = 'failed'
            self.report['ended_at'] = now()
            self.report['elapsed_seconds'] = time.monotonic()-self.started
            (self.output/'report.json').write_text(json.dumps(self.report, indent=2)+'\n')
        return 0 if self.report['status']=='paired archives verified; local mechanism only' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'docker.io/library/ubuntu@sha256:[0-9a-f]{64}', args.image):
        parser.error('requires immutable official Ubuntu digest')
    if not re.fullmatch(r'[0-9a-f]{40}', args.source):
        parser.error('requires exact immutable source revision')
    return Probe(args).run()


if __name__ == '__main__':
    raise SystemExit(main())
