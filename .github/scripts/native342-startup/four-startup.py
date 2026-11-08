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
import sys
import time

STOP = []
BRANCH = 'refs/heads/codex/experimental-native-p12-ax-diagnostics-source01'
SCOPE = 'P12-Qba-R7325-AX-diagnostics-source01'
REFUSAL_SCOPE = 'P12-Qba-H54-configured-lifetime-context-diagnostic01'
REFUSAL_BRANCH = 'refs/heads/codex/experimental-native-p12-lifetime-context-consumer01'
REFUSAL_H = '54c0b7db66c19c9b676e46933bfc89944c3b6f2a'
REFUSAL_SUPPLIERS = {
    "H": {
        "desktop/macos/CIStartupObserver.swift": "1a8141134d45838aa150cb903b5483bd22b2e3b7c163505812108af37b151b95",
        "desktop/macos/CIStartupAXWitness.swift": "78bb7e28f6262efe309ac0d70508dc988b52187e4ee0bf9a251d43e38bb5f695",
        "desktop/macos/ci_startup_ax.py": "40994057d3156b1faf83eb08bb30661e052d6d4aeb3e10ffef3ccf8a4d29a55a"
    },
    "Q": {
        "desktop/macos/startup_xctest/StartupAXGuard.swift": "3be7835fe8cf48164bcfae3d5e803a1423b188ba78512ccb658858486dfa4a18",
        "desktop/macos/startup_xctest/StartupAXReceipt.swift": "a25b94b791e2ff24cb15016b976f78cf366540d15382c01f9bce8ec585f93217"
    }
}
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


def _refusal_sources(roots):
    """Exact reviewed passive-context and canonical helper bytes; no actor."""
    observed = {}
    for role, files in REFUSAL_SUPPLIERS.items():
        observed[role] = {}
        for name, expected in files.items():
            path = roots[role] / name
            require(path.is_file() and path.resolve() == path, 'canonical diagnostic supplier file')
            observed[role][name] = digest(path)
            require(observed[role][name] == expected, 'reviewed diagnostic supplier bytes')
    return observed


