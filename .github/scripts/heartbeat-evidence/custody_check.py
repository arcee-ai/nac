"""Finite Linux-only characterization of the existing namespace owners; no NAC."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import signal
import socket
import subprocess
import sys
import time
import uuid

from contract import (BASELINE, HEAD, TREE, MODE, CUSTODY_MODE, require, validate_event,
                      validate_request, write_json, sha256)
from namespace_custody import Kernel, NamespaceCustody, receive_fd, send_fd
from owned_process import clean_environment, interrupt

SOURCE = Path(__file__).resolve().parent
# Exact production owners; changed owner hashes require affected source review.
# The fixture copies no implementation and does not alter production custody.
OWNER_HASHES = {'run.py': 'af654f9cb797ac7e39d5bcd9e4ed1ed6f20d169566af83b32649e51e5c308c9b', 'namespace_custody.py': '0fc67f4332480afa1e90fe3107bccf9c41cbab284029d4b4833b391c665a9ce8', 'owned_process.py': '7e747e4d051e3b13a510f46968d028f7c24a89b853297e306f6f213c4e256757'}
spec = importlib.util.spec_from_file_location('evidence_owner', SOURCE/'run.py')
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


def wait_admitted(output, kernel, pidfd):
    end = time.monotonic()+10
    while time.monotonic() < end:
        require(not kernel.ready(pidfd), 'PID1_DIED_BEFORE_ADMISSION')
        path = output/'admitted.json'
        if path.exists():
            result = json.loads(path.read_text())
            require(result['pid'] == 1 and result['uid'] > 0 and
                    result['lifeline']['state'] == 'VERIFIED_POST_DROP' and result['stub_started'],
                    'STUB_NOT_ADMITTED_POST_DROP')
            return result
        time.sleep(.02)
    raise RuntimeError('STUB_ADMISSION_TIMEOUT')


def payload(context_path, output):
    context = json.loads(context_path.read_text())
    proof, lifeline = owner.bootstrap_namespace(context)
    child = None
    try:
        # A disposable Python sleep is the only workload. It marks actual start
        # after the production bootstrap has armed its post-drop watcher.
        stub = "import pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text('started');time.sleep(90)"
        child = subprocess.Popen([sys.executable, '-c', stub, str(output/'stub-started')],
            env=clean_environment(output, output), stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        end = time.monotonic()+5
        while not (output/'stub-started').exists() and time.monotonic() < end:
            require(child.poll() is None, 'STUB_EARLY_EXIT')
            time.sleep(.02)
        require((output/'stub-started').exists(), 'STUB_START_TIMEOUT')
        write_json(output/'admitted.json', {'pid': os.getpid(), 'uid': os.geteuid(),
            'gid': os.getegid(), 'lifeline': proof['lifeline'], 'stub_started': True})
        child.wait(timeout=100)
        raise RuntimeError('CANCELLATION_WAS_NOT_DELIVERED')
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=3)
        lifeline.close()


def controller(context_path, output, driver_fd):
    context = json.loads(context_path.read_text())
    context['controller_pid'] = os.getpid()
    write_json(context_path, context)
    channel = socket.socket(fileno=driver_fd)
    channel.set_inheritable(False)
    channel.settimeout(20)

    class ObservedCustody(NamespaceCustody):
        def bind(self, wrapper):
            super().bind(wrapper)  # Actual production handshake and identity proof.
            admitted = wait_admitted(output, self.kernel, self.pidfd)
            send_fd(channel, {'kind': 'PID1', 'nonce': context['lifeline_nonce'],
                'controller': os.getpid(), 'proof': self.proof, 'admitted': admitted}, self.pidfd)
            require(wrapper.poll() is None, 'WRAPPER_DIED_BEFORE_OBSERVATION')
            wrapper_fd = os.pidfd_open(wrapper.pid)  # Retained unreaped Popen anchor.
            try:
                send_fd(channel, {'kind': 'wrapper', 'pid': wrapper.pid}, wrapper_fd)
            finally:
                os.close(wrapper_fd)
            action = channel.recv(32)
            require(action in (b'controller', b'wrapper'), 'FIXTURE_ACTION')
            if action == b'wrapper':
                require(not self.kernel.ready(self.pidfd), 'PID1_DIED_BEFORE_CANCELLATION')
                wrapper.kill()  # Only this exact retained Popen handle.

    # Only the test's observation hook changes; production retirement/finalizer
    # runs unchanged. No build/capture/measurement function is replaced or used.
    owner.NamespaceCustody = ObservedCustody
    argv = owner.namespace_command(context_path, output)
    index = argv.index(str(SOURCE/'run.py'))
    argv[index] = str(Path(__file__).resolve())
    argv.insert(index, '-B')  # sudo may reset the job environment.
    try:
        owner.finalize_namespace(argv, clean_environment(output, output), output, SOURCE, context)
    except RuntimeError:
        # Wrapper cancellation is expected to fail the evidence workload. The
        # driver requires real death proof and the original terminal disposition.
        return
    raise RuntimeError('CANCELLATION_FIXTURE_UNEXPECTED_SUCCESS')


def classify(case, admitted, controller_dead, controller_exit, pid1_dead, wrapper_dead, forced, terminal, manifest):
    if not pid1_dead or not wrapper_dead:
        return 'UNRESOLVED'
    if not admitted or not controller_dead or forced:
        return 'FAIL'
    if controller_exit != (-signal.SIGKILL if case == 'controller' else 0):
        return 'FAIL'
    if case == 'wrapper':
        retirement = (terminal or {}).get('namespace_retirement', {})
        if not (terminal and terminal['state'] == 'FAIL' and terminal['artifacts_stable'] and
                retirement.get('state') == 'RETIRED' and retirement.get('pid1_death_verified') and
                retirement.get('first_error') is None and manifest):
            return 'FAIL'
    elif terminal is not None or manifest:
        return 'FAIL'  # Killed controller must not have finalized a live workload.
    return 'PASS_REAL_CUSTODY_ONLY'


def one_case(case, output):
    output.mkdir(mode=0o700)
    context = {'uid': os.getuid(), 'gid': os.getgid(), 'control': os.environ['EXPECTED_CONTROL'],
        'controller_pid': None, 'lifeline_nonce': uuid.uuid4().hex,
        'lifeline_socket': str(output/'lifeline.sock'),
        'host_namespaces': {name: os.stat('/proc/self/ns/'+name).st_ino for name in ('net', 'pid')}}
    context_path = output/'context.json'
    write_json(context_path, context)
    driver, peer = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    driver.settimeout(20)
    kernel, child, handles = Kernel(), None, []
    candidate = None
    admitted, forced, first = False, False, None
    pid1_dead, wrapper_dead, controller_dead = False, False, False
    write_json(output/'intent.json', {'case': case, 'workload': 'one Python sleep; no NAC', 'attempts': 1})
    try:
        with (output/'controller.stdout').open('xb') as stdout, (output/'controller.stderr').open('xb') as stderr:
            child = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--controller',
                str(context_path), '--output', str(output), '--driver-fd', str(peer.fileno())],
                env=clean_environment(output, output, {'EXPECTED_CONTROL': context['control']}),
                pass_fds=(peer.fileno(),), close_fds=True, start_new_session=True,
                stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
            peer.close()
            report, candidate = receive_fd(driver)
            require(report['kind'] == 'PID1' and report['nonce'] == context['lifeline_nonce'] and
                    report['controller'] == child.pid and child.poll() is None, 'CONTROLLER_OBSERVATION')
            require(not kernel.ready(candidate) and kernel.pid(candidate) == report['proof']['peer_host_pid'], 'PID1_OBSERVATION')
            handles.append(candidate)
            candidate = None
            admitted = report['admitted']['lifeline']['state'] == 'VERIFIED_POST_DROP'
            wrapper, candidate = receive_fd(driver)
            require(wrapper['kind'] == 'wrapper' and not kernel.ready(candidate) and
                    kernel.pid(candidate) == wrapper['pid'], 'WRAPPER_OBSERVATION')
            handles.append(candidate)
            candidate = None
            require(child.poll() is None and not any(kernel.ready(fd) for fd in handles),
                    'OWNED_WORK_DIED_BEFORE_CANCELLATION')
            write_json(output/'observed-admission.json', report)
            driver.sendall(case.encode())
            if case == 'controller':
                child.kill()
            child.wait(timeout=12)
            controller_dead = child.poll() is not None
            pid1_dead, wrapper_dead = (kernel.ready(fd, 3000) for fd in handles)
    except BaseException:
        first = 'REAL_CUSTODY_CHECK_FAILED'
    finally:
        if candidate is not None:
            os.close(candidate)  # Never signal an unverified received handle.
        if child is not None and child.poll() is None:
            child.kill()
            try:
                child.wait(timeout=3)
                controller_dead = True
            except subprocess.TimeoutExpired:
                first = first or 'CONTROLLER_EXIT_UNPROVEN'
        # Even a failed characterization retires only the observed handles.
        for fd in handles:
            if not kernel.ready(fd):
                forced = True
                try:
                    kernel.kill(fd)
                except OSError:
                    first = first or 'RETAINED_HANDLE_KILL_FAILED'
        if len(handles) == 2:
            pid1_dead, wrapper_dead = (kernel.ready(fd, 3000) for fd in handles)
        terminal_path = output/'terminal.json'
        terminal = json.loads(terminal_path.read_text()) if terminal_path.exists() else None
        manifest = (output/'artifact-manifest.json').exists()
        controller_exit = child.poll() if child is not None else None
        state = classify(case, admitted and first is None, controller_dead, controller_exit, pid1_dead,
                         wrapper_dead, forced, terminal, manifest)
        result = {'state': state, 'case': case, 'first_error': first, 'admitted': admitted,
            'controller_dead': controller_dead, 'controller_exit': controller_exit, 'pid1_dead': pid1_dead, 'wrapper_dead': wrapper_dead,
            'forced_driver_cleanup': forced, 'owner_terminal': terminal, 'owner_manifest': manifest,
            'no_driver_artifact_hashing': True, 'attempts': 1}
        write_json(output/'case-result.json', result)
        for fd in handles:
            os.close(fd)
        driver.close()
        peer.close()
    return result


def main():
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--namespace-init', type=Path)
    parser.add_argument('--controller', type=Path)
    parser.add_argument('--driver-fd', type=int)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.namespace_init:
        return payload(args.namespace_init, args.output)
    if args.controller:
        return controller(args.controller, args.output, args.driver_fd)
    require(platform.system() == 'Linux' and os.environ.get('GITHUB_ACTIONS') == 'true', 'LINUX_ACTIONS_ONLY')
    mode, control = os.environ['EVIDENCE_MODE'], os.environ['EXPECTED_CONTROL']
    require(mode in (MODE, CUSTODY_MODE), 'CUSTODY_SELECTOR')
    validate_request(control, os.environ.get('GITHUB_EVENT_NAME'), os.environ.get('GITHUB_REF'),
        mode, HEAD, TREE, BASELINE, expected_mode=mode)
    validate_event(json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()), mode, control, expected_mode=mode)
    require(owner.git(SOURCE, 'rev-parse', 'HEAD') == control and os.environ['GITHUB_SHA'] == control and
            owner.git(SOURCE, 'status', '--porcelain') == '', 'CONTROL_REVISION')
    require(all(sha256(SOURCE/name) == digest for name, digest in OWNER_HASHES.items()), 'REVIEWED_OWNER_CHANGED')
    args.output.mkdir(mode=0o700)
    results = []
    for case in ('controller', 'wrapper'):
        result = one_case(case, args.output/case)
        results.append(result)
        write_json(args.output/'custody-check.json', {'results': results, 'kernel_check_only': True})
        require(result['state'] == 'PASS_REAL_CUSTODY_ONLY', 'REAL_CUSTODY_GATE_FAILED')


if __name__ == '__main__':
    main()
