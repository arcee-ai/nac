"""Bounded typed child ownership; namespace PID1 owns descendant retirement."""
import os
from pathlib import Path
import signal
import subprocess
import time
from contract import require, sha256, write_json


def clean_environment(home, temporary, extra=None):
    environment = {key: os.environ[key] for key in ('PATH', 'CARGO_HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN',
                   'PLAYWRIGHT_BROWSERS_PATH') if key in os.environ}
    environment.setdefault('CARGO_HOME', str(Path.home()/'.cargo'))
    environment.setdefault('RUSTUP_HOME', str(Path.home()/'.rustup'))
    environment.update(HOME=str(home), TMPDIR=str(temporary), LANG='C.UTF-8',
                       CARGO_BUILD_JOBS='2', CARGO_INCREMENTAL='0')
    environment.update(extra or {})
    return environment


class Interrupted(Exception):
    pass


def interrupt(*_):
    raise Interrupted('CANCELLED')


def run_owned(argv, cwd, environment, output, label, seconds, *, factory=subprocess.Popen,
              on_spawn=None, hash_streams=True):
    """No shell, retries, raw PID/group fallback or stdout/stderr disclosure."""
    output = Path(output)
    receipt = {'label': label, 'argv': [str(arg) for arg in argv], 'pid': None,
               'first_error': None, 'signals': [], 'exit': None}
    write_json(output/(label+'.terminal.json'), receipt)
    child = None
    start = time.monotonic()
    try:
        with (output/(label+'.stdout')).open('xb') as stdout, (output/(label+'.stderr')).open('xb') as stderr:
            child = factory([str(arg) for arg in argv], cwd=cwd, env=environment,
                            stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                            start_new_session=True, close_fds=True)
            receipt['pid'] = child.pid
            write_json(output/(label+'.terminal.json'), receipt)
            if on_spawn is not None:
                on_spawn(child)
            try:
                receipt['exit'] = child.wait(timeout=seconds)
            except subprocess.TimeoutExpired:
                receipt['first_error'] = 'CHILD_TIMEOUT'
            except Interrupted:
                receipt['first_error'] = 'CANCELLED'
    except Interrupted:
        receipt['first_error'] = receipt['first_error'] or 'CANCELLED'
    except BaseException:
        receipt['first_error'] = receipt['first_error'] or 'CHILD_IO_OR_CUSTODY_FAILURE'
    finally:
        if child is not None:
            # Signal only this retained Popen handle. Private PID namespace cleanup
            # is mandatory; an exited root is never an excuse to signal an old PGID.
            if child.poll() is None:
                child.terminate()
                receipt['signals'].append('typed TERM')
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    receipt['signals'].append('typed KILL')
                    try:
                        child.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        receipt['first_error'] = receipt['first_error'] or 'CHILD_EXIT_UNQUALIFIED'
            receipt['exit'] = child.poll()
        if receipt['exit'] != 0:
            receipt['first_error'] = receipt['first_error'] or 'CHILD_FAILED'
        receipt['terminal'] = receipt['exit'] is not None
        receipt['elapsed_seconds'] = time.monotonic()-start
        for stream in ('stdout', 'stderr'):
            file = output/(label+'.'+stream)
            if hash_streams and file.exists():
                receipt[stream+'_bytes'] = file.stat().st_size
                receipt[stream+'_sha256'] = sha256(file)
        write_json(output/(label+'.terminal.json'), receipt)
    require(not receipt['first_error'] and receipt['exit'] == 0, receipt['first_error'] or 'CHILD_FAILED')
    return receipt


def namespace_members():
    """Call only AFTER distinct namespace/PID1 proof; no host process inventory."""
    require(os.getpid() == 1, 'PRIVATE_PID1_REQUIRED')
    return sorted(int(file.name) for file in Path('/proc').iterdir()
                  if file.name.isdigit() and int(file.name) != 1)


def reap_namespace(seconds=3):
    require(os.getpid() == 1, 'PRIVATE_PID1_REQUIRED')
    reaped = []
    end = time.monotonic()+seconds
    while time.monotonic() < end:
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                break
            if not pid:
                break
            reaped.append({'pid': pid, 'wait_status': status})
        if not namespace_members():
            break
        time.sleep(.025)
    return {'reaped': reaped, 'remaining': namespace_members(),
            'retirement_boundary': 'Kernel kills members when this private PID1 exits; not all-host closure'}