def write(path, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    require(len(data) <= 256 * 1024, 'bounded controller evidence')
    path.write_bytes(data)


def admit(value, controller_sha, *, now=None, configured_refusal=False):
    """Validate a declaration; this function never issues execution authority."""
    require(set(value) == {'scope', 'controller_sha', 'allocation_id', 'attempt', 'retries',
                          'manifest_sha256', 'clock', 'producer'}, 'exact admission fields')
    require(type(configured_refusal) is bool, 'closed diagnostic role')
    require(value['scope'] == (REFUSAL_SCOPE if configured_refusal else SCOPE) and value['controller_sha'] == controller_sha
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
            clock.require_phase('case-' + scenario, 615)
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


def selected_refusal(startup, clock, using, *, evidence, profiles, app, manifest, product, tests,
                     selection, observer, image_reader, run, command, native_report, progress,
                     read, validate_pair):
    """Exactly one maintained case; its original refusal is always fatal."""
    folder = evidence / 'startup-configuredLocal'
    try:
        require(tuple(startup.CASES) == CASES, 'unchanged maintained case contract')
        clock.require_phase('case-configuredLocal', 615)
        progress(requested='configuredLocal')
        with using(clock.cleanup):
            startup.run_case(folder=folder, profiles=profiles, scenario='configuredLocal', app=app,
                manifest=manifest, product=product, tests=tests, harness_sha=REFUSAL_H,
                selection=selection, observer=observer, image_reader=image_reader,
                run=run, command=command, native_report=native_report)
        require(False, 'diagnostic first refusal unavailable; no startup acceptance')
    except BaseException as primary:
        clock.fail('configured diagnostic refusal/failure remains fatal')
        clock.cleaning = True
        try:
            with using(clock.cleanup):
                case_bytes = read(folder / 'case.json', 65536)
                proof = json.loads(case_bytes)
                require(proof.get('scenario') == 'configuredLocal' and proof.get('H') == REFUSAL_H
                    and proof.get('P') == PRODUCER_PRODUCT and proof.get('Q') == PRODUCER_QUERY
                    and proof.get('passed') is False and proof.get('public_test_requested') is True
                    and proof.get('input_completion_unknown') is True
                    and proof.get('rendered_UI_reload_observed') is False, 'actual failed configured case only')
                owner = proof.get('owner_observation', {})
                require(owner.get('failure') == 'app_windows' and owner.get('ui_failure') == 'app_windows'
                    and owner.get('process_failure') is None and owner.get('positive_process_settlement') is True
                    and owner.get('metadata_helper_settled') is True and owner.get('positive_settlement') is False
                    and proof.get('cleanup', {}).get('owned_processes_settled') is True
                    and proof['cleanup'].get('complete_observation') is True
                    and proof.get('ax_companion_custody', {}).get('owned_processes_settled') is True
                    and proof.get('profile_removed') is True
                    and proof.get('persistent_authorization_policy_unchanged') is True
                    and all(key in proof for key in ('integrity', 'provider', 'actual_result'))
                    and all(proof.get('errors', {}).get(k) is None for k in ('cleanup', 'integrity', 'provider', 'policy')),
                    'positive existing app/engine/helper/profile failure cleanup')
                diagnostic = proof.get('ax_companion_diagnostic') or {}
                require(diagnostic.get('acceptance') is False and diagnostic.get('stage') == 'lifetime'
                    and diagnostic.get('code') == 'ownership_invalid' and diagnostic.get('refusal_generation') == '0'
                    and all(diagnostic.get('binding', {}).get(k) == v for k, v in
                        [('harness_sha', REFUSAL_H), ('source_sha', PRODUCER_PRODUCT), ('test_source_sha', PRODUCER_QUERY)]),
                    'first original CG refusal source binding')
                paired = validate_pair(diagnostic['pre_refusal_paired'])
                require(paired['original_window_number'] == owner.get('original_window_number'), 'original pinned root diagnostic')
                progress(diagnostic=dict(status='BOUNDED_REFUSAL_AND_CLEANUP', acceptance=False,
                    independent_R_executed=False, input_completion='UNKNOWN', paired=paired,
                    case_receipt='startup-configuredLocal/case.json', case_sha256=hashlib.sha256(case_bytes).hexdigest()))
        except BaseException as evidence_error:
            try:
                progress(diagnostic=dict(status='INCOMPLETE', acceptance=False, independent_R_executed=False))
            except BaseException:
                pass
            raise primary from evidence_error
        raise


PRODUCER_PRODUCT = '4b7a1f3e0bf6175a77c5ebf627fe965860e99976'
PRODUCER_QUERY = 'ba266ba1b3bea331768d91fc8a0b2ee66b484d01'


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


def main(*, configured_refusal=False):
    require(len(sys.argv) == 1, 'no arbitrary commands or scenarios')
    require(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'actual arm64 macOS host')
    require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and os.environ.get('GITHUB_REF') == (REFUSAL_BRANCH if configured_refusal else BRANCH)
            and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
            and os.environ.get('GITHUB_REPOSITORY') == 'arcee-ai/nac', 'one explicit experimental dispatch')
    controller = Path(__file__).resolve().parents[3]
    pair_path = Path(__file__).with_name('configured-refusal-pair.json' if configured_refusal else 'pair.json')
    pair = json.loads(pair_path.read_text())
    scope = REFUSAL_SCOPE if configured_refusal else SCOPE
    require(pair['scope'] == scope, 'fixed source scope')
    if configured_refusal:
        require(pair['H'] == REFUSAL_H and pair['P'] == PRODUCER_PRODUCT and pair['Q'] == PRODUCER_QUERY
                and pair.get('supplier_sha256') == REFUSAL_SUPPLIERS, 'closed diagnostic sources')
    admission = json.loads(os.environ['ROOT_STARTUP_ADMISSION'])
    start, work, cleanup, hard = admit(admission, os.environ['GITHUB_SHA'], configured_refusal=configured_refusal)
    roots = {key: Path(os.environ[key + '_ROOT']) for key in (('H', 'P', 'Q') if configured_refusal else ('H', 'P', 'Q', 'R'))}
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
    report_name = 'configured-refusal.json' if configured_refusal else 'four-startup.json'
    report = dict(status='FAIL', scope=scope, pair=pair, pair_sha256=digest(pair_path),
        wrapper_sha256=digest(__file__), admission=admission, controller_sha=os.environ['GITHUB_SHA'],
        runtime_attempts=0, cases_requested=[], retries=0, full_four_case_run=False, protocol_executed=False, cases=[],
        prefix_binary_acceptance=False, final_integrated_native_acceptance=False,
        historical_four_Q_failures_preserved=True, prior_SDK_actual_allocation_consumed=True,
        lifecycle531_spent=1, allocation_consumed=True, phases=[])
    if configured_refusal:
        report.update(acceptance=False, diagnostic_only=True, independent_R_omitted='diagnostic role; no fresh R acceptance')
    write(evidence / report_name, report)
    write(exported / report_name, report)  # Initial FAIL survives an import/preflight failure.
    sys.path.insert(0, str(roots['H'] / 'desktop/macos'))
    import ci
    import ci_startup as startup
    if not configured_refusal:
        import ci_startup_protocol as protocol
    from ci_paths_budget import Bound, active, using
    from ci_qualifications import require_checkout
    from ci_support import COMPLETE_LOG_LIMIT, export_evidence, qualify_toolchain, redact_values, require_console
    from ci_xctest import require_generated_runner, runner_environment
    from ci_xctest_project import materialize_project

    clock = make_clock((start, work, cleanup, hard), Bound)
    # Each work callback is independently clamped below; permit the maintained
    # case's result/owner cleanup callbacks to use the original cleanup reserve.
    # ci's default is a separate 30m relative ceiling. This adapter supplies the
    # single reviewed original absolute cleanup bound; active work is stricter.
    ci.RUN_DEADLINE = clock.cleanup.deadline

    def save():
        with using(clock.retention):
            write(evidence / report_name, report)

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
            project_selection=selection['receipt'], startup_binding=binding)

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
        if configured_refusal:
            require(complete_output_limit is None and argv[0] != 'cargo', 'no independent R graph in diagnostic role')
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
        primary = None
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
        except BaseException as error:
            primary = error
            clock.fail('helper failed/unknown')
            clock.cleaning = True
            phase['status'] = 'FAIL'
            raise
        finally:
            phase['ended_epoch'] = time.time()
            try:
                save()
            except Exception as evidence_error:
                phase['phase_save_failed'] = True
                phase['status'] = 'FAIL'
                clock.fail('final phase evidence save failed')
                clock.cleaning = True
                if primary is not None:
                    raise primary from evidence_error
                raise

    try:
        with using(clock.work):
            require_checkout(controller, admission['controller_sha'])
            for key, root in roots.items():
                require_checkout(root, pair[key])
            if configured_refusal:
                report['supplier_sources_sha256'] = _refusal_sources(roots)
            require(startup.PRODUCT == pair['P'] and startup.TEST_SOURCE == pair['Q']
                    and startup.TEST_FILES['StartupJourneys.swift'] == pair['q_swift_sha256']
                    and (configured_refusal or startup.PROTOCOL_SOURCE == pair['R'] == protocol.REVISION), 'actual H/P/Q/R pins')
            if not configured_refusal:
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
        if configured_refusal:
            from ci_xctest_attachments import bounded_file
            from ci_startup_ax import paired_diagnostic
            selected_refusal(startup, clock, using, evidence=evidence, profiles=profiles, app=app,
                manifest=manifest, product=roots['P'], tests=roots['Q'], selection=selection,
                observer=observer, image_reader=image_reader, run=run, command=command,
                native_report=native_report, progress=progress, read=bounded_file, validate_pair=paired_diagnostic)
        require(not configured_refusal, 'diagnostic cannot enter full R episode')
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
        primary = sys.exc_info()[1]
        try:
            if configured_refusal:
                try:
                    with using(clock.cleanup):
                        if 'package_before' in report:
                            report['console_after'] = console('after')
                            report['package_after'] = startup.package_contract(contract, 'inspect_normal_package',
                                [str(manifest), str(app), str(roots['P'])], dict(product_sha=pair['P']),
                                tests=roots['Q'], directory=evidence, name='package-after', run=run)
                            require(report['package_before'] == report['package_after'], 'package admission changed')
                        for key, root in roots.items():
                            require_checkout(root, pair[key])
                        require_checkout(controller, admission['controller_sha'])
                except BaseException as final_error:
                    report['diagnostic_finalization_error'] = type(final_error).__name__
                    clock.fail('diagnostic finalization incomplete')
                    if primary is None:
                        raise
            report.update(ended_epoch=time.time(), clock_failures=clock.failed, stop_signals=STOP)
            try:
                save()
            finally:
                with using(clock.retention):
                    export_evidence(evidence, exported, [*redact_values(),
                        *((str(root), '<' + key + '-checkout>') for key, root in roots.items()),
                        (str(package), '<retained-package>'), (str(output), '<owned-output>')],
                        include_hashes=True, strict_json=True, essential_first=True)
        except BaseException as export_error:
            if configured_refusal and primary is not None:
                raise primary from export_error
            raise


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: STOP.append(number))
    main()
