#!/usr/bin/env python3
"""Private four-case/R launcher: original clocks and ordinary exact artifact custody."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import signal
import stat
import sys
import time
import urllib.request

spec = importlib.util.spec_from_file_location('four_startup', Path(__file__).with_name('four-startup.py'))
case = importlib.util.module_from_spec(spec)
spec.loader.exec_module(case)
REPOSITORY = 'arcee-ai/nac'
ARTIFACT = json.loads(Path(__file__).with_name('artifact.json').read_bytes())
CAPS = {'rust': 3, 'node': 2, 'checkout-H': 2, 'checkout-P': 2, 'checkout-Q': 2, 'checkout-R': 2,
        'metadata': 2, 'download': 2, 'prepare': 2}


def inputs(*, configured_refusal=False):
    value = json.loads(os.environ['ROOT_STARTUP_ADMISSION'])
    case.admit(value, os.environ['GITHUB_SHA'], configured_refusal=configured_refusal)
    case.require(os.environ.get('GITHUB_REF') == (case.REFUSAL_BRANCH if configured_refusal else case.BRANCH)
        and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
        and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
        and os.environ.get('GITHUB_REPOSITORY') == REPOSITORY, 'exact private first manual job')
    return value


def minutes(value, phase, *, now=None, configured_refusal=False):
    stamp = time.time() if now is None else now
    case.admit(value, value['controller_sha'], now=stamp, configured_refusal=configured_refusal)
    case.require(not configured_refusal or phase != 'checkout-R', 'no R checkout in diagnostic role')
    if phase == 'episode':
        # Bound the episode plus its ORIGINAL cleanup; leave retention for upload.
        deadline, cap = value['clock']['CLEANUP_DEADLINE'], 58
    else:
        case.require(phase in CAPS, 'fixed launcher phase')
        deadline, cap = value['clock']['WORK_DEADLINE'], CAPS[phase]
    result = min(cap, math.floor((deadline - stamp - 60) / 60))
    case.require(result >= 1, 'original phase allowance exhausted')
    return result


def retention_minutes(value, *, now=None):
    stamp = time.time() if now is None else now
    clock = value['clock']
    start, hard = clock['STARTED'], clock['HARD_DEADLINE']
    case.require(all(type(x) in (int, float) and math.isfinite(x) for x in (start, hard))
        and start <= stamp < hard and 0 < hard - start <= 3600, 'original retention clock')
    return max(0, min(2, math.floor((hard - stamp - 15) / 60)))


def artifact_identity(value, run, artifact):
    p = value['producer']
    case.require(run.get('id') == p['run_id'] and run.get('head_sha') == p['controller_sha']
        and run.get('head_branch') == p['branch'] and run.get('event') == 'workflow_dispatch'
        and run.get('run_attempt') == 1 and run.get('status') == 'completed'
        and run.get('conclusion') == 'success'
        and run.get('repository', {}).get('full_name') == REPOSITORY
        and run.get('head_repository', {}).get('full_name') == REPOSITORY,
        'producer must be the exact successful same-repository first manual run')
    owner = artifact.get('workflow_run', {})
    case.require(artifact.get('id') == p['artifact_id'] and artifact.get('name') == p['artifact_name']
        and artifact.get('expired') is False and artifact.get('size_in_bytes') == ARTIFACT['outer_bytes']
        and artifact.get('digest') == 'sha256:' + ARTIFACT['outer_sha256']
        and owner.get('id') == p['run_id']
        and owner.get('head_sha') == p['controller_sha'] and owner.get('head_branch') == p['branch']
        and type(owner.get('repository_id')) is int and owner['repository_id'] > 0
        and owner.get('head_repository_id') == owner['repository_id'], 'exact producer artifact custody')
    return dict(run_id=p['run_id'], artifact_id=p['artifact_id'], artifact_name=p['artifact_name'],
                producer_sha=p['controller_sha'], branch=p['branch'], repository=REPOSITORY)


def handoff_files(root, value, product):
    case.require(root.is_absolute() and root.resolve() == root and root.is_dir(), 'canonical downloaded artifact root')
    # The exact original outer artifact includes independent normal/lifecycle
    # roles. Admit its closed bytes, then transfer ONLY the normal role.
    expected = ARTIFACT['files']
    files, directories = {}, set()
    for file in root.rglob('*'):
        case.require(not file.is_symlink() and file.resolve() == file, 'artifact no-follow canonical member')
        relative = file.relative_to(root).as_posix()
        if file.is_dir():
            directories.add(relative)
        else:
            files[relative] = file
    parents = {str(parent) for name in expected for parent in Path(name).parents if str(parent) != '.'}
    case.require(set(files) == set(expected) and directories == parents, 'closed original outer artifact layout')
    for name, file in files.items():
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            case.require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
                and info.st_size == expected[name]['bytes'], 'regular bounded single-link artifact member')
            observed = hashlib.file_digest(stream, 'sha256').hexdigest()
        case.require(observed == expected[name]['sha256'], 'exact original artifact member digest')
    manifest = files[ARTIFACT['normal_manifest']]
    receipt_file = manifest.parent / 'host-package.json'
    case.require(case.digest(manifest) == value['manifest_sha256'], 'Root-bound normal manifest bytes')
    body = json.loads(manifest.read_bytes())
    receipt = json.loads(receipt_file.read_bytes())
    case.require(product == ARTIFACT['P'] and receipt.get('scope') == ARTIFACT['producer_scope']
        and receipt.get('clock_failures') == [] and receipt.get('stop_signals') == []
        and receipt.get('status') == 'PASS' and receipt.get('runtime') is False
        and receipt.get('SDK_actor') is False and receipt.get('producer_attempts') == 1
        and receipt.get('retries') == 0 and receipt.get('pair', {}).get('P') == product
        and receipt.get('admission', {}).get('controller_sha') == value['producer']['controller_sha']
        and body.get('identity', {}).get('source', {}).get('revision') == product
        and body.get('identity', {}).get('purpose') == 'normal-app-preparation',
        'successful exact-current-product package-only receipt')
    name = body['container']['name']
    case.require(Path(name).name == name and name.endswith('.zip'), 'one original container name')
    archive = manifest.parent / name
    case.require(archive == files[ARTIFACT['normal_archive']], 'only the admitted normal archive role')
    case.require(archive.resolve() == archive and not archive.is_symlink() and archive.is_file()
        and type(body['container']['size']) is int and 0 < body['container']['size'] <= 512 * 1024**2
        and archive.stat().st_size == body['container']['size']
        and case.digest(archive) == body['container']['sha256'], 'exact original producer ZIP bytes/size')
    for file in (manifest, archive):
        recorded = receipt.get('handoff', {}).get(file.name, {})
        case.require(recorded.get('sha256') == case.digest(file)
            and recorded.get('bytes') == file.stat().st_size, 'producer handoff hash differs')
    return manifest, archive


def main(*, configured_refusal=False):
    phase = sys.argv[1]
    gate = Path(os.environ['RUNNER_TEMP']).resolve() / 'native342-startup-gate'
    value = json.loads(os.environ['ROOT_STARTUP_ADMISSION'])
    if phase == '--retention':
        try:
            n = retention_minutes(value)
        except (KeyError, TypeError, RuntimeError, ValueError):
            n = 0
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('minutes=' + str(n) + '\n')
        return
    value = inputs(configured_refusal=configured_refusal)
    pair = json.loads(Path(__file__).with_name('configured-refusal-pair.json' if configured_refusal else 'pair.json').read_text())
    case.require(os.environ.get('ImageVersion') == pair['host_image'], 'exact image before bootstrap/build')
    if phase == '--gate':
        name = sys.argv[2]
        n = minutes(value, name, configured_refusal=configured_refusal)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('minutes=' + str(n) + '\n')
            if name == 'checkout-H':
                for key in (('H', 'P', 'Q') if configured_refusal else ('H', 'P', 'Q', 'R')):
                    stream.write(key + '=' + pair[key] + '\n')
            if name == 'download':
                for key in ('run_id', 'artifact_id'):
                    stream.write(key + '=' + str(value['producer'][key]) + '\n')
        case.write(gate / ('clock-' + name + '.json'), dict(status='PASS', phase=name, minutes=n, clock=value['clock']))
        return
    if phase == '--metadata-child':
        def read(suffix):
            case.admit(value, os.environ['GITHUB_SHA'], configured_refusal=configured_refusal)
            remaining = value['clock']['WORK_DEADLINE'] - time.time() - 15
            case.require(remaining > 0, 'original metadata work cutoff')
            request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + suffix,
                headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json',
                         'X-GitHub-Api-Version': '2022-11-28'})
            with urllib.request.urlopen(request, timeout=min(30, remaining)) as response:
                data = response.read(1024 * 1024 + 1)
            case.require(len(data) <= 1024 * 1024, 'bounded artifact metadata')
            return json.loads(data)
        p = value['producer']
        identity = artifact_identity(value, read('/actions/runs/' + str(p['run_id'])),
                                     read('/actions/artifacts/' + str(p['artifact_id'])))
        case.write(gate / 'producer-identity.json', identity)
        return

    sys.path.insert(0, str(Path(os.environ['H_ROOT']) / 'desktop/macos'))
    import ci
    from ci_paths_budget import Bound, using
    clock = case.make_clock(case.admit(value, os.environ['GITHUB_SHA'], configured_refusal=configured_refusal), Bound)
    ci.RUN_DEADLINE = min(ci.RUN_DEADLINE, clock.work.deadline)
    def owned(name, argv, cap):
        log = gate / (name + '.log')
        with using(clock.work):
            ci.run(argv, log, cap, cwd=Path(os.environ['H_ROOT']), abort=lambda: bool(case.STOP))
            proof = json.loads(log.with_name(log.name + '.ownership.json').read_bytes())
            case.require(proof['accepted'] and proof['reaped'] and proof['drain_settled']
                and not proof['unknown'] and proof['teardown_error'] is None, 'positive launcher helper ownership')
    if phase == '--metadata':
        owned('producer-metadata', [sys.executable, '-B', str(Path(__file__).with_name('configured-refusal-launch.py').resolve() if configured_refusal else Path(__file__).resolve()), '--metadata-child'], 60)
        return
    case.require(phase == '--prepare', 'fixed launcher operation')
    with using(clock.work):
        identity = json.loads((gate / 'producer-identity.json').read_bytes())
        producer = value['producer']
        case.require(all(identity.get(key) == producer[key] for key in ('run_id', 'artifact_id', 'artifact_name'))
            and identity.get('producer_sha') == producer['controller_sha']
            and identity.get('repository') == REPOSITORY, 'download must follow the exact verified producer identity')
        manifest, archive = handoff_files(Path(os.environ['DOWNLOAD_ROOT']), value, pair['P'])
        package = Path(os.environ['PACKAGE_ROOT'])
        case.require(package.is_absolute() and package.resolve() == package and not package.exists(), 'absent canonical package root')
        package.mkdir(mode=0o700)
        for file in (manifest, archive):
            shutil.copyfile(file, package / file.name)
            case.require(case.digest(file) == case.digest(package / file.name), 'unaltered package transfer')
    owned('extract-original-package', ['/usr/bin/ditto', '-x', '-k', str(package / archive.name), str(package)], 90)
    with using(clock.work):
        # Actual P/Q inventory/post-sign/package admission remains in run_case.
        case.require((package / 'NAC.app').is_dir(), 'original normal app missing after extraction')
        case.write(gate / 'package-transfer.json', dict(status='PASS', P=pair['P'],
            manifest_sha256=case.digest(package / manifest.name), container_sha256=case.digest(package / archive.name),
            scope='unchanged artifact transfer only; package/runtime admission remains required'))


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: case.STOP.append(number))
    main()
