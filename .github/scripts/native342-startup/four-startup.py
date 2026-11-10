#!/usr/bin/env python3
"""NEVERMERGE experiment. Root must separately admit the exact four-case/R episode."""
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import plistlib
import re
import signal
import shutil
import stat
import sys
import time

STOP = []
BRANCH = 'refs/heads/codex/private520-request-child-C17'
SCOPE = 'P12-integration-Qrequest-child-R7325-four-startup-source17'
PURPOSE_SCOPES = {'native': SCOPE, 'build-only': SCOPE.replace('four-startup', 'signature-build-only')}
CASES = ('onboarding', 'configuredLocal', 'invalidConfig', 'futureStore')
PRODUCER = '0210a3c52062ec28e9c6ae74098040e432e09a65'
PRODUCER_BRANCH = 'codex/experimental-native-p12-lifecycle-package-20261108'
PRODUCER_RUN = 42455455480
PRODUCER_ARTIFACT = 13607980704
PRODUCER_ARTIFACT_NAME = 'ff8-host-package-42455455480-1'
MANIFEST_SHA256 = 'b1fb601ed4118029d538d0b9c673ecb927426a13651cb50a1befa279ed8cf70e'


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    require(len(data) <= 256 * 1024, 'bounded controller evidence')
    path.write_bytes(data)


def admit(value, controller_sha, *, now=None):
    """Validate a declaration; this function never issues execution authority."""
    require(set(value) == {'scope', 'purpose', 'controller_sha', 'allocation_id', 'attempt', 'retries',
                          'manifest_sha256', 'clock', 'producer'}, 'exact admission fields')
    require(type(value['purpose']) is str and value['purpose'] in PURPOSE_SCOPES
            and value['scope'] == PURPOSE_SCOPES[value['purpose']] and value['controller_sha'] == controller_sha
            and re.fullmatch('[0-9a-f]{40}', controller_sha), 'frozen controller binding')
    require(type(value['attempt']) is int and value['attempt'] == 1
            and type(value['retries']) is int and value['retries'] == 0, 'one attempt, no retries')
    require(isinstance(value['allocation_id'], str)
            and re.fullmatch('[A-Za-z0-9_-]{1,100}', value['allocation_id']), 'named Root allocation')
    require(re.fullmatch('[0-9a-f]{64}', str(value['manifest_sha256'])), 'exact retained package manifest')
    producer = value['producer']
    require(set(producer) == {'run_id', 'artifact_id', 'controller_sha', 'branch', 'artifact_name'}
            and all(type(producer[k]) is int and producer[k] > 0 for k in ('run_id', 'artifact_id'))
            and re.fullmatch('[0-9a-f]{40}', str(producer['controller_sha']))
            and re.fullmatch('codex/[A-Za-z0-9_./-]{1,150}', str(producer['branch']))
            and re.fullmatch('[A-Za-z0-9_.-]{1,200}', str(producer['artifact_name'])), 'exact named producer run/artifact/source')
    require(producer == dict(run_id=PRODUCER_RUN, artifact_id=PRODUCER_ARTIFACT, controller_sha=PRODUCER,
            branch=PRODUCER_BRANCH, artifact_name=PRODUCER_ARTIFACT_NAME)
            and value['manifest_sha256'] == MANIFEST_SHA256, 'exact genuine P12 producer and normal manifest')
    clock = value['clock']
    keys = ('STARTED', 'WORK_DEADLINE', 'CLEANUP_DEADLINE', 'HARD_DEADLINE')
    require(set(clock) == set(keys) and all(type(clock[k]) in (int, float) for k in keys),
            'exact original numeric clock')
    start, work, cleanup, hard = [clock[k] for k in keys]
    stamp = time.time() if now is None else now
    require(all(math.isfinite(x) for x in (start, work, cleanup, hard, stamp))
            and start <= stamp < work < cleanup < hard
            and 0 < hard - start <= 3600 and work - start <= 2880
            and cleanup - work >= 600 and hard - cleanup >= 120,
            'original queue-inclusive <=60m clock, <=48m work, >=10m cleanup, >=2m retention')
    return start, work, cleanup, hard


