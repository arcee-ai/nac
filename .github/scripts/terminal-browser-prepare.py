#!/usr/bin/env python3
"""Private, unwired Linux preparation: one build overlaps authenticated downloads.

This produces preparation evidence, never a native-journey or security verdict.
Package configuration starts only after both unprivileged children are settled.
"""
import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import time
import secrets

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WEB = ROOT / 'crates/nac-server/web'


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


apt = load_module('terminal_prepare_apt', 'browser-apt.py')
portability = load_module('terminal_prepare_portability', 'nightly-portability.py')
binary_owner = load_module('terminal_prepare_binary', 'browser-binary.py')
supervision = apt.supervisor


def require(value, message):
    if not value:
        raise RuntimeError(message)


@contextmanager
def deadline(seconds):
    require(0 < seconds <= 1800, 'preparation must fit its finite budget')
    require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), 'foreign timer active')
    previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM)}

    def interrupted(signum, _frame):
        raise InterruptedError('preparation deadline' if signum == signal.SIGALRM else 'preparation cancelled')

    try:
        for signum in previous:
            signal.signal(signum, interrupted)
        signal.setitimer(signal.ITIMER_REAL, seconds)
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        for signum, handler in previous.items():
            signal.signal(signum, handler)


@contextmanager
def cleanup_signals(*, resume_deadline=False):
    """A repeated cancel must not interrupt owned teardown half way through."""
    previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM)}
    timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    signal.setitimer(signal.ITIMER_REAL, 0)
    try:
        for signum in previous:
            signal.signal(signum, signal.SIG_IGN)
        yield
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
        if resume_deadline and timer[0]:
            remaining = timer[0] - (time.monotonic() - started)
            require(remaining > 0, 'preparation deadline expired during cleanup')
            signal.setitimer(signal.ITIMER_REAL, remaining)


