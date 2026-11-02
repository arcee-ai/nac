"""Finite ALL-347 qualification using the maintained project and owning builder.

Invoked only through ci.py's pinned selector after a separate source/custody
allocation. Importing this module launches nothing. Native eligibility is never
inferred from the portable source controls.
"""
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import time

from ci_paths_protocol import CASES, PRODUCT, HELPER, decode, final_record, read_record, require
from ci_paths_attachments import TESTS, collect
from ci_qualifications import require_checkout
from ci_xctest import (authorization_policy, observe_prerequisites, relocation_directory,
                       require_generated_runner, require_settled, result_receipt)
from ci_xctest_attachments import AttachmentTool, bounded_file, digest
from ci_xctest_project import materialize_project

ROOT = Path(__file__).resolve().parents[2]
TARGET = dict(source_sha=PRODUCT, profile='macos26', suite='paths', scenario_count=2,
              scenarios=list(CASES), helper_sha256=HELPER, retry_budget=0)


def write(path, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    require(len(data) <= 256 * 1024, 'essential JSON receipt bound')
    path.write_bytes(data)


def validate_allocation(value, harness_sha, *, now=None):
    """Validate externally supplied facts; never create a deadline or eligibility."""
    require(type(value) is dict and re.fullmatch('[0-9a-f]{40}', str(harness_sha))
            and set(value) == {'version', 'H', 'T', 'cases', 'source_preflight', 'native_eligibility',
                            'allocation_id', 'started_at_epoch', 'deadline_epoch', 'retry_budget'}
            and type(value['version']) is int and value['version'] == 1
            and value['H'] == harness_sha and value['T'] == PRODUCT and value['cases'] == list(CASES)
            and value['source_preflight'] is True and value['native_eligibility'] is True
            and value['retry_budget'] == 0 and type(value['retry_budget']) is int
            and isinstance(value['allocation_id'], str) and 0 < len(value['allocation_id']) <= 128,
            'later ROOT source/eligibility/custody allocation missing')
    started, deadline = value['started_at_epoch'], value['deadline_epoch']
    stamp = time.time() if now is None else now
    require(type(started) in (int, float) and type(deadline) in (int, float)
            and started <= stamp < deadline and 0 < deadline - started <= 2700, 'original allocation clock')
    return value


def require_allocation(path, harness_sha, *, now=None, environment=None):
    """ROOT declares later admission, exactly one invocation with no retries."""
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, 'explicit canonical allocation capsule')
    stamp = time.time() if now is None else now
    value = validate_allocation(decode(bounded_file(path, 8192)), harness_sha, now=stamp)
    environment = os.environ if environment is None else environment
    if environment.get('GITHUB_ACTIONS') == 'true':
        require(environment.get('GITHUB_RUN_ATTEMPT') == '1'
                and environment.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
                and environment.get('GITHUB_REF', '').startswith('refs/heads/codex/'),
                'hosted path qualification requires first explicit codex dispatch attempt')
    # Exclusive creation consumes this capsule once even if preparation fails.
    receipt = path.with_name(path.name + '.consumed')
    with receipt.open('x') as stream:
        stream.write(json.dumps(dict(allocation_sha256=digest(path.read_bytes()), at=stamp,
                                     H=harness_sha, T=PRODUCT, cases=list(CASES))) + '\n')
    return value


def verify_build(product, app, mode):
    receipt_path = app / 'Contents/Resources/build-receipt.json'
    receipt = decode(bounded_file(receipt_path, 256 * 1024))
    require(receipt.get('version') == 1 and receipt.get('source_head') == PRODUCT
            and receipt.get('source_dirty') is False and receipt.get('mode') == mode
            and receipt.get('engine_identity', {}).get('source_revision') == PRODUCT, 'owning build/source receipt')
    for key, relative in (('native_sha256', 'Contents/MacOS/NACPreview'),
                          ('engine_sha256', 'Contents/Resources/nac-web'), ('info_plist_sha256', 'Contents/Info.plist')):
        require(receipt.get(key) == digest((app / relative).read_bytes()), 'owning build bytes: ' + key)
    for roster in ('native_source_files', 'build_support_files'):
        require(type(receipt.get(roster)) is dict and receipt[roster], 'build source list')
        for relative, expected in receipt[roster].items():
            path = product / relative
            require(path.resolve() == path and path.is_relative_to(product)
                    and digest(path.read_bytes()) == expected, 'build compiler/support input changed')
    if mode == 'app-build':
        require(receipt.get('normal_startup') is True and receipt.get('smoke_instrumentation') is False
                and receipt.get('preview_definitions_excluded') is True
                and receipt.get('fixture_markers_absent'), 'ordinary build exclusions')
    else:
        require(mode == 'smoke-build' and receipt.get('smoke_instrumentation') is True
                and 'desktop/macos/NativePathSmoke.swift' in receipt['native_source_files'], 'actual path smoke compiler input')
    return receipt