def selected_episode(startup, protocol, clock, using, *, evidence, profiles, app, manifest,
                     product, tests, protocol_root, harness_sha, package_admission, selection,
                     observer, image_reader, run, command, native_report, progress):
    """Reuse maintained R and case owners, serially; no product build or fallback."""
    require(tuple(startup.CASES) == CASES, 'exact maintained four-case order')
    cases = []
    try:
        clock.require_phase('required-R-build-and-four-records', 1155)
        with using(clock.work):
            private, runner = protocol.build(protocol_root, evidence / 'startup-protocol-runner', run,
                product=product, manifest=manifest, package_admission=package_admission)
            process = protocol.verify(private, runner, app, manifest, package_admission,
                                      evidence / 'startup-protocol', run)
        # verify owns all typed records, engine identity/digest, integrity and
        # retirement checks. A missing/failed R never reaches any UI case.
        require(isinstance(process, dict) and process.get('R') == startup.PROTOCOL_SOURCE
                and process.get('P') == startup.PRODUCT
                and tuple(row.get('scenario') for row in process.get('observations', [])) == tuple(protocol.SCENARIOS)
                and all(row.get('owner_cleanup') is True and row.get('preserved_store_config') is True
                        for row in process['observations']), 'required complete maintained R receipt')
        progress(protocol=process)
        for scenario in CASES:
            clock.require_phase('case-' + scenario, 855 if scenario == 'configuredLocal' else 615)
            progress(requested=scenario)
            folder = evidence / ('startup-' + scenario)
            with using(clock.cleanup):
                proof = startup.run_case(folder=folder, profiles=profiles, scenario=scenario, app=app,
                    manifest=manifest, product=product, tests=tests, harness_sha=harness_sha,
                    selection=selection, observer=observer, image_reader=image_reader,
                    run=run, command=command, native_report=native_report)
            require(proof.get('scenario') == scenario and proof.get('passed') is True
                    and proof.get('public_test_requested') is True
                    and proof.get('input_completion_unknown') is False
                    and proof.get('attachments_complete') is True
                    and all(key in proof for key in ('image', 'actual_result', 'integrity', 'provider'))
                    and (scenario not in ('onboarding', 'configuredLocal') or 'live_api' in proof)
                    and (scenario != 'configuredLocal' or 'persisted_api' in proof)
                    and proof.get('cleanup', {}).get('owned_processes_settled') is True
                    and proof.get('profile_removed') is True
                    and proof.get('persistent_authorization_policy_unchanged') is True,
                    'actual case with positive ownership, evidence, integrity and policy')
            clock.work.check()  # Successful cleanup never renews or revives work.
            cases.append(dict(scenario=scenario, passed=True,
                              receipt=str((folder / 'case.json').relative_to(evidence)),
                              sha256=digest(folder / 'case.json')))
            progress(cases=list(cases))
        return process, cases
    except BaseException:
        clock.fail('required protocol or serial startup case failed/unknown')
        clock.cleaning = True
        raise


def make_clock(epochs, Bound):
    _, work, cleanup, hard = epochs
    class Clock:
        # The SDK2cee adapter, using the same maintained Bound/ci.run owner.
        # Convert once; phases and cleanup never create a replacement clock.
        monotonic = staticmethod(time.monotonic)

        def __init__(self):
            self.mono, self.epoch = time.monotonic(), time.time()
            self.failed, self.cleaning = [], False
            self.work = Bound(self, self.mono + work - self.epoch, 'work')
            self.cleanup = Bound(self, self.mono + cleanup - self.epoch, 'cleanup')
            self.retention = Bound(self, self.mono + hard - self.epoch, 'retention')

        def require_phase(self, label, seconds):
            self.work.check()
            if self.work.deadline - self.monotonic() < seconds:
                self.fail('work: insufficient remaining allowance for ' + label)
                self.work.check()

        def fail(self, reason):
            if reason not in self.failed:
                self.failed.append(reason)

        def observe(self):
            before, epoch, after = time.monotonic(), time.time(), time.monotonic()
            if (not all(math.isfinite(x) for x in (before, epoch, after)) or after < before
                    or not self.epoch + before - self.mono - 1 <= epoch <= self.epoch + after - self.mono + 1):
                self.fail('clock discontinuity')
            if STOP:
                self.fail('signal requested stop')
            require(not self.failed, 'original clock stopped: ' + ', '.join(self.failed))

    return Clock()


