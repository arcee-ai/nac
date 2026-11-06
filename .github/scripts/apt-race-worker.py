#!/usr/bin/env python3
"""Private Linux unprivileged command lease; no package installation or retry."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import resource
import re
import signal
import shutil
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('supervisor', Path(__file__).with_name('browser-apt-supervisor.py'))
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


def stop(path, nonce):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        supervisor.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1 and info.st_size <= 256,
                           'foreign stop owner/size')
        value = json.loads(source.read(257))
    supervisor.require(value == {'nonce': nonce, 'reason': value.get('reason')} and
                       value['reason'] in ('winner-cancelled', 'controller-stop'), 'foreign stop request')
    return value['reason']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True, type=Path)
    parser.add_argument('--cwd', required=True, type=Path)
    parser.add_argument('--parent', required=True, type=int)
    parser.add_argument('--start', required=True, type=int)
    parser.add_argument('--nonce', required=True)
    parser.add_argument('--apt-config', type=Path)
    parser.add_argument('--file-limit', type=int, default=128*1024**2)
    parser.add_argument('--deadline', required=True, type=float)
    args, command = parser.parse_known_args()
    supervisor.require(command[:1] == ['--'] and len(command) > 1 and Path(command[1]).is_absolute(),
                       'absolute child command')
    supervisor.require(os.getuid() != 0 and os.geteuid() == os.getuid(), 'ordinary UID required')
    supervisor.require(re.fullmatch(r'[0-9a-f]{32}', args.nonce), 'invalid lease nonce')
    parent = {'pid': args.parent, 'start': args.start}
    current = supervisor.same(parent)
    supervisor.require(current and current['uid'] == os.getuid() and args.parent == os.getppid(), 'wrong parent lease')
    fd = supervisor.control_fd(args.state, os.getuid())
    supervisor.subreaper()
    signals = []
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda value, _frame: signals.append(value))
    affinity = sorted(os.sched_getaffinity(0))[:2]
    os.sched_setaffinity(0, affinity)
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024**2, 768 * 1024**2))
    supervisor.require(0 < args.file_limit <= 128*1024**2, 'native file bound')
    resource.setrlimit(resource.RLIMIT_FSIZE, (args.file_limit, args.file_limit))
    child = None
    reason, error, rows = '', None, []
    started = time.monotonic()
    try:
        if args.deadline-time.monotonic() < 900+30:
            raise TimeoutError('budget-not-executed')
        env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG', 'LC_ALL') if key in os.environ}
        if args.apt_config:
            env['APT_CONFIG'] = str(args.apt_config)
        with (args.state/'stdout.log').open('xb') as out, (args.state/'stderr.log').open('xb') as err:
            child = subprocess.Popen(command[1:], cwd=args.cwd, env=env, stdout=out, stderr=err,
                                     start_new_session=True)
            operation_started = time.monotonic()
            supervisor.publish(fd, 'ready.json', {'nonce': args.nonce, 'child': supervisor.process(child.pid)})
            while True:
                rows.extend(supervisor.reaped(child))
                supervisor.require(shutil.disk_usage(args.state).free >= 13*1024**3, '13GiB free-space fence')
                supervisor.require(sum(p.stat().st_size for p in (args.state/'stdout.log', args.state/'stderr.log')) <= 32*1024**2,
                                   'native command text bound')
                parent_now = supervisor.same(parent)
                requested = stop(args.state/'stop', args.nonce)
                if not parent_now or parent_now['state'] == 'Z':
                    reason = 'parent-loss'
                elif signals:
                    reason = 'signal'
                elif child.returncode is not None:
                    # A real nonzero wins over a simultaneous cancellation request.
                    reason = 'failed' if child.returncode else 'leak' if supervisor.owned() else 'completed'
                elif requested:
                    reason = requested
                elif time.monotonic()-operation_started >= 900:
                    reason = 'timeout'
                if reason:
                    break
                time.sleep(.025)
    except BaseException as caught:
        error = type(caught).__name__+': '+str(caught)
        reason = 'budget-not-executed' if isinstance(caught, TimeoutError) and str(caught) == 'budget-not-executed' else 'error'
    finally:
        cleanup = supervisor.settle(child)
        cleanup['reaped'] = rows+cleanup['reaped']
        if reason == 'winner-cancelled' and child and child.returncode is not None and child.returncode >= 0:
            # A command that really returned an error during the cancellation
            # race remains failed; only signal termination is redundant cancel.
            reason = 'failed' if child.returncode else 'completed'
        supervisor.publish(fd, 'result.json', {'nonce': args.nonce, 'reason': reason, 'error': error,
            'exit': child.returncode if child else None, 'seconds': time.monotonic()-started,
            'cleanup': cleanup, 'signals': signals, 'affinity': affinity,
            'usage_children': list(resource.getrusage(resource.RUSAGE_CHILDREN))})
        os.close(fd)
    supervisor.require(not cleanup['remaining'] and not error, 'worker cleanup/error')
    return 0 if reason == 'completed' and child.returncode == 0 else 125 if reason == 'winner-cancelled' else 1


if __name__ == '__main__':
    sys.exit(main())
