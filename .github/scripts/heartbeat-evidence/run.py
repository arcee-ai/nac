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
import uuid

from contract import (ASSETS, BASELINE, HEAD, MODE, TEST, TREE, artifact_manifest,
                      measurement_inventory, measurement_rows, require, sha256, test_executable,
                      validate_event, validate_request, verify_pair, write_json)
from owned_process import clean_environment, interrupt, reap_namespace, run_owned
from namespace_custody import Lifeline, NamespaceCustody, execute_namespace
import calendar_cost

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
    # unshare's inherited parent-death signal is cleared by this UID/GID drop.
    # No product operation is admitted until a post-drop lifeline is verified.
    lifeline = Lifeline(context)
    try:
        require(lifeline.proof['state'] == 'VERIFIED_POST_DROP', 'LIFELINE_NOT_VERIFIED')
    except BaseException:
        lifeline.close()
        raise
    return {'pid1': True, 'distinct_net_pid': actual, 'interfaces': ['lo'],
            'bootstrap_child_exit': code, 'product_uid': uid, 'product_gid': gid,
            'lifeline': lifeline.proof,
            'egress': 'private network namespace has loopback only; no host interface or default-route fallback'}, lifeline


def resource_sample():
    return {'loadavg': Path('/proc/loadavg').read_text().strip(),
            'memory': {line.split(':', 1)[0]: line.split(':', 1)[1].strip()
                       for line in Path('/proc/meminfo').read_text().splitlines()
                       if line.startswith(('MemAvailable:', 'SwapFree:', 'SwapTotal:'))},
            'interpretation': 'Hosted VM observations; background/physical-neighbor competition unknown'}


def safe_error(error):
    code = str(error)
    return code if isinstance(error, RuntimeError) and re.fullmatch('[A-Z][A-Z0-9_]{0,63}', code) else 'EVIDENCE_PHASE_FAILED'


def final_checks(result, product, output, measurement_started, verifier=None):
    """Attempt every final check; preserve the original failure and each cleanup error."""
    errors = []
    labels = (['post-measurement-resources', 'performance-fixture-cleanup'] if measurement_started else [])
    for label in labels+['final-product-verification']:
        proof = {'state': 'FAIL', 'first_error': None}
        try:
            if label == 'post-measurement-resources':
                proof['resources'] = resource_sample()
                result['resources_after_measurement'] = proof['resources']
            elif label == 'performance-fixture-cleanup':
                proof.update(remaining=sorted(file.name for file in (output/'perf-tmp').iterdir()),
                             automatic_delete=False)
                require(not proof['remaining'], 'PERFORMANCE_FIXTURE_RETAINED')
            else:
                (verifier or verify_product)(product)
                if verifier is None:
                    proof.update(head=HEAD, tree=TREE, assets=ASSETS)
                else:
                    proof.update(head=calendar_cost.HEAD, tree=calendar_cost.TREE)
            proof['state'] = 'PASS'
        except BaseException as error:
            proof['first_error'] = safe_error(error)
            errors.append({'check': label, 'code': proof['first_error']})
        try:
            write_json(output/(label+'.json'), proof)
        except BaseException:
            errors.append({'check': label, 'code': 'FINAL_CHECK_RECEIPT_FAILED'})
    return errors


def inside(context_file, output):
    context = json.loads(context_file.read_text())
    namespace, lifeline = bootstrap_namespace(context)
    try:
        if context.get('mode') == calendar_cost.MODE:
            return calendar_cost.workload(context, output, namespace, retain_executable, final_checks, git, resource_sample)
        return workload(context, output, namespace)
    finally:
        lifeline.close()