def build_selection_receipt(argv, selection, config, configuration_sha256, bounded_file):
    """Keep the actual ordinary/candidate project binding in the existing gate."""
    project = Path(argv[argv.index('-project') + 1])
    ordinary = selection['receipt']
    if project == Path(selection['project']):
        return ordinary
    derived = Path(argv[argv.index('-derivedDataPath') + 1])
    expected = derived.parent / 'request-project' / Path(selection['project']).name
    require(project == expected and project.resolve(strict=True) == project,
            'actual configured project outside exact H-owned copy')
    receipt_path = project.parent / 'project-selection.json'
    require(receipt_path.resolve(strict=True) == receipt_path, 'candidate selection alias')
    def unique(pairs):
        require(len(pairs) == len(dict(pairs)), 'duplicate candidate selection field')
        return dict(pairs)
    candidate = json.loads(bounded_file(receipt_path, 65536), object_pairs_hook=unique)
    require(type(candidate) is dict and set(candidate) == set(ordinary) | {'private_request_proposal'}
            and all(type(candidate[k]) is type(v) and candidate[k] == v for k, v in ordinary.items()
                    if k != 'generated_project_sha256')
            and hashlib.sha256(bounded_file(project / 'project.pbxproj', 256 * 1024)).hexdigest()
                == candidate['generated_project_sha256'], 'candidate changed source or selection binding')
    data = bounded_file(config, 32 * 1024)
    require(hashlib.sha256(data).hexdigest() == configuration_sha256, 'candidate configuration changed')
    fixture = json.loads(data)
    proposal = candidate['private_request_proposal']
    require(type(proposal) is dict and fixture['scenario'] == 'configuredLocal'
            and proposal['configuration_sha256'] == configuration_sha256
            and proposal['nonce'] == fixture['ax_witness']['nonce']
            and proposal['directory'] == str(Path(fixture['ax_witness']['path']).parent / 'requests'),
            'candidate selection differs from live fixture')
    return candidate


def directory_identity(path):
    info = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
            and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
            'exact owned build-only directory')
    return (info.st_dev, info.st_ino, info.st_uid, info.st_mode)


def build_only_snapshot(startup, profile, bounded_file):
    # A build-only configured profile has no seeded DB. Normal post-native
    # require_integrity requires a DB; use exact existing protected snapshots
    # plus a bounded whole-home inventory instead, without seeding an engine.
    entries = {}
    for path in profile['home'].rglob('*'):
        require(len(entries) < 128 and path.resolve(strict=True) == path and not path.is_symlink(),
                'build-only home inventory alias/bound')
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), 'build-only nonregular home member')
        entries[str(path.relative_to(profile['home']))] = [info.st_dev, info.st_ino, info.st_mode,
            hashlib.sha256(bounded_file(path, 64 * 1024)).hexdigest() if path.is_file() else None]
    return dict(protected=startup.immutable_snapshot(profile), home=entries)