def settle_case(evidence, relocated, collection, settle):
    """Reuse repaired H settlement; missing actor/ownership proof retains roots."""
    record = read_record(evidence, evidence.parent)
    require(collection and collection.get('scope') and collection.get('inputs'), 'no compiled actor custody proof; retain roots')
    scope = collection['scope']
    require(record.get('app_pid') == scope['app_pid'] and record.get('engine_pid') == scope['engine_pid']
            and collection.get('history')
            and record.get('paths_phase') == collection['history'][-1], 'cleanup ownership receipt changed')
    # The accepted 541 settlement owner receives only this exact known record.
    # It retains its source-owned disappearance/engine/later-record handling.
    recovery = evidence.parent.parent / 'cleanup'
    recovery.mkdir(exist_ok=True)
    (recovery / 'evidence').mkdir(exist_ok=True)
    copy = recovery / 'evidence' / evidence.name
    record['relocated_app'] = str(relocated)
    write(copy, record)
    settle(recovery)
    require_settled(record)
    return dict(exact_actor_scope=scope, app_engine_settled=True, profile_removed=True,
                owner='accepted H541 settle_apps; no Finder signal/input/close')


def run_case(raw, product, app, selection, harness_sha, scenario, run, command, settle, deadline, *, build_deadline=None):
    folder = raw / scenario
    folder.mkdir(mode=0o700)
    evidence_dir = folder / 'app-evidence'
    evidence_dir.mkdir(mode=0o700)
    evidence = evidence_dir / 'app.json'  # Sole predeclared app output; no discovery.
    errors = {}
    proof = dict(scenario=scenario, H=harness_sha, T=PRODUCT, native_acceptance=False,
                 visible_paint='requires actual original image review', Finder_window_left_open=True)
    attempted = False
    collection = None
    with relocation_directory(folder) as relocation:
        relocated = relocation['path'] / 'Moved folder with spaces' / app.name
        shutil.copytree(app, relocated)
        require_checkout(product, PRODUCT)
        build = verify_build(product, relocated, 'smoke-build')
        initial = observe_prerequisites(command)
        policy = authorization_policy(initial)
        config = dict(version=1, scenario=scenario, product_sha=PRODUCT, harness_sha=harness_sha,
            helper_sha256=HELPER, app_path=str(relocated), evidence=str(evidence),
            native_sha256=build['native_sha256'], engine_sha256=build['engine_sha256'],
            authorization_policy=policy, compiler_sources=selection['receipt']['sources'])
        config_path = folder / 'configuration.json'
        write(config_path, config)
        config_hash = digest(config_path.read_bytes())
        write(folder / 'prerequisites-before.json', initial)
        derived, result = folder / 'derived', folder / 'path.xcresult'
        tool = AttachmentTool(folder, command)
        stage = 'build'
        try:
            helper_build_limit = min(deadline, build_deadline or deadline) - time.time()
            require(helper_build_limit > 0, 'original build/helper deadline')
            run(['xcodebuild', 'build-for-testing', '-project', selection['project'], '-scheme', selection['scheme'],
                 '-destination', 'platform=macOS,arch=arm64', '-derivedDataPath', str(derived),
                 '-parallel-testing-enabled', 'NO', 'NAC_UI_FIXTURE=' + str(config_path),
                 'NAC_PATH_HARNESS_SHA=' + harness_sha, 'NAC_PATH_CONFIGURATION_SHA256=' + config_hash],
                folder / 'build.log', min(240, helper_build_limit))
            runners = list((derived / 'Build/Products').glob('*.xctestrun'))
            require(len(runners) == 1, 'actual generated runner count')
            data = bounded_file(runners[0], 256 * 1024)
            target = require_generated_runner(plistlib.loads(data), config_path, 'NACPathUITests',
                                               project_selection=selection['receipt'],
                                               paths_binding=dict(harness_sha=harness_sha, configuration_sha256=config_hash))
            proof['runner'] = dict(xctestrun_sha256=digest(data), configuration_sha256=config_hash,
                                   target=target, selection=selection['receipt'])
            write(folder / 'runner.json', proof['runner'])
            stage = 'admission'
            tool.prepare()
            require(authorization_policy(observe_prerequisites(command)) == policy, 'policy changed during build')
            require(digest(config_path.read_bytes()) == config_hash, 'configuration changed during build')
            for source, expected in selection['receipt']['sources'].items():
                require(digest(bounded_file(Path(source), 256 * 1024)) == expected, 'XCTest compiler input changed')
            verify_build(product, relocated, 'smoke-build')
            require(time.time() < deadline, 'original native deadline')
            stage = 'test'
            relocation['safe_to_remove'] = False
            attempted = True
            run(['xcodebuild', 'test-without-building', '-xctestrun', str(runners[0]),
                 '-destination', 'platform=macOS,arch=arm64', '-parallel-testing-enabled', 'NO',
                 '-maximum-concurrent-test-device-destinations', '1', '-resultBundlePath', str(result),
                 '-only-testing:NACPathUITests/PathJourneys/' + TESTS[CASES.index(scenario)]],
                folder / 'test.log', min(480, max(1, deadline - time.time())))
            final_record(read_record(evidence, evidence_dir), scenario)
            proof['product_passed'] = True
        except BaseException as error:
            errors[stage] = type(error).__name__
        finally:
            # Export problems never bypass the independent cleanup attempt.
            if result.exists():
                try:
                    proof['actual_result'] = result_receipt(result)
                    collection = collect(tool, result, config, config_hash, folder / 'attachments', passing=not errors)
                    proof['controller'] = collection
                except BaseException as error:
                    errors['collector'] = type(error).__name__
            elif attempted:
                errors['result'] = 'MissingActualResult'
            if attempted:
                try:
                    proof['cleanup'] = settle_case(evidence, relocated, collection, settle)
                    relocation['safe_to_remove'] = True
                except BaseException as error:
                    errors['cleanup'] = type(error).__name__
                try:
                    after = observe_prerequisites(command)
                    write(folder / 'prerequisites-after.json', after)
                    require(authorization_policy(after) == policy, 'end policy changed')
                    proof['persistent_authorization_policy_unchanged'] = True
                except BaseException as error:
                    errors['policy'] = type(error).__name__
            proof.update(attempted=attempted, errors=errors, source_controls_only=False,
                         passed=attempted and not errors, retained_bundle=not relocation['safe_to_remove'])
            # Actual runner artifacts are hashed above; raw generated build metadata
            # is neither a fixture receipt nor a permitted host diagnostic export.
            if derived.exists():
                shutil.rmtree(derived)
            write(folder / 'essential.json', proof)
    require(proof['passed'], 'path case failed; later case unrun')
    return proof


