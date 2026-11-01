#!/usr/bin/env python3
"""One manual Linux source-bound capture pair, then one exclusive owner measurement."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import time

from contract import (ASSETS, BASELINE, HEAD, MODE, TEST, TREE, artifact_manifest,
                      measurement_rows, require, sha256, test_executable,
                      validate_event, validate_request, verify_pair, write_json)
from owned_process import clean_environment, interrupt, reap_namespace, run_owned

SOURCE = Path(__file__).resolve().parent


def git(product, *args):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(product), *args],
                                   text=True, timeout=10).strip()


def verify_product(product):
    require(product.is_dir() and git(product, 'rev-parse', 'HEAD') == HEAD, 'PRODUCT_HEAD')
    require(git(product, 'rev-parse', 'HEAD^{tree}') == TREE, 'PRODUCT_TREE')
    require(git(product, 'status', '--porcelain') == '', 'PRODUCT_DIRTY')
    require(git(product, 'rev-parse', HEAD+':crates/nac-server/assets/dist') == ASSETS, 'PRODUCT_ASSETS')
    require(git(product, 'merge-base', BASELINE, HEAD) == BASELINE, 'BASELINE_ANCESTRY')


def retain_executable(source, target):
    require(source.is_file() and not source.is_symlink(), 'EXECUTABLE_SOURCE')
    with source.open('rb') as reader, target.open('xb') as writer:
        shutil.copyfileobj(reader, writer)
        writer.flush()
        os.fsync(writer.fileno())
    target.chmod(0o700)
    require(sha256(source) == sha256(target), 'EXECUTABLE_COPY')
    return {'file': str(target), 'sha256': sha256(target), 'bytes': target.stat().st_size,
            'source': str(source), 'mode': '0700'}


def namespace_command(context, output):
    # No user shell or host-setting changes. The root bootstrap only creates lo,
    # proves isolation, then drops to the original runner UID before product work.
    return ['sudo', '-n', '--', 'unshare', '--net', '--pid', '--fork', '--mount', '--mount-proc',
            '--kill-child=SIGKILL', sys.executable, str(SOURCE/'run.py'),
            '--namespace-init', str(context), '--output', str(output)]


def bootstrap_namespace(context):
    require(os.getpid() == 1 and os.geteuid() == 0, 'PRIVATE_ROOT_INIT_REQUIRED')
    actual = {name: os.stat('/proc/self/ns/'+name).st_ino for name in ('net', 'pid')}
    require(all(actual[name] != context['host_namespaces'][name] for name in actual), 'NAMESPACE_NOT_DISTINCT')
    child = subprocess.Popen(['ip', 'link', 'set', 'lo', 'up'], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    try:
        code = child.wait(timeout=5)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=3)
    require(code == 0, 'LOOPBACK_BOOTSTRAP')
    require(sorted(name for _, name in socket.if_nameindex()) == ['lo'], 'NON_LOOPBACK_INTERFACE')
    uid, gid = context['uid'], context['gid']
    require(type(uid) is int and uid > 0 and type(gid) is int and gid >= 0, 'RUNNER_IDENTITY')
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    require(os.geteuid() == uid and os.getegid() == gid, 'PRIVILEGE_DROP')
    return {'pid1': True, 'distinct_net_pid': actual, 'interfaces': ['lo'],
            'bootstrap_child_exit': code, 'product_uid': uid, 'product_gid': gid,
            'egress': 'private network namespace has loopback only; no host interface or default-route fallback'}


def resource_sample():
    return {'loadavg': Path('/proc/loadavg').read_text().strip(),
            'memory': {line.split(':', 1)[0]: line.split(':', 1)[1].strip()
                       for line in Path('/proc/meminfo').read_text().splitlines()
                       if line.startswith(('MemAvailable:', 'SwapFree:', 'SwapTotal:'))},
            'interpretation': 'Hosted VM observations; background/physical-neighbor competition unknown'}


def inside(context_file, output):
    context = json.loads(context_file.read_text())
    namespace = bootstrap_namespace(context)
    os.environ.clear()
    os.environ.update(context['tool_environment'])
    product = Path(context['product'])
    deadline = time.monotonic()+1200
    first_error = None
    result = {'state': 'FAIL', 'control': context['control'], 'head': HEAD, 'tree': TREE,
              'baseline': BASELINE, 'namespace': namespace, 'runtime_attempts': 1,
              'live_vendor': False, 'functional_six': 'Consumed existing CI, not rerun',
              'pixel_inspection': 'PENDING original PNG review'}
    for name in ('home', 'tmp', 'bin', 'perf-tmp'):
        (output/name).mkdir(mode=0o700)
    build = output.parent/(output.name+'-build')
    build.mkdir(mode=0o700)
    environment = clean_environment(output/'home', output/'tmp', {
        'CARGO_TARGET_DIR': str(build), 'CARGO_PROFILE_DEV_DEBUG': '0',
        'CARGO_PROFILE_TEST_DEBUG': '0', 'PLAYWRIGHT_BROWSERS_PATH': context['browsers']})

    def phase(label, argv, bound, env=None):
        remaining = min(bound, deadline-time.monotonic()-12)
        require(remaining > 0, 'ACTIVE_DEADLINE')
        return run_owned(argv, product, env or environment, output, label, remaining)

    try:
        write_json(output/'namespace.json', namespace)
        verify_product(product)
        phase('build-product', ['cargo', 'build', '--locked', '--offline', '-p', 'nac-server', '--bin', 'nac-web'], 720)
        phase('build-measurement', ['cargo', 'test', '--locked', '--offline', '-p', 'nac-server', '--lib',
                                  '--no-run', '--message-format=json'], 720)
        production = output/'bin/nac-web'
        measurement = output/'bin/heartbeat-measurement'
        result['binary'] = retain_executable(build/'debug/nac-web', production)
        executable = test_executable((output/'build-measurement.stdout').read_text())
        require(executable.is_relative_to(build), 'TEST_EXECUTABLE_OUTSIDE_BUILD')
        result['measurement_binary'] = retain_executable(executable, measurement)
        verify_product(product)
        phase('capture-pair', ['node', SOURCE/'capture.mjs'], 150, {
            **environment, 'NAC_CAPTURE_WORKTREE': str(product), 'NAC_CAPTURE_OUTPUT': str(output/'visual'),
            'NAC_CAPTURE_BINARY': str(production), 'NAC_CAPTURE_HEAD': HEAD})
        result['original_pngs'] = verify_pair(output/'visual')
        settled = reap_namespace()
        write_json(output/'capture-namespace-settlement.json', settled)
        require(not settled['remaining'], 'CAPTURE_CHILDREN_REMAIN')
        require(not list((output/'perf-tmp').iterdir()), 'PERF_TMP_NOT_EMPTY')
        result['resources_before_measurement'] = resource_sample()
        # No compile, browser, other NAC process or parallel invocation survives
        # into this single measurement, under the outer exclusive lock.
        phase('measurement', [measurement, TEST, '--ignored', '--exact', '--nocapture', '--test-threads=1'], 180,
              {**environment, 'TMPDIR': str(output/'perf-tmp')})
        result['measurement'] = measurement_rows((output/'measurement.stdout').read_text())
        result['resources_after_measurement'] = resource_sample()
        leftovers = sorted(file.name for file in (output/'perf-tmp').iterdir())
        write_json(output/'performance-fixture-cleanup.json', {'remaining': leftovers, 'automatic_delete': False})
        require(not leftovers, 'PERFORMANCE_FIXTURE_RETAINED')
        verify_product(product)
        result['state'] = 'PASS_SOURCE_BOUND_PAIR_AND_MEASUREMENT; PIXEL_REVIEW_PENDING'
    except BaseException as error:
        code = str(error)
        first_error = code if isinstance(error, RuntimeError) and re.fullmatch('[A-Z][A-Z0-9_]{0,63}', code) else 'EVIDENCE_PHASE_FAILED'
    finally:
        settlement = reap_namespace()
        result['namespace_settlement'] = settlement
        if settlement['remaining']:
            first_error = first_error or 'NAMESPACE_CHILDREN_REMAIN'
        if first_error:
            result['state'] = 'FAIL'
        result['first_error'] = first_error
        result['limits'] = ['Not physical-host exclusivity or a cross-platform SLA',
                            'Not live-vendor, release binary throughput or Darwin native compatibility',
                            'Private namespace retirement is not all-host process closure']
        write_json(output/'evidence.json', result)
    return 90 if first_error else 0


def outside(args):
    validate_request(args.control, os.environ.get('GITHUB_EVENT_NAME'), os.environ.get('GITHUB_REF'),
                     args.mode, args.head, args.tree, args.baseline)
    validate_event(json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()), args.mode, args.control)
    require(platform.system() == 'Linux' and os.environ.get('GITHUB_ACTIONS') == 'true', 'LINUX_ACTIONS_ONLY')
    require(os.environ.get('GITHUB_SHA') == args.control and git(SOURCE, 'rev-parse', 'HEAD') == args.control,
            'CONTROL_REVISION')
    product, output = args.product.resolve(), args.output.resolve()
    verify_product(product)
    require(not product.is_relative_to(output) and not output.is_relative_to(product), 'OUTPUT_OWNERSHIP')
    output.mkdir(mode=0o700)
    first_error = None
    # One evidence lane job owns this VM. Serialize its only child workload;
    # this is not a claim to control unrelated host/hypervisor activity.
    with (output.parent/'heartbeat-evidence.lock').open('x+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        lock.write(str(os.getpid())+'\n')
        lock.flush()
        context = {'control': args.control, 'product': str(product), 'uid': os.getuid(), 'gid': os.getgid(),
                   'host_namespaces': {name: os.stat('/proc/self/ns/'+name).st_ino for name in ('net', 'pid')},
                   'browsers': os.environ['PLAYWRIGHT_BROWSERS_PATH'],
                   'tool_environment': clean_environment(output.parent, output.parent)}
        context_file = output/'context.json'
        write_json(context_file, context)
        environment = clean_environment(output.parent, output.parent)
        # Setup completed before this controller. No credential-bearing host
        # environment is inherited by sudo, product, capture or model fixtures.
        try:
            run_owned(namespace_command(context_file, output), SOURCE, environment, output, 'private-namespace', 1260)
            result = json.loads((output/'evidence.json').read_text())
            require(result['state'].startswith('PASS_') and result['namespace']['pid1'], 'NAMESPACE_RESULT')
            verify_product(product)
        except BaseException:
            first_error = 'FINITE_EVIDENCE_FAILED'
        finally:
            write_json(output/'terminal.json', {'state': 'FAIL' if first_error else 'PASS_EVIDENCE_RETAINED',
                'first_error': first_error, 'control': args.control, 'head': HEAD, 'tree': TREE,
                'baseline': BASELINE, 'attempts': 1, 'lock_owner': os.getpid(),
                'no_automatic_retry': True, 'review_original_pngs': True})
            write_json(output/'artifact-manifest.json', artifact_manifest(output))
    return 90 if first_error else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--namespace-init', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--product', type=Path)
    parser.add_argument('--control')
    parser.add_argument('--mode')
    parser.add_argument('--head', default=HEAD)
    parser.add_argument('--tree', default=TREE)
    parser.add_argument('--baseline', default=BASELINE)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    if args.namespace_init:
        return inside(args.namespace_init, args.output)
    require(args.product is not None and args.control is not None, 'EXPLICIT_INPUTS_REQUIRED')
    return outside(args)


if __name__ == '__main__':
    raise SystemExit(main())
