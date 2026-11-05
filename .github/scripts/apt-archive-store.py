#!/usr/bin/env python3
"""Immutable archive bytes only: fresh signed APT plans remain the authority."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time

MAX_FILE = 64 * 1024**2
MAX_TOTAL = 192 * 1024**2
MAX_JSON = 128 * 1024
FIELDS = ('Package', 'Version', 'Architecture', 'Filename', 'Size', 'SHA256')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate manifest field')
        result[key] = value
    return result


def regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    value = os.fstat(fd)
    if not stat.S_ISREG(value.st_mode) or value.st_nlink != 1 or value.st_size > MAX_FILE:
        os.close(fd)
        raise ValueError('archive must be bounded regular file with one link')
    return os.fdopen(fd, 'rb')


def validate_plan(plan):
    if set(plan) != {'schema', 'repository', 'platform', 'packages'} or plan['schema'] != 1:
        raise ValueError('wrong plan schema')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', plan['repository']):
        raise ValueError('wrong repository')
    if plan['platform'] != 'ubuntu26.04-amd64-amd64v3':
        raise ValueError('unsupported package platform')
    if not isinstance(plan['packages'], list) or not 1 <= len(plan['packages']) <= 256:
        raise ValueError('empty or oversized package closure')
    seen = set()
    total = 0
    for row in plan['packages']:
        if set(row) != set(FIELDS):
            raise ValueError('wrong package fields')
        if not re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', row['Package']) or row['Package'] in seen:
            raise ValueError('duplicate or unsafe package')
        seen.add(row['Package'])
        if not re.fullmatch(r'[A-Za-z0-9.+:~_-]+', row['Version']):
            raise ValueError('unsafe version')
        if row['Architecture'] not in ('amd64', 'all'):
            raise ValueError('wrong control architecture')
        if not re.fullmatch(r'pool/[A-Za-z0-9_./+:%~-]+\.deb', row['Filename']) or '..' in row['Filename']:
            raise ValueError('unsafe authenticated filename')
        if not row['Filename'].endswith(('_all.deb', '_amd64.deb', '_amd64v3.deb')):
            raise ValueError('unsupported archive variant')
        if not re.fullmatch(r'[0-9a-f]{64}', row['SHA256']):
            raise ValueError('invalid authenticated digest')
        size = int(row['Size'])
        if not 0 < size <= MAX_FILE:
            raise ValueError('archive size bound')
        total += size
    if total > MAX_TOTAL:
        raise ValueError('package closure exceeds bounded experiment')


def key(plan):
    validate_plan(plan)
    # No quality verdict/source identity enters package byte compatibility.
    return hashlib.sha256(canonical(plan)).hexdigest()


def control(source):
    """Read only the control record; never extract or execute maintainer scripts."""
    source.seek(0)
    if source.read(8) != b'!<arch>\n':
        raise ValueError('not a Debian ar archive')
    for _ in range(16):
        header = source.read(60)
        if len(header) != 60 or header[58:] != b'`\n':
            raise ValueError('missing Debian control archive')
        size = int(header[48:58])
        if not 0 <= size <= MAX_FILE:
            raise ValueError('ar member bound')
        name = header[:16].decode().strip().rstrip('/')
        if name.startswith('control.tar'):
            if size > 4*1024**2:
                raise ValueError('control archive bound')
            data = source.read(size)
            try:
                with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
                    for index, member in enumerate(archive):
                        if index > 128:
                            raise ValueError('control member bound')
                        if member.name.removeprefix('./') == 'control':
                            if not member.isfile() or member.size > 65536:
                                raise ValueError('unsafe Debian control record')
                            text = archive.extractfile(member).read(65537).decode()
                            result = {}
                            for line in text.splitlines():
                                if line and not line[0].isspace() and ': ' in line:
                                    field, value = line.split(': ', 1)
                                    if field in result:
                                        raise ValueError('duplicate control field')
                                    result[field] = value
                            return {field: result[field] for field in ('Package','Version','Architecture')}
            except tarfile.ReadError:
                # Ubuntu uses zstd controls. Older Python on Linux can use the
                # already-installed dpkg tool on the same held descriptor.
                tool = shutil.which('dpkg-deb')
                if tool is None:
                    raise ValueError('control compression unsupported; no tool installed')
                result = subprocess.run([tool, '-f', f'/dev/fd/{source.fileno()}',
                    'Package', 'Version', 'Architecture'], pass_fds=(source.fileno(),),
                    capture_output=True, timeout=15)
                if result.returncode or len(result.stdout)>65536:
                    raise ValueError('dpkg control verification failed')
                return dict(line.split(': ',1) for line in result.stdout.decode().splitlines())
            raise ValueError('missing control record')
        source.seek(size+(size%2), 1)
    raise ValueError('too many ar members')


def verify(source, row):
    source.seek(0)
    sha = hashlib.sha256()
    size = 0
    while data := source.read(1024*1024):
        size += len(data)
        if size > MAX_FILE:
            raise ValueError('archive grew beyond bound')
        sha.update(data)
    if size != int(row['Size']) or sha.hexdigest() != row['SHA256']:
        raise ValueError('archive hash/size mismatch')
    if control(source) != {k:row[k] for k in ('Package','Version','Architecture')}:
        raise ValueError('archive control identity mismatch')


def offer_name(row):
    variant = row['Filename'].rsplit('_',1)[1]
    return f"{row['Package']}_{row['Version'].replace(':','%3a')}_{variant}"


def copy_verified(source_path, destination, row):
    with regular(source_path) as source:
        verify(source, row)
        source.seek(0)
        with destination.open('xb') as out:
            shutil.copyfileobj(source, out, 1024*1024)
    # Revalidate the exact copied bytes before publishing the completed root.
    with regular(destination) as copied:
        verify(copied, row)


def publish(output, callback):
    if os.path.lexists(output):
        raise ValueError('output must be a fresh leaf')
    with tempfile.TemporaryDirectory(prefix='.apt-stage-', dir=output.parent) as temp:
        staging = Path(temp)/'complete'
        staging.mkdir(mode=0o700)
        callback(staging)
        os.rename(staging, output)


def export(plan, inputs, output, producer):
    started = time.monotonic()
    identity = key(plan)
    if set(inputs) != {x['Package'] for x in plan['packages']}:
        raise ValueError('download inventory differs from signed plan')
    def write(staging):
        for row in plan['packages']:
            copy_verified(inputs[row['Package']], staging/(row['SHA256']+'.deb'), row)
        manifest = {'schema':1, 'key':identity, 'plan':plan, 'producer':producer}
        raw = canonical(manifest)
        if len(raw)>MAX_JSON:
            raise ValueError('manifest bound')
        (staging/'manifest.json').write_bytes(raw)
    publish(output, write)
    return {'mode':'export', 'key':identity, 'seconds':time.monotonic()-started,
            'copied_bytes':sum(int(x['Size']) for x in plan['packages'])}


def restore(plan, snapshot, output, *, cold=False):
    started = time.monotonic()
    identity = key(plan)
    if cold:
        return {'mode':'controlled-cold', 'key':identity, 'seconds':time.monotonic()-started, 'copied_bytes':0}
    if not os.path.lexists(snapshot):
        return {'mode':'miss', 'key':identity, 'seconds':time.monotonic()-started, 'copied_bytes':0}
    if snapshot.is_symlink() or not snapshot.is_dir():
        raise ValueError('snapshot root must be regular directory')
    with regular(snapshot/'manifest.json') as source:
        raw = source.read(MAX_JSON+1)
    if len(raw)>MAX_JSON:
        raise ValueError('manifest bound')
    manifest = json.loads(raw, object_pairs_hook=unique)
    if set(manifest) != {'schema','key','plan','producer'} or manifest['schema']!=1:
        raise ValueError('wrong snapshot schema')
    if manifest['key'] != identity or manifest['plan'] != plan:
        raise ValueError('stale/foreign/platform package plan mismatch')
    expected = {x['SHA256']+'.deb' for x in plan['packages']}|{'manifest.json'}
    if {p.name for p in snapshot.iterdir()} != expected:
        raise ValueError('partial or extra snapshot inventory')
    def write(staging):
        for row in plan['packages']:
            copy_verified(snapshot/(row['SHA256']+'.deb'), staging/offer_name(row), row)
    publish(output, write)
    return {'mode':'verified-hit', 'key':identity, 'seconds':time.monotonic()-started,
            'copied_bytes':sum(int(x['Size']) for x in plan['packages'])}