def workload(context, output, namespace):
    os.environ.clear()
    os.environ.update(context['tool_environment'])
    product = Path(context['product'])
    deadline = time.monotonic()+1200
    first_error = None
    measurement_started = False
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
        phase('measurement-inventory', [measurement, '--list'], 20)
        require(sha256(measurement) == result['measurement_binary']['sha256'], 'MEASUREMENT_BINARY_CHANGED')
        inventory = measurement_inventory((output/'measurement-inventory.stdout').read_text())
        result['measurement_inventory'] = {**inventory, 'binary_sha256': sha256(measurement)}
        write_json(output/'measurement-inventory.json', result['measurement_inventory'])
        result['resources_before_measurement'] = resource_sample()
        # No compile, browser, other NAC process or parallel invocation survives
        # into this single measurement, under the outer exclusive lock.
        measurement_started = True
        phase('measurement', [measurement, TEST, '--ignored', '--exact', '--nocapture', '--test-threads=1'], 180,
              {**environment, 'TMPDIR': str(output/'perf-tmp')})
        result['measurement'] = measurement_rows((output/'measurement.stdout').read_text(), inventory)
        result['state'] = 'PASS_SOURCE_BOUND_PAIR_AND_MEASUREMENT; PIXEL_REVIEW_PENDING'
    except BaseException as error:
        first_error = safe_error(error)
    finally:
        errors = final_checks(result, product, output, measurement_started)
        try:
            settlement = reap_namespace()
        except BaseException:
            settlement = {'remaining': 'UNKNOWN'}
            errors.append({'check': 'namespace-settlement', 'code': 'NAMESPACE_SETTLEMENT_FAILED'})
        result['namespace_settlement'] = settlement
        if settlement['remaining']:
            errors.append({'check': 'namespace-settlement', 'code': 'NAMESPACE_CHILDREN_REMAIN'})
        result['cleanup_errors'] = errors
        result['measurement_attempted'] = measurement_started
        first_error = first_error or (errors[0]['code'] if errors else None)
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
                     args.mode, args.head, args.tree, args.baseline,
                     expected_mode=args.mode if args.mode == calendar_cost.MODE else MODE)
    validate_event(json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()), args.mode, args.control,
                   expected_mode=args.mode if args.mode == calendar_cost.MODE else MODE)
    require(platform.system() == 'Linux' and os.environ.get('GITHUB_ACTIONS') == 'true', 'LINUX_ACTIONS_ONLY')
    require(os.environ.get('GITHUB_SHA') == args.control and git(SOURCE, 'rev-parse', 'HEAD') == args.control,
            'CONTROL_REVISION')
    product, output = args.product.resolve(), args.output.resolve()
    if args.mode == calendar_cost.MODE:
        calendar_cost.verify_product(product, git)
    else:
        verify_product(product)
    require(not product.is_relative_to(output) and not output.is_relative_to(product), 'OUTPUT_OWNERSHIP')
    output.mkdir(mode=0o700)
    # One evidence lane job owns this VM. Serialize its only child workload;
    # this is not a claim to control unrelated host/hypervisor activity.
    with (output.parent/'heartbeat-evidence.lock').open('x+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        lock.write(str(os.getpid())+'\n')
        lock.flush()
        context = {'control': args.control, 'product': str(product), 'uid': os.getuid(), 'gid': os.getgid(),
                   'controller_pid': os.getpid(), 'lifeline_nonce': uuid.uuid4().hex,
                   'lifeline_socket': str(output/'lifeline.sock'),
                   'host_namespaces': {name: os.stat('/proc/self/ns/'+name).st_ino for name in ('net', 'pid')},
                   'browsers': os.environ['PLAYWRIGHT_BROWSERS_PATH'],
                   'tool_environment': clean_environment(output.parent, output.parent)}
        if args.mode == calendar_cost.MODE:
            context['mode'] = calendar_cost.MODE
        context_file = output/'context.json'
        write_json(context_file, context)
        environment = clean_environment(output.parent, output.parent)
        # Setup completed before this controller. No credential-bearing host
        # environment is inherited by sudo, product, capture or model fixtures.
        finalize_namespace(namespace_command(context_file, output), environment, output, product, context)
    return 0


def finalize_namespace(argv, environment, output, product, context):
    """Wrapper receipts never qualify PID1 death or stable artifact contents."""
    first_error = None
    retirement = {'state': 'UNRESOLVED', 'first_error': 'CUSTODY_NOT_ESTABLISHED'}
    custody = None
    try:
        custody = NamespaceCustody(context)
        first_error, retirement = execute_namespace(argv, SOURCE, environment, output, custody, run_owned)
        require(not first_error, first_error or 'FINITE_EVIDENCE_FAILED')
        result = json.loads((output/'evidence.json').read_text())
        require(result['state'].startswith('PASS_') and result['namespace']['pid1'], 'NAMESPACE_RESULT')
        if context.get('mode') == calendar_cost.MODE:
            calendar_cost.verify_product(product, git)
        else:
            verify_product(product)
    except BaseException:
        first_error = first_error or 'FINITE_EVIDENCE_FAILED'
    finally:
        if custody is not None:
            custody.close()
        retired = retirement['state'] == 'RETIRED'
        cost_mode = context.get('mode') == calendar_cost.MODE
        write_json(output/'terminal.json', {
            'state': 'UNRESOLVED' if not retired else ('FAIL' if first_error else 'PASS_EVIDENCE_RETAINED'),
            'namespace_retirement': retirement, 'artifacts_stable': retired,
            'artifact_hashing': 'after verified PID1 death' if retired else 'WITHHELD: possible live writer',
            'first_error': first_error, 'control': context['control'],
            'head': calendar_cost.HEAD if cost_mode else HEAD, 'tree': calendar_cost.TREE if cost_mode else TREE,
            'baseline': '' if cost_mode else BASELINE, 'attempts': 1, 'lock_owner': os.getpid(),
            'no_automatic_retry': True, 'review_original_pngs': not cost_mode})
        if retired:
            manifest = artifact_manifest(output)
            if cost_mode:
                manifest['pixel_inspection'] = 'NOT_APPLICABLE_COST_ONLY_MODE'
            write_json(output/'artifact-manifest.json', manifest)
    require(not first_error and retired, first_error or 'NAMESPACE_RETIREMENT_UNRESOLVED')


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