def signature_build_only(startup, clock, using, *, folder, profiles, app, manifest,
                         product, tests, harness_sha, selection, observer, harness, run, bounded_file):
    """Actual H fixture/build owners only; no R, app, observer launch or XCTest."""
    clock.require_phase('signature-build-only', 1005)
    folder.mkdir(mode=0o700)
    provider = startup.Provider(folder / 'provider.log')
    profile = config = protected = identities = None
    prepared = False
    primary = None
    cleanup_error = None
    ledger = []
    receipt = None
    proof = dict(status='FAIL', purpose='build-only', public_test_requested=False,
                 input_completion_unknown=True, profile_removed=False, helper_receipts=[])

    def owned_run(argv, log, cap, **kwargs):
        require('test-without-building' not in argv, 'build-only route cannot execute XCTest')
        ledger.append(Path(log).with_name(Path(log).name + '.ownership.json'))
        return run(argv, log, cap, **kwargs)

    def command(argv):
        log = folder / ('signature-command-' + str(len(ledger)) + '.log')
        owned_run(argv, log, 30)
        return bounded_file(log, 64 * 1024).decode().strip()

    try:
        with using(clock.work):
            sources = startup.observer_sources(harness, tests)
            before = {path: digest(path) for path in sources}
            owned_run(['xcrun', 'swiftc', '-swift-version', '5', '-parse-as-library', *sources, '-o', str(observer)],
                      folder / 'observer-build.log', 90)
            require({path: digest(path) for path in sources} == before, 'build-only observer sources changed')
            proof['observer_sources_sha256'] = before
            base = provider.start()
            profile = startup.prepare_profile(profiles, 'configuredLocal', base + '/models-dev',
                                              run=owned_run, directory=folder)
            write(folder / 'fixture-location.json', {'root': str(profile['root']), 'scenario': 'configuredLocal'})
            protected = build_only_snapshot(startup, profile, bounded_file)
            declaration = startup.ax_declaration(profile, observer, tests)
            paths = (profile['root'], Path(declaration['path']).parent, Path(declaration['path']).parent / 'requests')
            identities = {str(path): directory_identity(path) for path in paths}
            config, config_path, admission = startup.prepare_configuration(profile, app, manifest, product,
                tests, harness_sha, run=owned_run, directory=folder, ax_witness=declaration)
            configuration_sha256 = startup.digest(config_path)
            write(folder / 'configuration.json', config)
            write(folder / 'package-admission.json', admission)
            prepared = True
            _, receipt = startup.generated_runner(folder, config_path, configuration_sha256, config, selection,
                owned_run, private_request=dict(profile=profile, profiles_root=profiles, declaration=declaration),
                command=command)
            gate = receipt.get('private_request_signature_gate')
            require(type(gate) is dict and gate.get('both_actual_signatures_verified') is True
                    and set(gate['baseline']) == set(gate['candidate']) == {'runner', 'testbundle'}
                    and gate.get('schema') == 'nac342-request-child-signatures-v1' and gate.get('acceptance') is False
                    and gate['sources'] == selection['receipt']['sources']
                    and gate['configuration_sha256'] == configuration_sha256
                    and gate['request_port']['nonce'] == declaration['nonce']
                    and gate['request_port']['directory'] == str(paths[-1])
                    and {path: tuple(value) for path, value in gate['request_port']['identities'].items()} == identities
                    and gate['request_port']['actual_runner_entitlements_verified'] is True
                    and gate['request_port']['actual_testbundle_entitlements_verified'] is True,
                    'complete actual build-only signature gate required')
            proof['signature_gate'] = gate
    except BaseException as error:
        primary = error
    finally:
        try:
            with using(clock.cleanup):
                try:
                    provider.stop(require_complete=False)
                    require(provider.settled, 'build-only provider settlement unknown')
                    require(prepared and profile is not None and protected is not None and identities is not None,
                            'partial build-only preparation retains fixture')
                    require(ledger and len(ledger) == len(set(ledger)), 'complete unique helper ownership inventory')
                    for path in ledger:
                        owner = json.loads(bounded_file(path, 8192))
                        require(owner.get('accepted') is True and type(owner.get('pid')) is int and owner['pid'] > 0
                                and owner.get('reaped') is True and owner.get('drain_settled') is True
                                and owner.get('unknown') is False and owner.get('teardown_error') is None,
                                'build-only helper settlement unknown')
                        proof['helper_receipts'].append(dict(file=str(path), sha256=digest(path)))
                    require(build_only_snapshot(startup, profile, bounded_file) == protected,
                            'build-only protected home/config/store changed')
                    require(all(directory_identity(Path(path)) == expected for path, expected in identities.items()),
                            'build-only fixture directory changed')
                    for path in (folder / 'derived', folder / 'normal-signature-baseline' / 'derived', folder / 'request-project'):
                        if path.exists() or path.is_symlink():
                            require(path.resolve(strict=True) == path and path.is_dir(), 'build-only output alias')
                            shutil.rmtree(path)
                    settlement = dict(root=str(profile['root']), owned_processes_settled=True,
                                      owner='build-only accepted helper receipts and stopped provider',
                                      provider_settled=True, helper_receipts=proof['helper_receipts'],
                                      public_test_requested=False)
                    startup.remove_profile(profile, settlement)
                    proof.update(profile_removed=True, cleanup=settlement)
                except BaseException as error:
                    cleanup_error = error
                    write(folder / 'retained-fixture.json', dict(root=str(profile['root']) if profile else None,
                        profiles_root=str(profiles), reason='build-only preparation/helper/provider/integrity/identity cleanup unknown'))
                proof.update(status='PASS' if primary is None and cleanup_error is None else 'FAIL',
                             error_type=type(primary).__name__ if primary else None,
                             cleanup_error_type=type(cleanup_error).__name__ if cleanup_error else None)
                write(folder / 'build-only.json', proof)
        except BaseException as error:
            cleanup_error = cleanup_error or error
            proof.update(status='FAIL', error_type=type(primary).__name__ if primary else None,
                         cleanup_error_type=type(cleanup_error).__name__)
            try:
                with using(clock.retention):
                    write(folder / 'retained-fixture.json', dict(root=str(profile['root']) if profile else None,
                        profiles_root=str(profiles), reason='build-only cleanup/evidence bound failed'))
                    write(folder / 'build-only.json', proof)
            except BaseException:
                pass  # The original work/cleanup error remains primary.
    if primary is not None:
        if cleanup_error is not None:
            raise primary from cleanup_error
        raise primary
    if cleanup_error is not None:
        raise cleanup_error
    return proof


