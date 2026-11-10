"""Finite P/Q/R/H ordinary startup qualification; no product test bridge."""
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import sys
import tempfile
import time

from ci_qualifications import require_checkout
from ci_paths_budget import active, using
from ci_startup_process import package_contract
from ci_startup_api import Provider, configuration_selection, require, seed_model, setup_engine
from ci_startup_attachments import collect
from ci_startup_audit import LiveAudit, persisted_audit
from ci_startup_fixture import (CASES, PRODUCT, TEST_SOURCE, TEST_FILES, digest, immutable_snapshot,
                               prepare_configuration, prepare_profile, remove_profile, require_integrity, test_contract)
from ci_startup_owner import OwnerWitness
from ci_startup_ax import AXCompanion, declaration as ax_declaration
from ci_startup_protocol import REVISION as PROTOCOL_SOURCE, build as build_protocol, sources as protocol_sources, verify as verify_protocol
from ci_xctest import (authorization_policy, observe_prerequisites, require_generated_runner, result_receipt,
                       runner_environment)
from ci_xctest_attachments import AttachmentTool
from ci_xctest_project import materialize_project

ROOT = Path(__file__).resolve().parents[2]


def write(path, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    require(len(data) <= 64 * 1024, 'startup_json_evidence_bound')
    path.write_bytes(data)


def generated_runner(folder, config_path, configuration_sha256, config, selection, run, *,
                     private_request=None, command=None):
    if config.get('scenario') == 'configuredLocal':
        from ci_startup_signatures import private_build_pair
        runner, receipt = private_build_pair(folder, config_path, configuration_sha256, config, selection,
                                            run, command, private_request, _build_runner)
        write(folder / 'runner.json', receipt)
        return runner, receipt
    require('ax_witness' not in config, 'nonconfigured_private_request_declaration')
    return _build_runner(folder, config_path, configuration_sha256, config, selection, run)


def _build_runner(folder, config_path, configuration_sha256, config, selection, run):
    derived = folder / 'derived'
    args = ['xcodebuild', 'build-for-testing', '-project', selection['project'], '-scheme', selection['scheme'],
            '-destination', 'platform=macOS,arch=arm64', '-derivedDataPath', str(derived),
            '-parallel-testing-enabled', 'NO', 'NAC_UI_FIXTURE=' + str(config_path)]
    binding = {'product_sha': PRODUCT, 'test_sha': TEST_SOURCE, 'harness_sha': config['harness_sha'],
               'configuration_sha256': configuration_sha256}
    args += ['NAC_STARTUP_' + name.upper() + '=' + value for name, value in binding.items()]
    run(args, folder / 'build.log', 240, env=runner_environment())
    runners = list((derived / 'Build/Products').glob('*.xctestrun'))
    require(len(runners) == 1, 'actual_generated_runner_count')
    encoded = runners[0].read_bytes()
    target = require_generated_runner(plistlib.loads(encoded), config_path, 'NACStartupUITests',
        project_selection=selection['receipt'], startup_binding=binding)
    receipt = {'generator': 'actual xcodebuild build-for-testing', 'xctestrun_sha256': hashlib.sha256(encoded).hexdigest(),
               'configuration_sha256': configuration_sha256, 'binding': binding, 'generated_target': target,
               'selection': selection['receipt']}
    write(folder / 'runner.json', receipt)
    return runners[0], receipt


def cleanup_receipt(proof):
    # Do not repeat each full fixture environment 128 times in the bounded
    # record. Its exact digest remains bound to the immutable configuration.
    result = {**proof}
    result['observed_processes'] = [{**{key: value for key, value in node.items() if key != 'environment'},
        'environment_sha256': hashlib.sha256(json.dumps(node['environment'], sort_keys=True).encode()).hexdigest()}
        for node in proof['observed_processes']]
    return result


def audit_diagnostic(audit, caller_abort, folder):
    """Best-effort bounded metadata must never change admission or cleanup."""
    unavailable = {'schema': 'nac-startup-api-diagnostic-v1', 'unavailable': True}
    try:
        snapshot = {**audit.failure_snapshot(), 'caller_abort': dict(caller_abort)}
        encoded = (json.dumps(snapshot, indent=2) + '\n').encode()
        if len(encoded) > 8192:
            snapshot = unavailable
            encoded = (json.dumps(snapshot) + '\n').encode()
    except BaseException:
        snapshot = unavailable
        encoded = (json.dumps(snapshot) + '\n').encode()
    try:
        (folder / 'live-api-diagnostic.json').write_bytes(encoded)
    except BaseException:
        snapshot = unavailable
    return snapshot


def run_case(folder, profiles, scenario, app, manifest, product, tests, harness_sha,
             selection, observer, image_reader, run, command, native_report):
    folder.mkdir()
    errors = {key: None for key in ('preparation', 'build', 'admission', 'test', 'api', 'collector',
                                   'result', 'image', 'policy', 'cleanup', 'integrity', 'provider', 'ax_owner')}
    provider = Provider(folder / 'provider.log')
    profile = config = witness = audit = collection = policy = companion = None
    attempted, safe_to_remove = False, False
    primary_error = None
    proof = {}
    caller_abort = {'observed': False, 'origin': None}
    result = folder / 'ordinary-startup.xcresult'
    stage = 'preparation'
    bound = active()
    try:
        with using(bound.owner.work if bound else None):
            base = provider.start()
            profile = prepare_profile(profiles, scenario, base + '/models-dev', run=run, directory=folder)
            write(folder / 'fixture-location.json', {'root': str(profile['root']), 'scenario': scenario})
            options = {'ax_witness': ax_declaration(profile, observer, tests)} if scenario == 'configuredLocal' else {}
            config, config_path, admission = prepare_configuration(profile, app, manifest, product, tests, harness_sha,
                run=run, directory=folder, **options)
            configuration_sha256 = digest(config_path)
            write(folder / 'configuration.json', config)
            write(folder / 'package-admission.json', admission)
            proof['configuration_preflight'] = configuration_selection(profile, Path(config['app_path']) / 'Contents/Resources/nac-web', run=run, directory=folder)
            model_config = None
            if scenario == 'configuredLocal':
                with setup_engine(profile, config, folder / 'settings-engine.log') as setup:
                    model_config = seed_model(setup['base_url'], base)
                    proof['settings_preparation'] = setup
                    proof['model_config'] = model_config
            protected = immutable_snapshot(profile)
            proof['protected_before'] = protected
            write(folder / 'protected-before.json', protected)
            initial_status = observe_prerequisites(command)
            policy = authorization_policy(initial_status)
            write(folder / 'prerequisites-initial.json', initial_status)
            stage = 'build'
            # The full selected SDK target and actual generated runner must exist
            # before starting the owner observer or requesting any public UI input.
            private_request = dict(profile=profile, profiles_root=profiles, declaration=options['ax_witness']) if scenario == 'configuredLocal' else None
            runner, runner_receipt = generated_runner(folder, config_path, configuration_sha256, config, selection, run,
                private_request=private_request, command=command)
            stage = 'admission'
            status = observe_prerequisites(command)
            require(authorization_policy(status) == policy, 'persistent_policy_changed_during_build')
            write(folder / 'prerequisites-before.json', status)
            require(digest(config_path) == configuration_sha256, 'configuration_changed_during_build')
            package_contract(test_contract(tests), 'validate_normal_package', [config, str(manifest), str(product)],
                dict(product_sha=PRODUCT, test_sha=TEST_SOURCE, harness_sha=harness_sha),
                tests=tests, directory=folder, name='package-before-input', run=run)
            tool = AttachmentTool(folder, command)
            tool.prepare()  # Actual selected SDK tool/schema admission, before input.
            witness = OwnerWitness(config, configuration_sha256)
            witness.start(observer, config_path)
            if scenario == 'configuredLocal':
                companion = AXCompanion(witness, config, config_path, observer, folder)
                companion.start()
            if scenario in ('onboarding', 'configuredLocal'):
                audit = LiveAudit(witness, {**config, 'provider_base': base}, product, model_config)
                audit.start()
            require(digest(config_path) == configuration_sha256
                    and digest(runner) == runner_receipt['xctestrun_sha256'], 'runner_configuration_changed_before_input')
            require(not witness.failure and not witness.ui_terminal and not (companion and companion.failure), 'startup_ui_target_unavailable')
            if private_request is not None:
                from ci_startup_signatures import recheck_private_build
                recheck_private_build(runner_receipt, private_request)
            stage = 'test'
            attempted = True
            def abort():
                reason = witness.failure
                origin = 'witness'
                if not reason and companion:
                    reason, origin = companion.failure, 'ax_companion'
                if not reason:
                    reason = audit and audit.failure
                    origin = 'audit'
                if reason and not caller_abort['observed']:
                    caller_abort.update(observed=True, origin=origin)
                return reason
            run(['xcodebuild', 'test-without-building', '-xctestrun', str(runner),
                 '-destination', 'platform=macOS,arch=arm64', '-parallel-testing-enabled', 'NO',
                 '-maximum-concurrent-test-device-destinations', '1', '-resultBundlePath', str(result),
                 '-only-testing:NACStartupUITests/StartupJourneys/testOrdinaryStartup'],
                folder / 'test.log', 300, env=runner_environment(),
                abort=abort)
            require(not witness.failure and not (companion and companion.failure), 'startup_ui_owner_unavailable')
    except BaseException as error:
        errors[stage] = primary_error = error
    finally:
        try:
            with using(bound.owner.cleanup if bound else None):
                if companion:
                    try:
                        proof['ax_companion'] = companion.stop()
                    except BaseException as error:
                        errors['ax_owner'] = error
                        primary_error = primary_error or error
                        safe_to_remove = False
                    finally:
                        custody = companion.settlement
                        if type(custody) is dict and custody.get('owned_processes_settled') is True:
                            proof['ax_companion_custody'] = custody
                        # Diagnostic loss must not replace the original failure or
                        # change the process owner's cleanup decision.
                        try:
                            proof['ax_companion_diagnostic'] = companion.failure_diagnostic()
                        except BaseException:
                            pass
                        try:
                            first = companion.preflight_diagnostic()
                            if first is not None:
                                write(folder / 'first-preflight-failure.json', first)
                                proof['first_preflight_failure_diagnostic'] = first
                        except BaseException:
                            pass  # Passive export cannot replace any original error.
                if audit:
                    # Preserve the rejection before stop() can replace it with a
                    # generic missing-proof exception. Never retain exception text.
                    proof['api_audit_diagnostic'] = audit_diagnostic(audit, caller_abort, folder)
                    try:
                        proof['live_api'] = audit.stop()
                    except BaseException as error:
                        errors['api'] = error
                if result.exists():
                    try:
                        proof['actual_result'] = result_receipt(result)
                        write(folder / 'actual-result.json', proof['actual_result'])
                    except BaseException as error:
                        errors['result'] = error
                    try:
                        require(not witness.failure and not (companion and companion.failure) and errors['ax_owner'] is None, 'startup_ui_owner_unavailable')
                        collection = collect(tool, result, config, configuration_sha256,
                                             witness.attachment_binding(), folder / 'attachments')
                        proof['attachments_complete'] = collection['complete']
                    except BaseException as error:
                        errors['collector'] = error
                    image = folder / 'attachments' / ('nac342-ordinary-' + scenario + '.png')
                    if image.exists():
                        try:
                            mode = {'onboarding': 'instance-empty', 'configuredLocal': 'startup-configured',
                                    'invalidConfig': 'startup-invalid', 'futureStore': 'startup-future'}[scenario]
                            proof['image'] = {'sha256': digest(image), 'observation': native_report(
                                [str(image_reader), '--' + mode, str(image)], folder / 'image.log')}
                        except BaseException as error:
                            errors['image'] = error
                    else:
                        errors['image'] = RuntimeError('Actual named startup PNG unavailable')
                elif attempted:
                    errors['result'] = RuntimeError('Actual startup result unavailable')
                if attempted:
                    try:
                        after = observe_prerequisites(command)
                        write(folder / 'prerequisites-after.json', after)
                        require(policy is not None and authorization_policy(after) == policy, 'persistent_policy_changed')
                        proof['persistent_authorization_policy_unchanged'] = True
                    except BaseException as error:
                        errors['policy'] = error
                if witness:
                    try:
                        settled = witness.settle(time.monotonic())
                        proof['cleanup'] = cleanup_receipt(settled)
                        if companion:
                            try:
                                proof['ax_retirement'] = companion.reconcile_retirement(settled, collection)
                            except BaseException as error:
                                errors['ax_owner'] = errors['ax_owner'] or error
                        safe_to_remove = not companion or proof.get('ax_companion_custody', {}).get('owned_processes_settled') is True
                    except BaseException as error:
                        errors['cleanup'] = error
                    finally:
                        try:
                            witness.stop()
                        except BaseException as error:
                            errors['cleanup'] = errors['cleanup'] or error
                            safe_to_remove = False
                    try:
                        proof['owner_observation'] = witness.failure_receipt()
                        write(folder / 'owner-observation.json', proof['owner_observation'])
                    except BaseException as error:
                        errors['cleanup'] = errors['cleanup'] or error
                        safe_to_remove = False
                # The persisted read is additional evidence after live settlement;
                # it never restarts an unsettled run or counts as rendered UI reload.
                if (safe_to_remove and scenario == 'configuredLocal' and 'live_api' in proof
                        and errors['test'] is None and errors['ax_owner'] is None
                        and not witness.failure and not (companion and companion.failure)):
                    try:
                        with setup_engine(profile, config, folder / 'persisted-engine.log') as setup:
                            proof['persisted_api'] = persisted_audit(setup['base_url'], {**config, 'provider_base': base},
                                                                   model_config, proof['live_api'])
                    except BaseException as error:
                        errors['api'] = errors['api'] or error
                        safe_to_remove = False  # A later helper's retirement may be unknown.
                try:
                    proof['provider'] = provider.stop(require_complete=scenario == 'configuredLocal' and errors['test'] is None)
                except BaseException as error:
                    errors['provider'] = error
                    safe_to_remove = False
                if profile:
                    try:
                        proof['protected_after'] = immutable_snapshot(profile)
                        write(folder / 'protected-after.json', proof['protected_after'])
                        proof['integrity'] = require_integrity(profile, protected)
                        if config:
                            package_contract(test_contract(tests), 'validate_normal_package', [config, str(manifest), str(product)],
                                dict(product_sha=PRODUCT, test_sha=TEST_SOURCE, harness_sha=harness_sha),
                                tests=tests, directory=folder, name='package-after-cleanup', run=run)
                    except BaseException as error:
                        errors['integrity'] = error
                        safe_to_remove = False
                    # A pre-launch failure lacks a full cleanup receipt. Preserve it
                    # just like an unknown owner; do not infer zero input/ownership.
                    if safe_to_remove:
                        try:
                            remove_profile(profile, settled)
                            proof['profile_removed'] = True
                        except BaseException as error:
                            errors['cleanup'] = errors['cleanup'] or error
                proof.update(scenario=scenario, P=PRODUCT, Q=TEST_SOURCE, R=PROTOCOL_SOURCE, H=harness_sha,
                    public_test_requested=attempted, input_completion_unknown=collection is None or not collection.get('complete'),
                    rendered_UI_reload_observed=False,
                    errors={name: {'type': type(error).__name__, 'stage': name} if error else None for name, error in errors.items()})
                proof['passed'] = attempted and all(error is None for error in errors.values())
                write(folder / 'case.json', proof)
                if profile and not safe_to_remove:
                    write(folder / 'retained-fixture.json', {'root': str(profile['root']),
                        'positive_process_settlement': 'cleanup' in proof,
                        'retention_reasons': [name for name, error in errors.items() if error is not None]})
                # Build products and XCTest's raw result never enter the bounded export.
                if (folder / 'derived').exists():
                    shutil.rmtree(folder / 'derived')
        except BaseException as final_error:
            original = primary_error or next((error for error in errors.values() if error is not None), None)
            if original is not None:
                raise original from final_error
            raise
    primary_error = primary_error or next((error for error in errors.values() if error is not None), None)
    if primary_error is not None:
        raise primary_error
    require(proof['passed'], 'ordinary_startup_case_' + scenario)
    return proof


def observer_sources(harness, tests):
    """Complete helper inputs; callers must not compile the main file alone."""
    test_contract(tests)
    return [str(harness / 'desktop/macos' / name) for name in ('CIStartupObserver.swift', 'CIStartupAXWitness.swift')] + [
        str(tests / 'desktop/macos/startup_xctest' / name) for name in ('StartupAXGuard.swift', 'StartupAXReceipt.swift')]


def qualify(raw, product, tests, protocol, harness_sha, run, command, native_report):
    require_checkout(product, PRODUCT)
    test_contract(tests)
    protocol_sources(protocol)
    require_checkout(ROOT, harness_sha)
    owner = product / 'desktop/macos/packaging/package.py'
    engine = raw / 'startup-engine'
    package = raw / 'startup-package'
    run([sys.executable, '-B', str(owner), 'prepare-engine', '--track', 'dev', '--output', str(engine)],
        raw / 'startup-engine-build.log', 900, cwd=product)
    run([sys.executable, '-B', str(owner), 'normal', '--engine-receipt', str(engine / 'engine-build.json'),
         '--output', str(package)], raw / 'startup-package-build.log', 240, cwd=product)
    app, manifest = package / 'NAC.app', package / 'manifest.json'
    def verify_package(label):
        run([sys.executable, '-B', str(owner), 'verify', str(manifest), '--signatures'],
            raw / ('startup-package-' + label + '.log'), 90, cwd=product)
    verify_package('before')
    admission = {'provenance': test_contract(tests).inspect_normal_package(str(manifest), str(app), str(product), product_sha=PRODUCT)}
    private, receipt = build_protocol(protocol, raw / 'startup-protocol-runner', run,
        product=product, manifest=manifest, package_admission=admission)
    process_proof = verify_protocol(private, receipt, app, manifest, admission, raw / 'startup-protocol', run)
    verify_package('after-protocol')
    selection = materialize_project(ROOT, harness_sha, startup_root=tests, startup_sha=TEST_SOURCE,
        startup_source_sha256=TEST_FILES['StartupJourneys.swift'], output=raw / 'startup-project')
    observer, image_reader = raw / 'startup-owner-observer', raw / 'startup-image-reader'
    helper_sources = observer_sources(ROOT, tests)
    helper_inventory = {path: digest(path) for path in helper_sources}
    run(['xcrun', 'swiftc', '-swift-version', '5', '-parse-as-library', *helper_sources, '-o', str(observer)],
        raw / 'startup-owner-build.log', 90)
    run(['xcrun', 'swiftc', '-swift-version', '5', 'desktop/macos/CIEvidence.swift', '-o', str(image_reader)],
        raw / 'startup-image-build.log', 90)
    profiles = Path(tempfile.mkdtemp(prefix='nac354-startup-profiles-')).resolve()
    cases = []
    primary_error = None
    try:
        for scenario in CASES:
            folder = raw / ('startup-' + scenario)
            case = run_case(folder, profiles, scenario, app, manifest, product, tests,
                            harness_sha, selection, observer, image_reader, run, command, native_report)
            cases.append({'scenario': scenario, 'passed': case['passed'],
                          'receipt': str((folder / 'case.json').relative_to(raw)), 'sha256': digest(folder / 'case.json')})
    except BaseException as error:
        primary_error = error
        raise
    finally:
        try:
            if not any(profiles.iterdir()):
                profiles.rmdir()
            verify_package('after-ui')
            for root, sha in ((product, PRODUCT), (tests, TEST_SOURCE), (protocol, PROTOCOL_SOURCE), (ROOT, harness_sha)):
                require_checkout(root, sha)
        except BaseException as final_error:
            if primary_error is not None:
                raise primary_error from final_error
            raise
    return {'startup': {'P': PRODUCT, 'Q': TEST_SOURCE, 'R': PROTOCOL_SOURCE, 'H': harness_sha,
                        'process_protocol': process_proof, 'cases': cases, 'full_four_case_run': len(cases) == 4,
                        'observer_sha256': digest(observer), 'observer_sources_sha256': helper_inventory,
                        'observer_compiler_flags': ['-swift-version', '5', '-parse-as-library'],
                        'rendered_UI_reload_observed': False,
                        'scope': 'Four ordinary LOCAL_APP startup cases only; full ALL-354 acceptance remains separate'}}
