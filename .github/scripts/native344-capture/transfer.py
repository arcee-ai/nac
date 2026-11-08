"""Original reviewed f902 producer/closed-tree/lifecycle transfer owners; no actor."""
import hashlib
import json
import os
from pathlib import Path
import stat
from lifecycle_capture.admission import P,MANIFEST
from lifecycle_capture.protocol import require
ARTIFACT=json.loads(Path(__file__).with_name('artifact.json').read_bytes())
REPOSITORY='arcee-ai/nac'
ROLE='canonical-lifecycle-fixture-v1'


def digest(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def artifact_identity(value, run, artifact):
    p = value['producer']
    require(run.get('id') == p['run_id'] and run.get('head_sha') == p['controller_sha']
        and run.get('head_branch') == p['branch'] and run.get('event') == 'workflow_dispatch'
        and run.get('run_attempt') == 1 and run.get('status') == 'completed'
        and run.get('conclusion') == 'success'
        and run.get('repository', {}).get('full_name') == REPOSITORY
        and run.get('head_repository', {}).get('full_name') == REPOSITORY,
        'producer must be the exact successful same-repository first manual run')
    owner = artifact.get('workflow_run', {})
    require(artifact.get('id') == p['artifact_id'] and artifact.get('name') == p['artifact_name']
        and artifact.get('expired') is False and artifact.get('size_in_bytes') == ARTIFACT['outer_bytes']
        and artifact.get('digest') == 'sha256:' + ARTIFACT['outer_sha256']
        and owner.get('id') == p['run_id']
        and owner.get('head_sha') == p['controller_sha'] and owner.get('head_branch') == p['branch']
        and type(owner.get('repository_id')) is int and owner['repository_id'] > 0
        and owner.get('head_repository_id') == owner['repository_id'], 'exact producer artifact custody')
    return dict(run_id=p['run_id'], artifact_id=p['artifact_id'], artifact_name=p['artifact_name'],
                producer_sha=p['controller_sha'], branch=p['branch'], repository=REPOSITORY)



def outer_files(root):
    require(root.is_absolute() and root.resolve() == root and root.is_dir(), 'canonical downloaded artifact root')
    # Exact closed original outer bytes; role selection is a separate check.
    expected = ARTIFACT['files']
    files, directories = {}, set()
    for file in root.rglob('*'):
        require(not file.is_symlink() and file.resolve() == file, 'artifact no-follow canonical member')
        relative = file.relative_to(root).as_posix()
        if file.is_dir():
            directories.add(relative)
        else:
            files[relative] = file
    parents = {str(parent) for name in expected for parent in Path(name).parents if str(parent) != '.'}
    require(set(files) == set(expected) and directories == parents, 'closed original outer artifact layout')
    for name, file in files.items():
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
                and info.st_size == expected[name]['bytes'], 'regular bounded single-link artifact member')
            observed = hashlib.file_digest(stream, 'sha256').hexdigest()
        require(observed == expected[name]['sha256'], 'exact original artifact member digest')
    return files



def handoff(root, value):
    files = outer_files(root)
    manifest = files['ff8-host-package-output/handoff/lifecycle/manifest.json']
    archive = files['ff8-host-package-output/handoff/lifecycle/NAC-lifecycle-fixture-arm64.zip']
    body = json.loads(manifest.read_bytes())
    receipt = json.loads(files['ff8-host-package-output/handoff/host-package.json'].read_bytes())
    require(digest(manifest) == MANIFEST == value['manifest_sha256']
        and body.get('role') == ROLE and body.get('source', {}).get('revision') == P
        and body.get('observer', {}).get('source_revision') == P
        and body.get('observer', {}).get('role') == 'canonical-lifecycle-observer', 'genuine distinct lifecycle role')
    require(receipt.get('status') == 'PASS' and receipt.get('scope') == ARTIFACT['producer_scope']
        and receipt.get('clock_failures') == [] and receipt.get('stop_signals') == []
        and receipt.get('runtime') is False and receipt.get('SDK_actor') is False
        and receipt.get('producer_attempts') == 1 and receipt.get('retries') == 0
        and receipt.get('pair', {}).get('P') == P
        and receipt.get('admission', {}).get('controller_sha') == ARTIFACT['producer_sha'],
        'successful original package-only producer')
    for name, path in [('lifecycle/manifest.json', manifest), ('lifecycle/' + archive.name, archive)]:
        row = receipt.get('handoff', {}).get(name, {})
        require(row.get('sha256') == digest(path) and row.get('bytes') == path.stat().st_size,
                'exact lifecycle producer handoff')
    require(body['container']['name'] == archive.name and body['container']['size'] == archive.stat().st_size
        and body['container']['sha256'] == digest(archive), 'original lifecycle archive')
    return manifest, archive, body