def qualify(raw, product, target, harness_sha, run, command, settle, allocation):
    require({k: target[k] for k in TARGET} == TARGET, 'fixed two-case target')
    require_checkout(product, PRODUCT)
    require_checkout(ROOT, harness_sha)
    require(os.environ.get('CARGO_BUILD_JOBS') == '2', 'separately allocated Rust jobs=2')
    selection = materialize_project(ROOT, harness_sha, paths_root=product, paths_sha=PRODUCT,
                                   output=raw / 'path-project')
    # Original stage caps never reset between builds or fresh cases. The
    # existing overall H deadline can only shorten this later allocation.
    build_deadline = min(allocation['started_at_epoch'] + 1200, allocation['deadline_epoch'] - 600)
    def build(mode, name):
        remaining = build_deadline - time.time()
        require(remaining > 0, 'original build/helper deadline')
        run(['bash', 'desktop/macos/preview.sh', mode], raw / name, min(900, remaining), cwd=product)
    # Existing app writer exclusively owns both builds and their receipts.
    build('app-build', 'path-ordinary-build.log')
    ordinary = verify_build(product, raw / 'NAC.app', 'app-build')
    build('smoke-build', 'path-smoke-build.log')
    smoke = verify_build(product, raw / 'NAC Development Preview Smoke.app', 'smoke-build')
    cases = []
    native_deadline = min(time.time() + 900, allocation['deadline_epoch'] - 600)
    for scenario in CASES:
        require(time.time() < allocation['deadline_epoch'] - 600, 'reserved cleanup/retention clock')
        cases.append(run_case(raw, product, raw / 'NAC Development Preview Smoke.app', selection,
                              harness_sha, scenario, run, command, settle, native_deadline, build_deadline=build_deadline))
    require_checkout(product, PRODUCT)
    require_checkout(ROOT, harness_sha)
    return dict(paths=dict(H=harness_sha, T=PRODUCT, helper_sha256=HELPER, ordinary_build=ordinary,
                           smoke_build=smoke, cases=cases, two_cases_complete=len(cases) == 2,
                           visible_paint='requires actual original image review', native_acceptance=False,
                           Finder_cleanup='residual window retained; no close authority'))