def token(control, name, nonce):
    fd = os.open(control, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError('token already published')
        handle = os.open(name + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        with os.fdopen(handle, 'wb') as stream:
            stream.write(nonce.encode())
            stream.flush()
        os.rename(name + '.tmp', name, src_dir_fd=fd, dst_dir_fd=fd)
    finally:
        os.close(fd)


def receipt(control, name, nonce):
    path = control / name
    with apt.store.regular(path) as stream:
        info = os.fstat(stream.fileno())
        require(info.st_uid == os.getuid(), 'foreign supervisor receipt owner')
        raw = stream.read(1024 * 1024 + 1)
    require(len(raw) <= 1024 * 1024, 'supervisor receipt bound')
    value = json.loads(raw, object_pairs_hook=apt.store.unique)
    require(value.get('schema') == 1 and value.get('nonce') == nonce and
            value.get('uid') == os.getuid(), 'foreign supervisor receipt')
    return value


def command_set(directory, env, prefetch):
    commands = [('build', [env.get('CARGO', 'cargo'), 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'])]
    if prefetch:
        commands.append(('prefetch', [sys.executable, str(HERE / 'browser-apt.py'),
                                     'export', '--state', str(directory / 'producer')]))
    return commands


def supervise(args):
    """Dedicated waitpid domain; even setsid grandchildren are adopted here."""
    require(sys.platform == 'linux' and os.getuid() > 0, 'ordinary Linux supervisor required')
    require(0 < args.seconds <= 1800, 'bounded supervision required')
    require(len(args.nonce) == 32 and all(c in '0123456789abcdef' for c in args.nonce), 'invalid nonce')
    fd = supervision.control_fd(args.control, os.getuid())
    caller = {'pid': args.caller, 'start': args.start}
    roots, logs, phases = {}, [], []
    reason, error, received = 'initializing', None, []
    started = time.monotonic()
    try:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, lambda value, _frame: received.append(value))
        supervision.subreaper()  # Before every workload fork/constructor.
        current = supervision.same(caller)
        require(current and current['uid'] == os.getuid() and current['state'] != 'Z', 'caller lease missing')
        own = supervision.process(os.getpid())
        supervision.publish(fd, 'ready.json', {'schema': 1, 'nonce': args.nonce, 'uid': os.getuid(),
                            'caller': caller, 'supervisor': own, 'source': args.source})
        reason = 'waiting-go'
        while True:
            current = supervision.same(caller)
            require(current and current['uid'] == os.getuid() and current['state'] != 'Z', 'caller lease lost')
            require(not received and not supervision.requested(fd, args.nonce, os.getuid()), 'supervisor stopped')
            require(time.monotonic() - started < min(5, args.seconds), 'GO startup timeout')
            try:
                go = os.open('go', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            except FileNotFoundError:
                time.sleep(.025)
                continue
            with os.fdopen(go, 'rb') as stream:
                info = os.fstat(stream.fileno())
                require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
                        info.st_nlink == 1 and info.st_size == 32 and stream.read(33) == args.nonce.encode(), 'foreign GO')
            break
        require(apt.load(args.work / 'producer/identity.json')['source'] == args.source,
                'supervisor source drift')
        reason = 'running'
        for label, command in command_set(args.work, os.environ, args.prefetch):
            # Non-raising handlers defer cancellation through Popen construction.
            # If construction raises after fork, subreaping still owns the child.
            handles = []
            for suffix in ('.stdout.log', '.stderr.log'):
                handle = os.open(args.work / (label + suffix), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                handles.append(os.fdopen(handle, 'wb'))
                logs.append(handles[-1])
            child = subprocess.Popen(command, cwd=ROOT, env=os.environ.copy(), stdin=subprocess.DEVNULL,
                                     stdout=handles[0], stderr=handles[1], start_new_session=True)
            roots[child.pid] = {'label': label, 'child': child, 'started': time.monotonic(), 'exit': None}
        while True:
            for row in supervision.reaped(None):
                if row['pid'] in roots:
                    root = roots[row['pid']]
                    root['exit'] = row['exit']
                    root['child'].returncode = row['exit']
                    phases.append({'label': root['label'], 'seconds': time.monotonic() - root['started'], 'exit': row['exit']})
            current = supervision.same(caller)
            require(current and current['uid'] == os.getuid() and current['state'] != 'Z', 'caller lease lost')
            require(not received and not supervision.requested(fd, args.nonce, os.getuid()), 'supervisor stopped')
            require(time.monotonic() - started < args.seconds, 'supervisor deadline')
            require(shutil.disk_usage(args.work).free >= 13 * 1024**3, '13GiB reserve')
            require(all(sum((args.work / (root['label'] + suffix)).stat().st_size
                            for suffix in ('.stdout.log', '.stderr.log')) <= 32 * 1024**2
                        for root in roots.values()), 'child output bound')
            require(all(root['exit'] in (None, 0) for root in roots.values()), 'preparation child failed')
            if roots and all(root['exit'] == 0 for root in roots.values()):
                require(not supervision.owned(), 'preparation descendant leak')
                reason = 'completed'
                break
            time.sleep(.025)
    except BaseException as caught:
        error = type(caught).__name__
    finally:
        cleanup = supervision.settle(None)
        for handle in logs:
            handle.close()
        result = {'schema': 1, 'nonce': args.nonce, 'uid': os.getuid(), 'source': args.source,
                  'caller': caller, 'reason': reason, 'error_type': error, 'phases': phases,
                  'received_signals': received, 'cleanup': cleanup,
                  'roots': [{'label': r['label'], 'pid': pid, 'exit': r['exit']} for pid, r in roots.items()]}
        supervision.publish(fd, 'result.json', result)
        os.close(fd)
    require(reason == 'completed' and error is None and not cleanup['remaining'], 'preparation supervisor failed')


def parallel(commands, directory, env, phases):
    """Original parent handle plus leased READY/GO/STOP; never a PG kill proof."""
    require(commands == command_set(directory, env, len(commands) == 2), 'fixed preparation commands required')
    control = directory / 'supervision'
    control.mkdir(mode=0o700)
    nonce = secrets.token_hex(16)
    caller = supervision.process(os.getpid())
    require(caller and caller['uid'] == os.getuid() and os.getuid() > 0, 'ordinary caller identity required')
    source = apt.load(directory / 'producer/identity.json')['source']
    remaining = signal.getitimer(signal.ITIMER_REAL)[0]
    require(10 < remaining <= 1800, 'insufficient preparation budget')
    command = [sys.executable, str(Path(__file__).resolve()), '--supervise', '--control', str(control),
               '--work', str(directory), '--caller', str(caller['pid']), '--start', str(caller['start']),
               '--nonce', nonce, '--expected-sha', source, '--seconds', str(remaining)]
    if len(commands) == 2:
        command.append('--prefetch')
    child, complete, handles = None, False, []
    result = None
    try:
        for suffix in ('.stdout.log', '.stderr.log'):
            handle = os.open(directory / ('supervisor' + suffix), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            handles.append(os.fdopen(handle, 'wb'))
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                 stdout=handles[0], stderr=handles[1], start_new_session=True)
        end = time.monotonic() + 5
        while not (control / 'ready.json').exists():
            require(time.monotonic() < end and child.poll() is None, 'supervisor READY missing')
            time.sleep(.025)
        ready = receipt(control, 'ready.json', nonce)
        observed = supervision.same(ready['supervisor'])
        require(ready.get('caller') == {'pid': caller['pid'], 'start': caller['start']} and
                ready.get('source') == source and ready['supervisor']['pid'] == child.pid and
                observed and observed['uid'] == os.getuid(), 'unbound supervisor READY')
        token(control, 'go', nonce)  # Work can start only after original handle binding.
        while not (control / 'result.json').exists():
            require(child.poll() is None, 'supervisor died; cleanup UNKNOWN')
            time.sleep(.025)
        result = receipt(control, 'result.json', nonce)
        child.wait(timeout=5)
        require(result.get('source') == source and result.get('caller') == ready['caller'] and
                result.get('reason') == 'completed' and result.get('error_type') is None and
                result.get('cleanup', {}).get('remaining') == [] and child.returncode == 0 and
                sorted(r['label'] for r in result.get('roots', [])) == sorted(label for label, _ in commands) and
                all(r['exit'] == 0 for r in result['roots']), 'preparation or cleanup failed')
        phases.extend(result['phases'])
        complete = True
    finally:
        with cleanup_signals(resume_deadline=True):
            try:
                if not complete:
                    # Address exists before Popen; STOP before GO on ambiguity.
                    apt.request_stop(control, nonce)
                    if child is not None:
                        child.wait(timeout=8)
                    end = time.monotonic() + 5
                    while not (control / 'result.json').exists():
                        require(time.monotonic() < end, 'cleanup UNKNOWN; retain owned roots')
                        time.sleep(.025)
                    result = receipt(control, 'result.json', nonce)
                    require(result.get('source') == source and
                            result.get('caller') == {'pid': caller['pid'], 'start': caller['start']} and
                            result.get('cleanup', {}).get('remaining') == [],
                            'cleanup UNKNOWN; descendants remain')
            finally:
                for handle in handles:
                    handle.close()


def operation(name, state, source, *, cold='false', **values):
    args = argparse.Namespace(operation=name, state=state, source=source, cold=cold,
                              github_output=None, **values)
    existed = os.path.lexists(state)
    started = time.monotonic()
    failure = None
    try:
        getattr(apt, name)(args)
        return apt.load(state / (name + '.json'))
    except BaseException as caught:
        failure = type(caught).__name__
        raise
    finally:
        if state.is_dir() and not state.is_symlink() and not (name == 'preflight' and existed):
            apt.write(state / ('phase-' + name + '.json'),
                      {'operation': name, 'seconds': time.monotonic() - started, 'failure_type': failure})


def binary_digest(path):
    # The path is lexical. Never resolve the leaf before O_NOFOLLOW.
    with binary_owner.regular(path, 512 * 1024**2) as (stream, info):
        require(info.st_mode & 0o111, 'compiled binary is not executable')
        return {'path': str(path), 'bytes': info.st_size, 'sha256': binary_owner.digest(stream, info.st_size),
                'device': info.st_dev, 'inode': info.st_ino, 'mtime_ns': info.st_mtime_ns}


def copy_binary(target, output):
    # An explicitly configured target-directory alias is permitted, not a leaf
    # alias. Anchor debug and nac-web separately beneath that canonical root.
    target = Path(target).resolve(strict=True)
    rootfd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    debugfd = sourcefd = None
    try:
        debugfd = os.open('debug', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=rootfd)
        sourcefd = os.open('nac-web', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=debugfd)
        with os.fdopen(sourcefd, 'rb') as source:
            sourcefd = None
            before = os.fstat(source.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_mode & 0o111 and
                    0 < before.st_size <= 512 * 1024**2, 'invalid compiled binary')
            expected = binary_owner.digest(source, before.st_size)
            source.seek(0)
            engine = binary_owner.new_directory(output / 'engine')
            destination = engine / 'nac-web'
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o500)
            with os.fdopen(fd, 'wb') as copied:
                remaining = before.st_size
                while remaining:
                    data = source.read(min(1024 * 1024, remaining))
                    require(data, 'compiled binary shrank during copy')
                    copied.write(data)
                    remaining -= len(data)
                require(not source.read(1), 'compiled binary grew during copy')
                copied.flush()
                os.fchmod(copied.fileno(), 0o500)
            after = os.fstat(source.fileno())
            fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns')
            require(all(getattr(before, f) == getattr(after, f) for f in fields), 'compiled binary changed during copy')
            result = binary_digest(destination)
            require(result['sha256'] == expected and result['bytes'] == before.st_size,
                    'compiled binary copy differs')
            result['target_directory'] = str(target)
            return result
    finally:
        if sourcefd is not None:
            os.close(sourcefd)
        if debugfd is not None:
            os.close(debugfd)
        os.close(rootfd)


def verify_binary(value):
    path = Path(value['path']).absolute()
    require(all(not p.is_symlink() for p in path.parents), 'binary ancestor changed')
    actual = binary_digest(path)
    require(all(actual[k] == value[k] for k in ('path', 'bytes', 'sha256', 'device', 'inode', 'mtime_ns')),
            'prepared binary identity changed')
    return path


def normal_install(state):
    # Invoke the locked, normal Playwright CLI. Root supervision covers its APT
    # descendants; no install simulation, no-download flag or maintainer bypass.
    node = shutil.which('node')
    require(node is not None, 'Node unavailable')
    cli = WEB / 'node_modules/playwright/cli.js'
    require(cli.is_file() and not cli.is_symlink(), 'locked Playwright CLI unavailable')
    apt.run(state, 'normal-install', ['sudo', str(Path(node).resolve()), str(cli.resolve()),
                                    'install-deps', 'chromium'], cwd=WEB)


def prepare(source, output, *, seconds=1200, env=None, cold=False):
    require(sys.platform == 'linux' and os.geteuid() != 0, 'ordinary Linux runner required')
    require(type(cold) is bool, 'explicit cold selector required')
    require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), 'foreign timer active')
    output = Path(output).absolute()
    require(not os.path.lexists(output), 'preparation output must be fresh; no retry')
    require(all(not p.is_symlink() for p in (output.parent, *output.parents)), 'symlink output ancestor')
    output.mkdir(mode=0o700)
    env = dict(os.environ if env is None else env)
    env['CARGO_PROFILE_TEST_DEBUG'] = '0'
    producer, consumer = output / 'producer', output / 'consumer'
    phases = []
    receipt = {'schema': 1, 'source': source, 'status': 'failed', 'quality_verdict': False,
               'phases': phases, 'archive_mode': None, 'binary': None}
    offered = False
    failure = None
    started = time.monotonic()
    try:
        with deadline(seconds):
            preflight = operation('preflight', producer, source, cold='true' if cold else 'false')
            enabled = preflight['mode'] == 'pending'
            mode = operation('plan', producer, source)['mode'] if enabled else preflight['mode']
            build = [env.get('CARGO', 'cargo'), 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web']
            commands = [('build', build)]
            if mode == 'ready':
                commands.append(('prefetch', [sys.executable, str(HERE / 'browser-apt.py'),
                                             'export', '--state', str(producer)]))
            parallel(commands, output, env, phases)
            producer_identity = apt.load(producer / 'identity.json')
            require(apt.source_identity(source) == {
                key: producer_identity[key]
                for key in ('source', 'repository', 'run_id', 'attempt', 'image')
            }, 'source or run identity changed during preparation')
            receipt['binary'] = copy_binary(ROOT / env.get('CARGO_TARGET_DIR', 'target'), output)
            if mode == 'ready':
                exported = apt.load(producer / 'export.json')
                operation('preflight', consumer, source)
                operation('plan', consumer, source)
                # Only this call gets the exact local producer receipt; never
                # leak or replace the caller's ambient transport environment.
                previous = os.environ.get('BROWSER_APT_RECEIPT')
                try:
                    os.environ['BROWSER_APT_RECEIPT'] = json.dumps(exported['receipt'])
                    consumed = operation('consume', consumer, source, producer_mode='ready',
                                         download=producer / 'artifact')
                finally:
                    if previous is None:
                        os.environ.pop('BROWSER_APT_RECEIPT', None)
                    else:
                        os.environ['BROWSER_APT_RECEIPT'] = previous
                receipt['archive_mode'] = consumed['mode']
                if consumed['mode'] == 'verified-offer':
                    offered = True  # Includes partial exclusive publication.
                    apt.run(consumer, 'offer-command', ['sudo', sys.executable,
                            str(HERE / 'browser-apt.py'), 'offer', '--state', str(consumer)])
            else:
                receipt['archive_mode'] = mode
            install_state = consumer if consumer.exists() else producer
            normal_install(install_state)
            if enabled:
                # Use the final consumer plan where present, not the older
                # producer plan, for post-configuration identity checks.
                operation('installed', install_state, source)
            receipt['status'] = 'prepared'
    except BaseException as caught:
        failure = caught
        receipt['failure_type'] = type(caught).__name__
    finally:
        with cleanup_signals():
            if offered:
                try:
                    apt.run(consumer, 'cleanup-command', ['sudo', sys.executable,
                            str(HERE / 'browser-apt.py'), 'cleanup', '--state', str(consumer)], timeout=30)
                except BaseException as caught:
                    failure = failure or caught
                    receipt['status'] = 'failed'
                    receipt['cleanup_failure_type'] = type(caught).__name__
            receipt['seconds'] = time.monotonic() - started
            apt.write(output / 'preparation.json', receipt)
    if failure:
        raise RuntimeError('preparation failed; retained evidence is not acceptance') from failure
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--supervise', action='store_true')
    parser.add_argument('--control', type=Path)
    parser.add_argument('--work', type=Path)
    parser.add_argument('--caller', type=int)
    parser.add_argument('--start', type=int)
    parser.add_argument('--nonce')
    parser.add_argument('--prefetch', action='store_true')
    parser.add_argument('--seconds', type=float, default=1200)
    parser.add_argument('--cold', action='store_true')
    args = parser.parse_args()
    if args.supervise:
        args.source = args.expected_sha
        supervise(args)
    else:
        require(args.output is not None, 'preparation output required')
        prepare(args.expected_sha, args.output, seconds=args.seconds, cold=args.cold)


if __name__ == '__main__':
    main()
