#!/usr/bin/env python3
"""NEVERMERGE: one separately admitted hosted normal package, never app/UI execution."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import stat
import sys
import time

BRANCH = 'refs/heads/codex/experimental-native-q-host-package-post657-p10'
SCOPE = 'p10-hosted-normal-package-only'
STOP = []
CAPS = {'rust': 3, 'node': 2, 'checkout-H': 2, 'checkout-P': 2, 'restore-cache': 2}


def need(value, reason):
    if not value:
        raise RuntimeError(reason)


def admit(value, env, *, now=None):
    need(set(value) == {'scope', 'controller_sha', 'allocation_id', 'attempt', 'retries', 'clock'}, 'exact admission keys')
    need(value['scope'] == SCOPE and value['controller_sha'] == env['GITHUB_SHA']
         and re.fullmatch('[0-9a-f]{40}', value['controller_sha']), 'frozen controller')
    need(re.fullmatch('[A-Za-z0-9_-]{1,100}', value['allocation_id'])
         and type(value['attempt']) is int and value['attempt'] == 1
         and type(value['retries']) is int and value['retries'] == 0, 'one named allocation, no retry')
    need(env.get('GITHUB_REF') == BRANCH and env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
         and env.get('GITHUB_RUN_ATTEMPT') == '1', 'exact experimental first dispatch')
    clock = value['clock']
    keys = ('STARTED', 'WORK_DEADLINE', 'CLEANUP_DEADLINE', 'HARD_DEADLINE')
    need(set(clock) == set(keys) and all(type(clock[k]) in (int, float) for k in keys), 'numeric original clock')
    start, work, cleanup, hard = [clock[k] for k in keys]
    stamp = time.time() if now is None else now
    need(all(math.isfinite(x) for x in (start, work, cleanup, hard, stamp))
         and start <= stamp < work < cleanup < hard and hard-start <= 2400
         and work-start <= 1800 and cleanup-work >= 480 and hard-cleanup >= 120,
         'original <=40m total/<=30m work/>=8m cleanup/>=2m retention')
    return start, work, cleanup, hard


def minutes(value, env, cap, *, now=None, retention=False):
    stamp = time.time() if now is None else now
    if retention:
        clock = value['clock']
        hard = clock['HARD_DEADLINE']
        need(type(hard) in (int, float) and math.isfinite(hard), 'finite retention')
        return max(0, min(2, math.floor((hard-stamp-15)/60)))
    _, work, _, _ = admit(value, env, now=stamp)
    need(type(cap) is int and 1 <= cap <= 3, 'fixed bootstrap cap')
    result = min(cap, math.floor((work-stamp-60)/60))
    need(result >= 1, 'original bootstrap allowance exhausted')
    return result


def capacity(memory, disk, cpus):
    need(all(type(x) is int for x in (memory, disk, cpus))
         and memory >= 6*1024**3 and disk >= 8*1024**3 and cpus >= 2,
         'host capacity unknown/below6GiB memory,8GiB free,2CPU; no deletion/fallback')


def cache_ready(target, before, admission, remaining, hit):
    need(before.get('status') == 'PASS' and before.get('target_absent') is True
         and before.get('target') == str(target)
         and before.get('controller_sha') == admission['controller_sha']
         and before.get('allocation_id') == admission['allocation_id']
         and before.get('original_clock') == admission['clock'], 'fresh source/allocation-bound cache restore required')
    need(hit in ('true', 'false'), 'cache action result unknown')
    need(type(remaining) in (int, float) and math.isfinite(remaining) and remaining >= 1530,
         'original work needs1080 engine+390 downstream+60 handoff; no cold/short retry')
    deps = target/'aarch64-apple-darwin/release/deps'
    need(target.is_absolute() and deps.resolve() == deps and deps.is_dir(), 'restored release deps absent/aliased')
    engine = deps.parent/'nac-web'
    need(not engine.exists() and not engine.is_symlink(), 'cached engine is not an exact-source nomination')
    count, size = 0, 0
    for entry in deps.iterdir():
        if entry.name.endswith('.rlib'):
            info = entry.lstat()
            need(stat.S_ISREG(info.st_mode) and info.st_size > 0, 'invalid restored dependency')
            count += 1
            size += info.st_size
            need(count <= 4096, 'bounded dependency inventory')
    need(count > 0, 'true cache miss: no restored release dependencies; stop before producer')
    return dict(exact_hit=hit == 'true', restored_release_rlibs=count, bytes=size,
                remaining_work_seconds=remaining, downstream_reserve_seconds=450,
                workspace_incremental_used=False, cache_saved=False)


def plan(product, output):
    owner = str(product/'desktop/macos/packaging/package.py')
    engine, normal, relocated = [output/x for x in ('engine', 'normal', 'relocation')]
    return [('prepare-engine', 1080, [sys.executable, '-B', owner, 'prepare-engine', '--track', 'dev', '--output', str(engine)]),
            ('normal', 180, [sys.executable, '-B', owner, 'normal', '--engine-receipt', str(engine/'engine-build.json'), '--output', str(normal)]),
            ('verify', 60, [sys.executable, '-B', owner, 'verify', str(normal/'manifest.json'), '--signatures']),
            ('relocate-check', 90, [sys.executable, '-B', owner, 'relocate-check', '--manifest', str(normal/'manifest.json'), '--output', str(relocated)])]


class PackageClock:
    """SDK2cee adapter to maintained Bound/ci.run; no process supervisor/timer."""
    def __init__(self, epochs, Bound, runtime_deadline, *, monotonic=time.monotonic, wall=time.time):
        self.monotonic, self.wall = monotonic, wall
        self.mono, self.epoch = monotonic(), wall()
        self.failed = []
        _, work, cleanup, hard = epochs
        self.work = Bound(self, min(runtime_deadline, self.mono+work-self.epoch), 'work')
        self.cleanup = Bound(self, self.mono+cleanup-self.epoch, 'cleanup')
        self.retention = Bound(self, self.mono+hard-self.epoch, 'retention')

    def fail(self, reason):
        if reason not in self.failed:
            self.failed.append(reason)

    def observe(self):
        before, epoch, after = self.monotonic(), self.wall(), self.monotonic()
        if (not all(math.isfinite(x) for x in (before, epoch, after)) or after < before
                or not self.epoch+before-self.mono-1 <= epoch <= self.epoch+after-self.mono+1):
            self.fail('clock discontinuity/unknown')
        if STOP:
            self.fail('stop requested')
        need(not self.failed, 'original work clock latched: '+', '.join(self.failed))


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def write(path, value):
    data = (json.dumps(value, indent=2)+'\n').encode()
    need(len(data) <= 256*1024, 'bounded receipt')
    path.write_bytes(data)


def inspect_only(pair, product, output):
    source = product/'desktop/macos/startup_xctest/contract.py'
    need(digest(source) == pair['q_contract_sha256'] and
         digest(product/'desktop/macos/startup_xctest/StartupJourneys.swift') == pair['q_swift_sha256'], 'exact current Q source')
    spec = importlib.util.spec_from_file_location('Q_package_only', source)
    contract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(contract)
    proof = contract.inspect_normal_package(str(output/'normal/manifest.json'),
        str(output/'relocation/Relocated App With Spaces/NAC.app'), str(product), product_sha=pair['P'])
    write(output/'raw/Q-package-admission.json', dict(scope='normal_package_admission_only',
        Q=pair['Q'], proof=proof, actual_UI=False, H_pins_or_runtime_qualified=False))


def main():
    admission = json.loads(os.environ['ROOT_PACKAGE_ADMISSION'])
    epochs = admit(admission, os.environ)
    pair = json.loads(Path(__file__).with_name('pair.json').read_text())
    controller = Path(__file__).resolve().parents[3]
    tools, product, output = [Path(os.environ[k]) for k in ('H_ROOT', 'P_ROOT', 'OUTPUT_ROOT')]
    roots = [controller, tools, product, output]
    need(all(x.is_absolute() and x.resolve() == x for x in roots) and
         not any(a == b or a.is_relative_to(b) or b.is_relative_to(a)
                 for i, a in enumerate(roots) for b in roots[i+1:]), 'disjoint canonical roots')
    need(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'Darwin ARM64 only')
    if sys.argv[1:] == ['--inspect']:
        inspect_only(pair, product, output)
        return
    need(not sys.argv[1:] and not output.exists() and output.parent.is_dir(), 'absent owned output/no arbitrary command')
    output.mkdir(mode=0o700)
    raw, handoff = output/'raw', output/'handoff'
    raw.mkdir(mode=0o700)
    handoff.mkdir(mode=0o700)
    report = dict(status='FAIL', scope=SCOPE, admission=admission, pair=pair, producer_attempts=0,
                  runtime=False, SDK_actor=False, retries=0, phases=[])
    write(handoff/'host-package.json', report)
    sys.path.insert(0, str(tools/'desktop/macos'))
    import ci
    from ci_paths_budget import Bound, using
    from ci_qualifications import require_checkout
    from ci_support import qualify_toolchain, export_evidence, redact_values
    from ci_xctest import runner_environment
    budget = PackageClock(epochs, Bound, ci.RUN_DEADLINE)
    ci.RUN_DEADLINE = min(ci.RUN_DEADLINE, budget.work.deadline)

    def save():
        with using(budget.retention):
            write(raw/'host-package.json', report)

    def observe_capacity():
        memory = int(ci.command(['sysctl', '-n', 'hw.memsize']))
        cpus = int(ci.command(['sysctl', '-n', 'hw.logicalcpu']))
        free = shutil.disk_usage(output).free
        report.setdefault('capacity', []).append(dict(epoch=time.time(), memory=memory, cpus=cpus, free=free))
        capacity(memory, free, cpus)
        size = sum(x.stat().st_size for x in output.rglob('*') if x.is_file())
        need(size <= 512*1024**2, 'private outputs exceed512MiB; retain and stop')
        need(os.environ.get('ImageVersion') == pair['host_image'], 'actual image drift')

    base = runner_environment()
    for key in tuple(base):
        if key.startswith(('NAC_', 'CARGO_', 'RUST', 'GIT_')):
            del base[key]
    base.update(CARGO_BUILD_JOBS='2', CARGO_TARGET_DIR=str(product.parent/'target'),
                CARGO_PROFILE_RELEASE_CODEGEN_UNITS='16', CARGO_INCREMENTAL='0',
                GIT_OPTIONAL_LOCKS='0', RUSTUP_AUTO_INSTALL='0', RUSTUP_TOOLCHAIN=pair['rust_version'])

    def run(label, argv, root, cap):
        phase = dict(label=label, argv=argv, status='RUNNING', started_epoch=time.time())
        report['phases'].append(phase)
        save()
        try:
            with using(budget.work):
                observe_capacity()
                log = raw/(label+'.log')
                ci.run(argv, log, cap, cwd=root, env=base, abort=lambda: bool(STOP))
                ownership = json.loads(log.with_name(log.name+'.ownership.json').read_text())
                need(ownership['accepted'] and ownership['reaped'] and ownership['drain_settled']
                     and not ownership['unknown'] and ownership['teardown_error'] is None, 'positive helper custody required')
                observe_capacity()
            phase['status'] = 'PASS'
        finally:
            phase['ended_epoch'] = time.time()
            if phase['status'] != 'PASS':
                phase['status'] = 'FAIL'
            save()

    try:
        with using(budget.work):
            need(pair['scope'] == SCOPE, 'fixed pair scope')
            for root, sha in [(controller, admission['controller_sha']), (tools, pair['H_tools']), (product, pair['P'])]:
                require_checkout(root, sha)
            actual = dict(developer_directory=os.environ.get('DEVELOPER_DIR'), xcode=ci.command(['xcodebuild', '-version']),
                sdk=ci.command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']), swift=ci.command(['xcrun', 'swiftc', '--version']),
                image=os.environ.get('ImageVersion'), os_version=ci.command(['sw_vers', '-productVersion']),
                os_build=ci.command(['sw_vers', '-buildVersion']))
            report['toolchain'] = actual
            save()
            qualify_toolchain(actual, json.loads((tools/'desktop/macos/ci-toolchain.json').read_text()))
            need(ci.command(['rustc', '--version']).split()[1] == pair['rust_version']
                 and ci.command(['node', '--version']) == pair['node_version'], 'pinned bootstrap tools')
        for label, root in [('H-tools-setup', tools), ('P-setup', product)]:
            run(label, ['make', 'setup'], root, 300)
        with using(budget.work):
            gate = Path(os.environ['RUNNER_TEMP'])/'ff8-host-package-gate/clock-restore-cache.json'
            report['cache'] = cache_ready(Path(base['CARGO_TARGET_DIR']), json.loads(gate.read_text()),
                admission, budget.work.deadline-budget.monotonic(), os.environ.get('PACKAGE_CACHE_HIT'))
            observe_capacity()
        report['producer_attempts'] = 1
        save()
        for label, cap, argv in plan(product, output):
            run(label, argv, product, cap)
        run('Q-inspection', [sys.executable, '-B', str(Path(__file__).resolve()), '--inspect'], product, 60)
        with using(budget.work):
            manifest = output/'normal/manifest.json'
            data = json.loads(manifest.read_text())
            name = data['container']['name']
            need(Path(name).name == name and name.endswith('.zip'), 'one original producer container')
            archive = manifest.parent/name
            need(digest(archive) == data['container']['sha256'], 'actual original ZIP hash')
            for f in (manifest, archive):
                shutil.copyfile(f, handoff/f.name)
                need(digest(f) == digest(handoff/f.name), 'unedited artifact handoff')
            report['handoff'] = {f.name:dict(sha256=digest(f), bytes=f.stat().st_size) for f in (manifest, archive)}
            observe_capacity()
            for root, sha in [(controller, admission['controller_sha']), (tools, pair['H_tools']), (product, pair['P'])]:
                require_checkout(root, sha)
            need(not budget.failed and not STOP, 'latched failure cannot pass')
            report['status'] = 'PASS'
    except BaseException as error:
        report.update(error_type=type(error).__name__, error=str(error)[-2048:])
        raise
    finally:
        report.update(ended_epoch=time.time(), clock_failures=budget.failed, stop_signals=STOP)
        save()
        with using(budget.retention):
            export_evidence(raw, handoff/'receipts', [*redact_values(), (str(product), '<P>'), (str(tools), '<H-tools>')],
                            include_hashes=True, strict_json=True, essential_first=True)
            need(sum(f.stat().st_size for f in (handoff/'receipts').rglob('*') if f.is_file()) <= 8*1024**2, 'metadata8MiB cap')
            write(handoff/'host-package.json', report)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--bootstrap-budget':
        phase = sys.argv[2]
        need(phase in CAPS, 'fixed bootstrap phase')
        receipt = dict(phase=phase, status='FAIL', observed_epoch=time.time())
        try:
            value = json.loads(os.environ['ROOT_PACKAGE_ADMISSION'])
            n = minutes(value, os.environ, CAPS[phase])
            if phase == 'restore-cache':
                target = Path(os.environ['GITHUB_WORKSPACE'])/'target'
                need(target.is_absolute() and target.resolve() == target
                     and not target.exists() and not target.is_symlink(), 'cache target must be fresh job-owned sibling')
                receipt.update(target=str(target), target_absent=True, controller_sha=value['controller_sha'],
                               allocation_id=value['allocation_id'])
            receipt.update(status='PASS', original_clock=value['clock'], minutes=n)
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('minutes='+str(n)+'\n')
        finally:
            write(Path(os.environ['RUNNER_TEMP'])/'ff8-host-package-gate'/('clock-'+phase+'.json'), receipt)
    else:
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda number, frame: STOP.append(number))
        main()
