"""Validate only the fresh owned evidence tree before hidden-file retention."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat

from contract import require, write_json

TOP = {'ownership.json', 'dispatch.json', 'setup.stdout', 'setup.stderr', 'setup-terminal.json',
       'chromium.stdout', 'chromium.stderr', 'chromium-terminal.json', 'custody', 'run',
       'run-build', 'heartbeat-evidence.lock'}
MANIFESTS = {'run/artifact-manifest.json', 'custody/wrapper/artifact-manifest.json'}


def identity(root, control, run_id, attempt):
    require(re.fullmatch('[0-9a-f]{40}', control) and str(run_id).isdigit()
            and int(run_id) > 0 and str(attempt).isdigit() and int(attempt) > 0, 'UPLOAD_IDENTITY')
    return {'root': str(root), 'uid': os.getuid(), 'control': control,
            'run_id': str(run_id), 'attempt': str(attempt)}


def initialize_output(root, control):
    root = Path(root)
    require(root.is_absolute() and root.name == 'heartbeat-evidence'
            and root.parent.resolve() == root.parent, 'UPLOAD_ROOT_PATH')
    marker = identity(root, control, os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'])
    root.mkdir(mode=0o700)  # Exclusive creation before any product/setup operation.
    write_json(root/'ownership.json', marker)


def checked_stat(value, directory=False):
    require(value.st_uid == os.getuid(), 'UPLOAD_FOREIGN_OWNER')
    if directory:
        require(stat.S_ISDIR(value.st_mode), 'UPLOAD_DIRECTORY')
    else:
        require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1, 'UPLOAD_REGULAR_SINGLE_LINK')


def allowed_path(relative):
    require(re.fullmatch(r'[A-Za-z0-9_./-]+', relative), 'UPLOAD_PATH')
    parts = PurePosixPath(relative).parts
    require(parts[0] in TOP, 'UPLOAD_UNEXPECTED_ROOT_ENTRY')
    for index, part in enumerate(parts):
        require(not re.search(r'credential|secret|token|id_rsa|id_ed25519', part, re.I),
                'UPLOAD_SENSITIVE_PATH')
        if part.startswith('.'):
            require('/'.join(parts[:index+1]) == 'run/home/.cache', 'UPLOAD_UNEXPECTED_HIDDEN_PATH')
    if relative.startswith('run/home/.cache/'):
        require(parts[3] == 'fontconfig', 'UPLOAD_UNEXPECTED_CACHE')


def read_file(parent, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        before = os.fstat(fd)
        checked_stat(before)
        value = hashlib.sha256()
        small = bytearray() if before.st_size <= 2*1024*1024 else None
        while block := os.read(fd, 1024*1024):
            value.update(block)
            if small is not None:
                small.extend(block)
        after = os.fstat(fd)
        require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'UPLOAD_FILE_CHANGED')
        return {'bytes': before.st_size, 'sha256': value.hexdigest()}, small
    finally:
        os.close(fd)


def validate_upload(root, control, run_id, attempt):
    root = Path(root)
    expected = identity(root, control, run_id, attempt)
    require(root.is_absolute() and root.name == 'heartbeat-evidence'
            and root.parent.resolve() == root.parent and os.getuid() > 0, 'UPLOAD_ROOT_PATH')
    files, documents = {}, {}

    def walk(fd, prefix=''):
        before = os.fstat(fd)
        checked_stat(before, directory=True)
        for name in sorted(os.listdir(fd)):
            relative = prefix+name
            allowed_path(relative)
            require(name != 'lifeline.sock', 'UPLOAD_UNRETIRED_ENDPOINT')
            if name == 'artifact-manifest.json':
                require(relative in MANIFESTS, 'UPLOAD_UNEXPECTED_PRODUCER_MANIFEST')
            value = os.stat(name, dir_fd=fd, follow_symlinks=False)
            require(not stat.S_ISLNK(value.st_mode), 'UPLOAD_SYMLINK')
            if relative == 'run-build':
                checked_stat(value, directory=True)
                continue  # Explicitly excluded compiler cache, never a producer-manifest root.
            if stat.S_ISDIR(value.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    walk(child, relative+'/')
                finally:
                    os.close(child)
            else:
                checked_stat(value)  # Reject special entries before attempting an open.
                record, small = read_file(fd, name)
                files[relative] = record
                if relative == 'ownership.json' or relative in MANIFESTS:
                    require(small is not None, 'UPLOAD_DOCUMENT_BOUND')
                    documents[relative] = json.loads(small)
        after = os.fstat(fd)
        require((before.st_ino, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_ino, after.st_mtime_ns, after.st_ctime_ns), 'UPLOAD_DIRECTORY_CHANGED')

    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        value = os.fstat(fd)
        checked_stat(value, directory=True)
        require(stat.S_IMODE(value.st_mode) == 0o700, 'UPLOAD_ROOT_MODE')
        _, marker = read_file(fd, 'ownership.json')
        require(marker is not None and json.loads(marker) == expected, 'UPLOAD_OWNERSHIP_BINDING')
        walk(fd)
    finally:
        os.close(fd)
    require(documents.get('ownership.json') == expected, 'UPLOAD_OWNERSHIP_BINDING')
    manifests = []
    for name in sorted(MANIFESTS & documents.keys()):
        entries, seen = documents[name]['files'], set()
        for entry in entries:
            path = PurePosixPath(entry['file'])
            require(not path.is_absolute() and '..' not in path.parts and str(path) == entry['file']
                    and entry['file'] not in seen, 'UPLOAD_MANIFEST_PATH')
            seen.add(entry['file'])
            target = str(PurePosixPath(name).parent/path)
            require(files.get(target) == {'bytes': entry['bytes'], 'sha256': entry['sha256']},
                    'UPLOAD_MANIFEST_ORIGINAL_MISSING_OR_CHANGED')
        manifests.append({'file': name, 'entries': len(entries)})
    return {'state': 'VALIDATED_OWNED_UPLOAD_TREE', 'identity': expected, 'files': files,
            'producer_manifests': manifests, 'excluded': ['run-build/**'],
            'limits': 'Path/ownership/manifest validation only; never runtime or visual acceptance'}


if __name__ == '__main__':
    root = Path(os.environ['RUNNER_TEMP'])/'heartbeat-evidence'
    result = validate_upload(root, os.environ['EXPECTED_CONTROL'], os.environ['GITHUB_RUN_ID'],
                             os.environ['GITHUB_RUN_ATTEMPT'])
    # Only this guard adds this receipt after validating every producer original.
    write_json(root/'upload-validation.json', result)
    print(json.dumps({'state': result['state'], 'files': len(result['files']),
                      'producer_manifests': result['producer_manifests'], 'excluded': result['excluded']}))
