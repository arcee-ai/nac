"""Isolated canonical-output producer. Success is not a CI/Ready receipt."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import secrets
import stat
import subprocess
import tempfile
import time

SOURCE = '9e9dd5f357c920f827dd7c9d5e4470fe9f4a7ad6'
TREE = '5160d72b076cc9fa99ed4da953ff107c0ff3935d'
REF = 'refs/heads/codex/all350-canonical-generation-control-01'
CONTROL_PATHS = {'.github/workflows/stable-release.yml',
                 '.github/scripts/canonical-generation.py',
                 '.github/scripts/canonical-generation.test.py'}
FILES = ('crates/nac-core/src/guide/pack.json',
         'crates/nac-server/web/openapi.json',
         'crates/nac-server/web/src/app/types/openapi.generated.ts',
         'crates/nac-server/web/packages/nac-client/src/openapi.generated.ts',
         'crates/nac-server/web/packages/nac-client/src/surface.generated.ts')
DIRS = ('crates/nac-server/assets/dist',
        'crates/nac-server/web/packages/nac-client/dist',
        'crates/nac-server/web/packages/nac-presentation/dist')
GIB = 1024 ** 3
WEB = 'crates/nac-server/web'
GEN = [('make', 'generate-nac-guide'), ('make', 'test-nac-guide'),
       ('make', 'generate-api-contract'),
       ('npm', '--prefix', WEB, 'run', 'lint'),
       ('npm', '--prefix', WEB, 'run', 'typecheck'),
       ('npm', '--prefix', WEB, 'run', 'build'),
       ('npm', '--prefix', WEB, 'run', 'test:client-package'),
       ('make', 'test-api-contract'), ('make', 'test-nac-guide'),
       ('make', 'format-check'), ('make', 'test-source-size')]


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def git(root, *args, env=None):
    return subprocess.check_output(['git', '-C', str(root), *args], env=env)


def allowed(path):
    p = PurePosixPath(path)
    return (not p.is_absolute() and '..' not in p.parts and str(p) == path
            and (path in FILES or any(path.startswith(d + '/') for d in DIRS)))


def regular(root, relative):
    require(allowed(relative), 'OUTPUT_PATH')
    p = root
    for part in PurePosixPath(relative).parts:
        p = p / part
        info = p.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'OUTPUT_SYMLINK')
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'OUTPUT_REGULAR')
    return p


def context(event, ref, sha, workflow_sha, expected):
    require(event == 'workflow_dispatch' and ref == REF, 'DISPATCH_CONTEXT')
    require(re.fullmatch('[0-9a-f]{40}', expected or '') is not None
            and sha == expected == workflow_sha and sha != SOURCE, 'CONTROL_PIN')


def validate(control, source, env):
    context(env.get('GITHUB_EVENT_NAME'), env.get('GITHUB_REF'), env.get('GITHUB_SHA'),
            env.get('WORKFLOW_SHA'), env.get('EXPECTED_CONTROL_SHA'))
    require(git(control, 'rev-parse', 'HEAD').decode().strip() == env['GITHUB_SHA'], 'CONTROL_HEAD')
    require(git(control, 'rev-list', '--parents', '-n', '1', 'HEAD').decode().split()
            == [env['GITHUB_SHA'], SOURCE], 'CONTROL_PARENT')
    paths = set(git(control, 'diff', '--name-only', '-z', SOURCE, 'HEAD').decode().split('\0')) - {''}
    require(paths == CONTROL_PATHS, 'CONTROL_PATHS')
    for root in (control, source):
        require(not git(root, 'status', '--porcelain', '--untracked-files=all'), 'DIRTY_CHECKOUT')
    require(git(source, 'rev-parse', 'HEAD').decode().strip() == SOURCE, 'SOURCE_HEAD')
    require(git(source, 'rev-parse', 'HEAD^{tree}').decode().strip() == TREE, 'SOURCE_TREE')


def child_env(parent, home, target):
    result = {k: parent[k] for k in ('PATH',) if k in parent}
    result['RUSTUP_HOME'] = parent.get('RUSTUP_HOME', str(Path(parent['HOME']) / '.rustup'))
    result['RUSTUP_TOOLCHAIN'] = '1.98.0'
    result.update(HOME=str(home), CARGO_HOME=str(home / 'cargo'),
                  TMPDIR=str(home / 'tmp'), CARGO_TARGET_DIR=str(target),
                  CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='2', CI='true',
                  LANG='C.UTF-8', LC_ALL='C.UTF-8', TZ='UTC',
                  PYTHONDONTWRITEBYTECODE='1', GIT_CONFIG_NOSYSTEM='1',
                  GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0')
    return result


def inventory(root):
    names = list(FILES)
    for directory in DIRS:
        base = root / directory
        require(base.is_dir() and not base.is_symlink(), 'OUTPUT_DIRECTORY')
        for current, dirs, files in os.walk(base, followlinks=False):
            require(all(not (Path(current) / d).is_symlink() for d in dirs), 'OUTPUT_SYMLINK')
            names.extend(str((Path(current) / f).relative_to(root)) for f in files)
    result = {}
    for name in sorted(names):
        p = regular(root, name)
        data = p.read_bytes()
        result[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
                        'mode': '100755' if p.stat().st_mode & 0o111 else '100644',
                        'blob': hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()}
    return result


def changed_paths(root):
    tracked = git(root, 'diff', '--name-only', '-z', '--no-renames', 'HEAD')
    untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z')
    paths = set((tracked + untracked).decode().split('\0')) - {''}
    require(all(allowed(p) for p in paths), 'UNEXPECTED_SOURCE_CHANGE')
    return sorted(paths)


def ledger(before, after):
    return {p: {'before': before.get(p), 'after': after.get(p)}
            for p in sorted(before.keys() | after.keys()) if before.get(p) != after.get(p)}


def map_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def tree_entries(root, tree, env=None):
    result = {}
    for entry in git(root, 'ls-tree', '-r', '-z', tree, env=env).split(b'\0'):
        if entry:
            meta, name = entry.split(b'\t', 1)
            mode, kind, blob = meta.decode().split()
            result[name.decode()] = {'mode': mode, 'kind': kind, 'blob': blob}
    return result


def freeze_outputs(source, raw, accepted):
    raw.mkdir()
    for name, expected in accepted.items():
        original = regular(source, name)
        data = original.read_bytes()
        dest = raw / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        dest.chmod(0o755 if original.stat().st_mode & 0o111 else 0o644)
    require(inventory(raw) == accepted, 'EXPORT_MAP_DRIFT')
    require(inventory(source) == accepted, 'SOURCE_EXPORT_DRIFT')


def verify_export_tree(base, entries, accepted):
    require({p: v for p, v in entries.items() if not allowed(p)}
            == {p: v for p, v in base.items() if not allowed(p)}, 'PATCH_SOURCE_TREE_DRIFT')
    require({p: v for p, v in entries.items() if allowed(p)}
            == {p: {'mode': v['mode'], 'kind': 'blob', 'blob': v['blob']}
                for p, v in accepted.items()}, 'PATCH_OUTPUT_TREE_DRIFT')


def output_patch(root, index, env, raw, accepted, before):
    isolated = dict(env, GIT_INDEX_FILE=str(index))
    base = tree_entries(root, SOURCE, isolated)
    git(root, 'read-tree', SOURCE, env=isolated)
    if before is not None:
        require({p: {'mode': v['mode'], 'blob': v['blob'], 'kind': 'blob'} for p, v in before.items()}
                == {p: v for p, v in base.items() if allowed(p)}, 'BASE_OUTPUT_TREE')
    updates = bytearray()
    for name in sorted({p for p in base if allowed(p)} | accepted.keys()):
        if name not in accepted:
            updates.extend(('0 ' + '0' * 40 + '\t' + name + '\0').encode())
        else:
            data = regular(raw, name).read_bytes()
            blob = subprocess.check_output(['git', '-C', str(root), 'hash-object', '-w', '--stdin'],
                                           input=data, env=isolated).decode().strip()
            require(blob == accepted[name]['blob'], 'PATCH_BLOB_DRIFT')
            updates.extend((accepted[name]['mode'] + ' ' + blob + '\t' + name + '\0').encode())
    subprocess.run(['git', '-C', str(root), 'update-index', '-z', '--index-info'],
                   input=updates, env=isolated, check=True)
    tree = git(root, 'write-tree', env=isolated).decode().strip()
    entries = tree_entries(root, tree, isolated)
    verify_export_tree(base, entries, accepted)
    if before is not None:
        changed = set(git(root, 'diff', '--name-only', '-z', '--no-renames', SOURCE, tree,
                          env=isolated).decode().split('\0')) - {''}
        require(changed == ledger(before, accepted).keys(), 'PATCH_LEDGER_DRIFT')
    patch = git(root, 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-renames',
                SOURCE, tree, env=isolated)
    require(inventory(raw) == accepted, 'RAW_PATCH_MAP_DRIFT')
    return patch, tree


def retire_group(proc):
    receipt = {'pgid': proc.pid, 'absent': False, 'term_sent': False, 'kill_sent': False}
    start = time.monotonic()
    while True:
        proc.poll()  # Reap the leader before probing its group; leader exit alone is insufficient.
        try:
            os.killpg(proc.pid, 0)
        except ProcessLookupError:
            receipt.update(absent=True, elapsed_seconds=time.monotonic() - start)
            return receipt
        if not receipt['term_sent']:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                receipt['term_sent'] = True
            except ProcessLookupError:
                receipt['signal_race'] = True
        if time.monotonic() - start >= 0.25 and not receipt['kill_sent']:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
                receipt['kill_sent'] = True
            except ProcessLookupError:
                receipt['signal_race'] = True
        if time.monotonic() - start >= 5:
            receipt['elapsed_seconds'] = time.monotonic() - start
            return receipt
        time.sleep(0.05)


def run_command(command, root, env, log, deadline, initial_free, records):
    require(time.monotonic() < deadline, 'WRITER_30_MINUTE_LIMIT_BEFORE_LAUNCH')
    free = shutil.disk_usage(root).free
    require(free >= 2 * GIB and initial_free - free <= 12 * GIB, 'GUEST_DISK_BEFORE_LAUNCH')
    record = {'argv': list(command), 'start_unix': time.time(), 'exit': None}
    records.append(record)
    with log.open('wb') as output:
        proc = subprocess.Popen(command, cwd=root, env=env, stdout=output,
                                stderr=subprocess.STDOUT, start_new_session=True)
        failure = None
        try:
            while proc.poll() is None:
                free = shutil.disk_usage(root).free
                if time.monotonic() >= deadline:
                    failure = 'WRITER_30_MINUTE_LIMIT'
                elif free < 2 * GIB or initial_free - free > 12 * GIB:
                    failure = 'GUEST_DISK_LIMIT'
                elif log.stat().st_size > 32 * 1024 ** 2:
                    failure = 'LOG_SIZE_LIMIT'
                if failure:
                    break
                time.sleep(0.25)
        finally:
            record['group_retirement'] = retire_group(proc)
            record.update(exit=proc.poll(), end_unix=time.time(), failure=failure)
    if log.stat().st_size > 32 * 1024 ** 2:
        failure = record['failure'] = 'LOG_SIZE_LIMIT'
    require(record['group_retirement']['absent'], 'GROUP_NOT_RETIRED')
    require(not failure and record['exit'] == 0, failure or 'COMMAND_FAILED')


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def identity(env):
    context(env.get('GITHUB_EVENT_NAME'), env.get('GITHUB_REF'), env.get('GITHUB_SHA'),
            env.get('WORKFLOW_SHA'), env.get('EXPECTED_CONTROL_SHA'))
    for key in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
        require(re.fullmatch(r'[1-9][0-9]*', env.get(key, '')) is not None, 'RUN_IDENTITY')
    return {'control': env['GITHUB_SHA'], 'workflow_sha': env['WORKFLOW_SHA'],
            'source': SOURCE, 'source_tree': TREE, 'ref': env['GITHUB_REF'],
            'event': env['GITHUB_EVENT_NAME'], 'run_id': env['GITHUB_RUN_ID'],
            'attempt': env['GITHUB_RUN_ATTEMPT']}


def owned_root(out, env, nonce):
    require(re.fullmatch('[0-9a-f]{64}', nonce or '') is not None, 'OWNERSHIP_NOT_ACQUIRED')
    require(out.is_absolute() and out.name == 'canonical-evidence'
            and out.parent == Path(env['RUNNER_TEMP']).resolve(), 'ARTIFACT_ROOT_PATH')
    info = out.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'ARTIFACT_ROOT')
    return dict(identity(env), nonce=nonce, root=str(out), uid=info.st_uid,
                device=info.st_dev, inode=info.st_ino)


def acquire_output(out, env):
    identity(env)
    require(out.is_absolute() and out.name == 'canonical-evidence'
            and out.parent == Path(env['RUNNER_TEMP']).resolve(), 'ARTIFACT_ROOT_PATH')
    out.mkdir(mode=0o700)  # Failure leaves no fresh step output, so stale trees cannot upload.
    nonce = secrets.token_hex(32)
    marker = owned_root(out, env, nonce)
    write_json(out / 'ownership.json', marker)
    with open(env['GITHUB_OUTPUT'], 'a') as step_output:
        step_output.write('ownership_nonce=' + nonce + '\n')
    return marker


def artifact_file(out, name):
    p = out / name
    info = p.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and info.st_uid == os.getuid() and info.st_size <= 512 * 1024 ** 2, 'ARTIFACT_REGULAR')
    return p


def seal_artifact(out):
    custody = {}
    for current, dirs, files in os.walk(out, followlinks=False):
        require(all(not (Path(current) / d).is_symlink() for d in dirs), 'ARTIFACT_SYMLINK')
        for name in files:
            relative = str((Path(current) / name).relative_to(out))
            if relative == 'artifact-manifest.json':
                continue
            data = artifact_file(out, relative).read_bytes()
            custody[relative] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    require(sum(v['bytes'] for v in custody.values()) <= 512 * 1024 ** 2, 'ARTIFACT_SIZE_LIMIT')
    write_json(out / 'artifact-manifest.json', custody)


def verify_upload(out, env):
    trusted = owned_root(out, env, env.get('OWNERSHIP_NONCE'))
    require(json.loads(artifact_file(out, 'ownership.json').read_text()) == trusted, 'ARTIFACT_OWNERSHIP')
    expected = json.loads(artifact_file(out, 'artifact-manifest.json').read_text())
    actual = {}
    for current, dirs, files in os.walk(out, followlinks=False):
        require(all(not (Path(current) / d).is_symlink() for d in dirs), 'ARTIFACT_SYMLINK')
        for name in files:
            relative = str((Path(current) / name).relative_to(out))
            require(relative in {'ownership.json', 'before.json', 'first.json', 'after.json',
                                 'changes.json', 'outputs.patch', 'control.patch', 'terminal.json'}
                    or relative == 'artifact-manifest.json'
                    or re.fullmatch(r'command-[0-9]{2}\.log', relative)
                    or (relative.startswith('outputs/') and allowed(relative[8:])), 'ARTIFACT_PATH')
            data = artifact_file(out, relative).read_bytes()
            if relative != 'artifact-manifest.json':
                actual[relative] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    require(actual == expected, 'ARTIFACT_HASH_DRIFT')
    require(sum(v['bytes'] for v in actual.values()) <= 512 * 1024 ** 2, 'ARTIFACT_SIZE_LIMIT')
    terminal = json.loads(artifact_file(out, 'terminal.json').read_text())
    require(terminal['kind'] == 'canonical-generation-only'
            and type(terminal['success']) is bool, 'ARTIFACT_KIND')
    require({k: terminal.get(k) for k in identity(env)} == identity(env), 'ARTIFACT_IDENTITY')
    if terminal['success']:
        before = json.loads((out / 'before.json').read_text())
        first = json.loads((out / 'first.json').read_text())
        final = json.loads((out / 'after.json').read_text())
        require(first == final and map_digest(final) == terminal['accepted_map_sha256']
                == terminal['first_map_sha256'] == terminal['final_map_sha256'], 'ARTIFACT_PARITY')
        require(inventory(out / 'outputs') == final, 'ARTIFACT_RAW_MAP')
        require(json.loads((out / 'changes.json').read_text()) == ledger(before, final), 'ARTIFACT_LEDGER')
        require(all(r.get('group_retirement', {}).get('absent') and r['exit'] == 0
                    for r in terminal['commands']), 'ARTIFACT_GROUP_RETIREMENT')


def produce(control, source, out, env):
    # Exclusive, fresh output ownership; no ambient directory export.
    acquire_output(out, env)
    terminal = {'success': False, 'kind': 'canonical-generation-only', 'source': SOURCE,
                'source_tree': TREE, 'control': env.get('GITHUB_SHA'), 'commands': [],
                'run_id': env.get('GITHUB_RUN_ID'), 'attempt': env.get('GITHUB_RUN_ATTEMPT'),
                'ref': env.get('GITHUB_REF'), 'event': env.get('GITHUB_EVENT_NAME'),
                'workflow_sha': env.get('WORKFLOW_SHA'), 'writer_minutes': 30,
                'guest_growth_cap_bytes': 12 * GIB, 'guest_reserve_bytes': 2 * GIB,
                'profile': 'Cargo default dev; no profile overrides; jobs=2; incremental=0'}
    started = time.monotonic()
    try:
        validate(control, source, env)
        initial_free = shutil.disk_usage(source).free
        terminal['guest_initial_free_bytes'] = initial_free
        require(initial_free >= 14 * GIB, 'GUEST_INITIAL_DISK')
        terminal['control_tree'] = git(control, 'rev-parse', 'HEAD^{tree}').decode().strip()
        terminal['workflow_blob'] = git(control, 'rev-parse', 'HEAD:.github/workflows/stable-release.yml').decode().strip()
        before = inventory(source)
        write_json(out / 'before.json', before)
        with tempfile.TemporaryDirectory(prefix='canonical-', dir=env['RUNNER_TEMP']) as tmp:
            work = Path(tmp)
            home = work / 'home'
            (home / 'tmp').mkdir(parents=True)
            child = child_env(env, home, work / 'target')
            for name in ('Cargo.lock', 'rust-toolchain.toml', WEB + '/package-lock.json',
                         'rustfmt.toml', '.rustfmt.toml', '.github/scripts/package-lock.json'):
                p = source / name
                if p.is_file():
                    terminal.setdefault('inputs_sha256', {})[name] = hashlib.sha256(p.read_bytes()).hexdigest()
            commands = [('rustc', '-Vv'), ('cargo', '-V'), ('node', '--version'),
                        ('npm', '--version'), ('python3', '--version'), ('make', 'setup')] + GEN + GEN
            first = None
            for i, command in enumerate(commands):
                run_command(command, source, child, out / f'command-{i:02d}.log',
                            started + 1800, initial_free, terminal['commands'])
                changed_paths(source)
                if i == 5 + len(GEN):
                    first = inventory(source)
                    write_json(out / 'first.json', first)
                    terminal['first_map_sha256'] = map_digest(first)
            final = inventory(source)
            write_json(out / 'after.json', final)
            terminal['final_map_sha256'] = map_digest(final)
            require(first == final, 'REPEAT_OUTPUT_DRIFT')
            require(all(r.get('group_retirement', {}).get('absent') for r in terminal['commands']),
                    'GROUP_NOT_RETIRED_BEFORE_EXPORT')
            terminal['accepted_map_sha256'] = map_digest(final)
            require(time.monotonic() < started + 1800, 'WRITER_DEADLINE_BEFORE_EXPORT')
            freeze_outputs(source, out / 'outputs', final)
            patch, export_tree = output_patch(source, work / 'index', child, out / 'outputs', final, before)
            terminal['export_tree'] = export_tree
            changed_paths(source)
            (out / 'outputs.patch').write_bytes(patch)
            (out / 'control.patch').write_bytes(git(control, 'diff', '--binary', '--full-index', SOURCE, 'HEAD'))
            write_json(out / 'changes.json', ledger(before, final))
            require(inventory(source) == final, 'SOURCE_POST_EXPORT_DRIFT')
            require(inventory(out / 'outputs') == final, 'RAW_POST_EXPORT_DRIFT')
            changed_paths(source)
            require(git(source, 'rev-parse', 'HEAD').decode().strip() == SOURCE, 'SOURCE_HEAD_MOVED')
            require(not git(source, 'diff', '--cached', '--name-only'), 'REAL_INDEX_CHANGED')
        terminal['success'] = True
    except Exception as error:
        terminal['error'] = str(error)
        raise
    finally:
        terminal['elapsed_seconds'] = time.monotonic() - started
        write_json(out / 'terminal.json', terminal)
        seal_artifact(out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--control', type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--verify-upload', action='store_true')
    args = parser.parse_args()
    if args.verify_upload:
        verify_upload(args.out.absolute(), os.environ)
    else:
        require(args.control and args.source, 'CHECKOUT_ARGUMENTS')
        produce(args.control.resolve(), args.source.resolve(), args.out.absolute(), os.environ)