def main():
    require(len(sys.argv) == 1, 'no arbitrary commands or scenarios')
    require(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'actual arm64 macOS host')
    require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and os.environ.get('GITHUB_REF') == BRANCH
            and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
            and os.environ.get('GITHUB_REPOSITORY') == 'arcee-ai/nac', 'one explicit experimental dispatch')
    controller = Path(__file__).resolve().parents[3]
    pair_path = Path(__file__).with_name('pair.json')
    pair = json.loads(pair_path.read_text())
    require(pair['scope'] == SCOPE, 'fixed source scope')
    admission = json.loads(os.environ['ROOT_STARTUP_ADMISSION'])
    start, work, cleanup, hard = admit(admission, os.environ['GITHUB_SHA'])
    roots = {key: Path(os.environ[key + '_ROOT']) for key in ('H', 'P', 'Q', 'R')}
    package, output = Path(os.environ['PACKAGE_ROOT']), Path(os.environ['OUTPUT_ROOT'])
    paths = [controller, *roots.values(), package, output]
    require(all(p.is_absolute() and p.resolve() == p for p in paths), 'canonical explicit roots')
    require(all(a != b and not a.is_relative_to(b) and not b.is_relative_to(a)
                for i, a in enumerate(paths) for b in paths[i + 1:]), 'disjoint source/package/output roots')
    require(package.is_dir() and not output.exists() and output.parent.is_dir(), 'retained package and absent owned output')
    manifest, app = package / 'manifest.json', package / 'NAC.app'
    require(digest(manifest) == admission['manifest_sha256'], 'Root-bound retained manifest differs')
    output.mkdir(mode=0o700)
    evidence = output / 'raw'
    evidence.mkdir(mode=0o700)
    exported = output / 'evidence'
    exported.mkdir(mode=0o700)
    report = dict(status='FAIL', scope=admission['scope'], purpose=admission['purpose'], pair=pair, pair_sha256=digest(pair_path),
        wrapper_sha256=digest(__file__), admission=admission, controller_sha=os.environ['GITHUB_SHA'],
        runtime_attempts=0, cases_requested=[], retries=0, full_four_case_run=False, protocol_executed=False, cases=[],
        prefix_binary_acceptance=False, final_integrated_native_acceptance=False,
        historical_four_Q_failures_preserved=True, prior_SDK_actual_allocation_consumed=True,
        lifecycle531_spent=1, allocation_consumed=True, phases=[])
    write(evidence / 'four-startup.json', report)
    write(exported / 'four-startup.json', report)  # Initial FAIL survives an import/preflight failure.
    sys.path.insert(0, str(roots['H'] / 'desktop/macos'))
    import ci
    import ci_startup as startup
    import ci_startup_protocol as protocol
    from ci_paths_budget import Bound, active, using
    from ci_qualifications import require_checkout
    from ci_support import COMPLETE_LOG_LIMIT, export_evidence, qualify_toolchain, redact_values, require_console
    from ci_xctest import require_generated_runner, runner_environment
    from ci_xctest_project import materialize_project
    from ci_xctest_attachments import bounded_file

    clock = make_clock((start, work, cleanup, hard), Bound)
    # Each work callback is independently clamped below; permit the maintained
    # case's result/owner cleanup callbacks to use the original cleanup reserve.
    # ci's default is a separate 30m relative ceiling. This adapter supplies the
    # single reviewed original absolute cleanup bound; active work is stricter.
    ci.RUN_DEADLINE = clock.cleanup.deadline

    def save():
        with using(clock.retention):
            write(evidence / 'four-startup.json', report)

    def bound():
        current = active()
        return clock.cleanup if (current is not None and current.kind == 'cleanup') or clock.cleaning else clock.work

    def command(argv, cwd=roots['H']):
        with using(bound()):
            return ci.command(argv, cwd=cwd)

    def native_report(argv, log):
        with using(bound()):
            return ci.native_report(argv, log)

    def console(label):
        quartz = native_report([str(gui_reader)], evidence / (label + '-gui.log'))
        registry = command(['/usr/sbin/ioreg', '-a', '-n', 'Root', '-d', '1']).encode()
        return dict(quartz=quartz, console=require_console(registry, os.getuid(), quartz))

    def runtime_build_receipt(argv):
        # Reuse SDK2cee's actual output inspection; never reuse its invalid
        # configuration or compiled-output hashes for this runtime binding.
        derived = Path(argv[argv.index('-derivedDataPath') + 1])
        config = Path(next(x.split('=', 1)[1] for x in argv if x.startswith('NAC_UI_FIXTURE=')))
        binding = {key: next(x.split('=', 1)[1] for x in argv if x.startswith('NAC_STARTUP_' + key.upper() + '='))
                   for key in ('product_sha', 'test_sha', 'harness_sha', 'configuration_sha256')}
        runners = list((derived / 'Build/Products').glob('*.xctestrun'))
        require(len(runners) == 1 and runners[0].stat().st_size <= 256 * 1024, 'one bounded actual runtime xctestrun')
        target = require_generated_runner(plistlib.loads(runners[0].read_bytes()), config, 'NACStartupUITests',
            project_selection=build_selection_receipt(argv, selection, config, binding['configuration_sha256'], bounded_file),
            startup_binding=binding)

        def build_path(value, host=''):
            expanded = value.replace('__TESTROOT__', str(runners[0].parent)).replace('__TESTHOST__', host)
            path = Path(expanded)
            require('__' not in expanded and path.is_absolute() and path.resolve() == path
                    and path.is_relative_to(derived), 'actual runtime output outside DerivedData')
            return path

        host = build_path(target['TestHostPath'])
        bundle = build_path(target['TestBundlePath'], str(host))
        outputs = {}
        for label, app in [('runner', host), ('test_bundle', bundle)]:
            info = app / 'Contents/Info.plist'
            executable = plistlib.loads(info.read_bytes())['CFBundleExecutable']
            require(Path(executable).name == executable, 'runtime output executable name')
            binary = app / 'Contents/MacOS' / executable
            require(binary.is_file() and binary.resolve() == binary and binary.stat().st_size > 0,
                    'actual runtime compiled binary absent')
            outputs[label] = dict(binary_sha256=digest(binary), info_sha256=digest(info))
        require(digest(config) == binding['configuration_sha256'], 'runtime configuration changed')
        receipt = dict(outputs=outputs, binding=binding, xctestrun_sha256=digest(runners[0]))
        report.setdefault('runtime_builds', {})[derived.parent.name] = receipt
        write(derived.parent / 'runtime-build.json', receipt)

    def run(argv, log, cap, cwd=roots['H'], *, env=None, abort=None, complete_output_limit=None):
        if complete_output_limit is not None:
            require(complete_output_limit == COMPLETE_LOG_LIMIT
                    and argv == ['cargo', 'test', '--locked', '-p', 'nac-server', '--test',
                                 'desktop_schema_contract', '--no-run', '--message-format=json']
                    and log.name == 'protocol-build.log' and log.parent.name == 'startup-protocol-runner',
                    'complete output is reserved for the exact required R compiler graph')
        phase = dict(argv=argv, cap_seconds=cap, started_epoch=time.time(), status='RUNNING')
        if complete_output_limit is not None:
            phase['complete_output_limit_bytes'] = complete_output_limit
        report['phases'].append(phase)
        save()
        try:
            operation = clock.work if any(x in argv for x in ('build-for-testing', 'test-without-building')) else bound()
            if operation.kind == 'work':
                clock.require_phase('helper-' + Path(str(argv[0])).name, cap + 15)
            with using(operation):
                ci.run(argv, log, cap, cwd=cwd, env=env,
                       abort=lambda: bool(STOP) or (abort is not None and abort()),
                       complete_output_limit=complete_output_limit)
                if 'build-for-testing' in argv:
                    runtime_build_receipt(argv)
            phase['status'] = 'PASS'
        except BaseException:
            clock.fail('helper failed/unknown')
            clock.cleaning = True
            phase['status'] = 'FAIL'
            raise
        finally:
            phase['ended_epoch'] = time.time()
            save()

    try:
        with using(clock.work):
            require_checkout(controller, admission['controller_sha'])
            for key, root in roots.items():
                require_checkout(root, pair[key])
            require(startup.PRODUCT == pair['P'] and startup.TEST_SOURCE == pair['Q']
                    and startup.TEST_FILES['StartupJourneys.swift'] == pair['q_swift_sha256']
                    and startup.PROTOCOL_SOURCE == pair['R'] == protocol.REVISION, 'actual H/P/Q/R pins')
            protocol.sources(roots['R'])
            expected = json.loads((roots['H'] / 'desktop/macos/ci-toolchain.json').read_text())
            actual = dict(developer_directory=os.environ.get('DEVELOPER_DIR'),
                xcode=command(['xcodebuild', '-version']), sdk=command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
                swift=command(['xcrun', 'swiftc', '--version']), image=os.environ.get('ImageVersion'),
                os_version=command(['sw_vers', '-productVersion']), os_build=command(['sw_vers', '-buildVersion']))
            report['toolchain'] = actual
            save()
            require(actual['image'] == pair['host_image'], 'reviewed actual host image changed')
            qualify_toolchain(actual, expected)
            # Same locked source setup as SDK2cee; no Rust engine/app build.
            setup_env = runner_environment()
            setup_env.update(RUSTUP_AUTO_INSTALL='0', GIT_OPTIONAL_LOCKS='0')
            for key, root in [('controller', controller), *roots.items()]:
                run(['make', 'setup'], evidence / (key + '-setup.log'), 600,
                    cwd=root, env=setup_env)
            for key, root in roots.items():
                require_checkout(root, pair[key])
            # A reused genuine package is inspected, never built or re-signed.
            contract = startup.test_contract(roots['Q'])
            report['package_before'] = startup.package_contract(contract, 'inspect_normal_package',
                [str(manifest), str(app), str(roots['P'])], dict(product_sha=pair['P']),
                tests=roots['Q'], directory=evidence, name='package-before', run=run)
            selection = materialize_project(roots['H'], pair['H'], startup_root=roots['Q'], startup_sha=pair['Q'],
                startup_source_sha256=pair['q_swift_sha256'], output=output / 'startup-project')
            report['selection'] = selection['receipt']
            if admission['purpose'] == 'build-only':
                profiles = output / 'profiles'
                profiles.mkdir(mode=0o700)
                report['build_only'] = signature_build_only(startup, clock, using,
                    folder=evidence / 'signature-build-only', profiles=profiles, app=app, manifest=manifest,
                    product=roots['P'], tests=roots['Q'], harness_sha=pair['H'], selection=selection,
                    observer=output / 'startup-owner-observer', harness=roots['H'], run=run, bounded_file=bounded_file)
                with using(clock.cleanup):
                    report['package_after'] = startup.package_contract(contract, 'inspect_normal_package',
                        [str(manifest), str(app), str(roots['P'])], dict(product_sha=pair['P']),
                        tests=roots['Q'], directory=evidence, name='package-after', run=run)
                    require(report['package_before'] == report['package_after'], 'package admission changed')
                    require(not any(profiles.iterdir()), 'unknown/retained build-only fixture; stop')
                    profiles.rmdir()
                    for key, root in roots.items():
                        require_checkout(root, pair[key])
                    require_checkout(controller, admission['controller_sha'])
                    require(not clock.failed and not STOP, 'clock/ownership failure remains latched')
                    report['status'] = 'PASS'
                return  # The original finally exports; never falls through to R/native.
            require(admission['purpose'] == 'native', 'closed native purpose')
            observer, image_reader = output / 'startup-owner-observer', output / 'startup-image-reader'
            gui_reader = output / 'native-gui-reader'
            helper_sources = startup.observer_sources(roots['H'], roots['Q'])
            helper_inventory = {path: digest(path) for path in helper_sources}
            for source, target, extra in [('CIStartupObserver.swift', observer, ['-parse-as-library']),
                                          ('CIEvidence.swift', image_reader, []), ('CIGUI.swift', gui_reader, [])]:
                inputs = helper_sources if source == 'CIStartupObserver.swift' else ['desktop/macos/' + source]
                run(['xcrun', 'swiftc', '-swift-version', '5', *extra, *inputs, '-o', str(target)],
                    evidence / (source + '.log'), 90, env=runner_environment())
            require({path: digest(path) for path in helper_sources} == helper_inventory, 'observer source inputs changed')
            report['observer_sources_sha256'] = helper_inventory
            report['compiled_helpers'] = {name: digest(path) for name, path in
                [('owner_observer', observer), ('image_reader', image_reader), ('gui_reader', gui_reader)]}
            report['console_before'] = console('before')
        profiles = output / 'profiles'
        profiles.mkdir(mode=0o700)
        def progress(**updates):
            if 'requested' in updates:
                report['cases_requested'].append(updates.pop('requested'))
            if 'protocol' in updates:
                report.update(process_protocol=updates.pop('protocol'), protocol_executed=True)
            report.update(updates)
            report['runtime_attempts'] = len(report['cases_requested'])
            save()
        process, cases = selected_episode(startup, protocol, clock, using, evidence=evidence, profiles=profiles,
            app=app, manifest=manifest, product=roots['P'], tests=roots['Q'], protocol_root=roots['R'],
            harness_sha=pair['H'], package_admission={'provenance': report['package_before']},
            selection=selection, observer=observer, image_reader=image_reader, run=run, command=command,
            native_report=native_report, progress=progress)
        report.update(full_four_case_run=True, process_protocol=process, cases=cases)
        with using(clock.cleanup):
            report['console_after'] = console('after')
            report['package_after'] = startup.package_contract(contract, 'inspect_normal_package',
                [str(manifest), str(app), str(roots['P'])], dict(product_sha=pair['P']),
                tests=roots['Q'], directory=evidence, name='package-after', run=run)
            require(report['package_before'] == report['package_after'], 'package admission changed')
            require(not any(profiles.iterdir()), 'unknown/retained owned profile; stop')
            profiles.rmdir()
            for key, root in roots.items():
                require_checkout(root, pair[key])
            require_checkout(controller, admission['controller_sha'])
            require(not clock.failed and not STOP, 'clock/ownership failure remains latched')
            report['status'] = 'PASS'
    except BaseException as error:
        report['status'] = 'FAIL'
        clock.fail('episode failed/unknown')
        clock.cleaning = True
        report.update(error_type=type(error).__name__, error='selected experiment failed; retain stage evidence')
        raise
    finally:
        report.update(ended_epoch=time.time(), clock_failures=clock.failed, stop_signals=STOP)
        try:
            save()
        finally:
            with using(clock.retention):
                export_evidence(evidence, exported, [*redact_values(),
                    *((str(root), '<' + key + '-checkout>') for key, root in roots.items()),
                    (str(package), '<retained-package>'), (str(output), '<owned-output>')],
                    include_hashes=True, strict_json=True, essential_first=True)


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: STOP.append(number))
    main()
