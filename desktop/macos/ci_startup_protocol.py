"""Consume exact external R tests against the newly built exclusive P package."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import uuid

from ci_qualifications import require_checkout
from ci_startup_fixture import FUTURE_MESSAGE, PRODUCT, canonical, digest
from ci_xctest_attachments import bounded_file
from ci_support import COMPLETE_LOG_LIMIT

REVISION = '7325c48b3c9ec7036e255a6bd92f31c1a98c1607'
FILES = {'Cargo.lock': '8eaf3c5626b70caa5c613f551b5f98ce4746a21bf438f2df13f21410c58eabfa',
         'crates/nac-server/Cargo.toml': 'b909a14e90ef379a3335a8fec6b9c0408ff6f1a2be6b56b3b22644d31e1f10c3',
         'crates/nac-server/tests/desktop_schema_contract.rs': '0eb70e49c7aba12bdb8c8c350246e892e2a5418403ca14a55674f2419a0aab1e'}
SCHEMA_PATH = 'crates/nac-core/src/store/schema.rs'
SCHEMA_SHA256 = 'f737575607380e154ac5b8be7f9116af73bb56e3874a886050f6175a94ba6407'
TESTS = ('future_main_store_is_selected_then_rejected_with_guidance',
         'future_wal_store_is_selected_then_rejected_without_pager_changes',
         'owned_future_store_retains_store_owned_priority', 'unrelated_invalid_store_retains_generic_failure')
SCENARIOS = {'future-main': 'store_schema_incompatible', 'future-wal': 'store_schema_incompatible',
             'busy-future': 'store_owned', 'invalid-db': 'engine_unavailable'}


def require(condition, reason):
    if not condition:
        raise RuntimeError('External startup protocol verifier rejected: ' + reason)


def sources(root):
    root = canonical(root)
    require_checkout(root, REVISION)
    for path, expected in FILES.items():
        file = canonical(root / path)
        require(file.is_file() and digest(file) == expected, 'R_source_hash')
    return root


def admit_protocol_schema(r_source, p_source, manifest_bytes, *, r_sha256, p_sha256,
                          manifest_sha256, product_sha):
    """Pure source/manifest equality admission; no SQLite, compiler or engine."""
    versions = []
    for source, expected in ((r_source, r_sha256), (p_source, p_sha256)):
        require(isinstance(source, bytes) and hashlib.sha256(source).hexdigest() == expected,
                'schema_source_hash')
        definitions = re.findall(rb'\bconst\s+STORE_SCHEMA_VERSION\b', source)
        values = re.findall(rb'^const STORE_SCHEMA_VERSION: i64 = ([0-9]+);$', source, re.MULTILINE)
        require(len(definitions) == len(values) == 1, 'unique_literal_schema_version')
        require(len(values[0]) <= 10, 'safe_schema_successor')
        version = int(values[0])
        require(0 <= version < 2147483647, 'safe_schema_successor')
        versions.append(version)
    require(isinstance(manifest_bytes, bytes)
            and hashlib.sha256(manifest_bytes).hexdigest() == manifest_sha256, 'bound_manifest_hash')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate_manifest_field')
            result[key] = value
        return result
    try:
        body = json.loads(manifest_bytes, object_pairs_hook=unique)
        source = body['identity']['source']
        recorded = source['store_schema']
        require(source['revision'] == product_sha and type(recorded) is int,
                'manifest_source_schema')
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('External startup protocol verifier rejected: manifest_source_schema') from None
    require(versions[0] == versions[1] == recorded, 'R_P_manifest_schema_equality')
    return dict(R_supported_schema=versions[0], P_supported_schema=versions[1],
                manifest_store_schema=recorded, fixture_main_schema=versions[0],
                fixture_future_schema=versions[0] + 1, R_schema_source_sha256=r_sha256,
                P_schema_source_sha256=p_sha256, manifest_sha256=manifest_sha256)


def schema_alignment(root, product, manifest, package_admission):
    root = sources(root)
    product, manifest = canonical(product), canonical(manifest)
    require_checkout(product, PRODUCT)
    provenance = package_admission['provenance']
    require(provenance['source_sha'] == PRODUCT
            and provenance['engine_identity']['source_revision'] == PRODUCT, 'schema_package_source')
    result = admit_protocol_schema(
        bounded_file(canonical(root / SCHEMA_PATH), 256 * 1024),
        bounded_file(canonical(product / SCHEMA_PATH), 256 * 1024),
        bounded_file(manifest, 256 * 1024), r_sha256=SCHEMA_SHA256, p_sha256=SCHEMA_SHA256,
        manifest_sha256=provenance['manifest_sha256'], product_sha=PRODUCT)
    return dict(R=REVISION, P=PRODUCT, **result)


def build(root, output, run, *, product, manifest, package_admission):
    """Called only inside the job's Rust lane; copy before releasing ownership."""
    alignment = schema_alignment(root, product, manifest, package_admission)
    root = canonical(root)
    output.mkdir(mode=0o700)
    log = output / 'protocol-build.log'
    env = {**os.environ, 'NAC_SOURCE_REVISION': REVISION, 'NAC_BUILD_TRACK': 'dev', 'NAC_BUILD_ID': 'dev-' + REVISION}
    run(['cargo', 'test', '--locked', '-p', 'nac-server', '--test', 'desktop_schema_contract',
         '--no-run', '--message-format=json'], log, 900, cwd=root, env=env,
        complete_output_limit=COMPLETE_LOG_LIMIT)
    artifacts = []
    for line in log.read_text().splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if (record.get('reason') == 'compiler-artifact' and record.get('target', {}).get('name') == 'desktop_schema_contract'
                and record.get('target', {}).get('kind') == ['test']
                and record.get('profile', {}).get('test') is True and record.get('executable')):
            artifacts.append(Path(record['executable']))
    require(len(artifacts) == 1, 'actual_test_artifact')
    executable = canonical(artifacts[0])
    private = output / 'desktop_schema_contract'
    shutil.copy2(executable, private)
    private.chmod(0o500)
    require(digest(private) == digest(executable), 'private_runner_copy')
    run([str(private), 'adapter_', '--nocapture'], output / 'protocol-adapter-controls.log', 90,
        cwd=root, env={'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(output), 'TMPDIR': str(output), 'LANG': 'en_US.UTF-8'})
    require(schema_alignment(root, product, manifest, package_admission) == alignment,
            'schema_alignment_changed_during_build')
    receipt = {'R': REVISION, 'P': PRODUCT, 'R_files': FILES, 'schema_alignment': alignment, 'test_executable_sha256': digest(private),
               'actual_Cargo_artifact_path': str(executable), 'private_executable': str(private),
               'build_log_sha256': digest(log), 'scope': 'R verifier source/build only; no product or UI acceptance'}
    (output / 'protocol-runner.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return private, receipt


def validate_record(row, scenario, engine, engine_sha256, identity, runner_sha256):
    require(isinstance(row, dict) and row.get('schema') == 'nac356-private-protocol-observation-v1'
            and row.get('scenario') == scenario and row.get('result') == 'passed', 'record_schema_or_result')
    require(row.get('test_compiler_git_revision') == REVISION and row.get('test_source_sha256') ==
            FILES['crates/nac-server/tests/desktop_schema_contract.rs']
            and row.get('test_executable_sha256') == runner_sha256, 'R_executable_source')
    require(row.get('engine_path') == str(engine) and row.get('engine_sha256_observed') == engine_sha256
            and row.get('engine_identity_observed') == identity and row.get('expected_target') == [engine_sha256, identity],
            'actual_P_target')
    wire = row.get('raw_wire_utf8')
    require(isinstance(wire, str), 'raw_wire_missing')
    data = wire.encode()
    require(0 < len(data) <= 16 * 1024 and data.endswith(b'\n') and data.count(b'\n') == 1
            and hashlib.sha256(data).hexdigest() == row.get('raw_wire_sha256'), 'raw_wire_framing_digest')
    observed, hello = json.loads(data), row.get('hello_sent', {})
    require(isinstance(observed, dict) and isinstance(hello, dict)
            and set(observed) == {'kind', 'version', 'incarnation', 'stage', 'code', 'message'}, 'private_record_fields')
    require(observed == row.get('observed_record') and observed.get('kind') == 'failed'
            and type(observed.get('version')) is int and observed['version'] == 1
            and observed.get('stage') == 'startup' and observed.get('code') == SCENARIOS[scenario]
            and observed.get('incarnation') == hello.get('incarnation') and 'endpoint' not in observed,
            'authentic_private_failure')
    require(hello.get('kind') == 'hello' and type(hello.get('version')) is int and hello['version'] == 1
            and hello.get('identity') == identity and isinstance(hello.get('store'), str)
            and Path(hello['store']).is_absolute()
            and isinstance(hello.get('incarnation'), str) and len(hello['incarnation']) == 36, 'hello_binding')
    try:
        require(str(uuid.UUID(hello['incarnation'])) == hello['incarnation'].lower(), 'hello_nonce')
    except ValueError:
        raise RuntimeError('External startup protocol verifier rejected: hello_nonce') from None
    selection = row.get('preflight_selection_observed', {})
    require(type(selection.get('version')) is int and selection['version'] == 1
            and selection.get('status') == 'selected' and selection.get('store') == hello.get('store')
            and selection.get('track') == identity['track'], 'selection_vs_serving')
    if scenario in ('future-main', 'future-wal'):
        require(observed.get('message') == FUTURE_MESSAGE, 'exact_future_guidance')
    before = row.get('store_before_sha256')
    require(isinstance(before, list) and len(before) == 3 and isinstance(before[0], str)
            and all(value is None or re.fullmatch('[0-9a-f]{64}', str(value)) for value in before)
            and re.fullmatch('[0-9a-f]{64}', str(row.get('config_before_sha256', ''))), 'protected_file_digests')
    require(type(row.get('exit_code')) is int and row['exit_code'] == 1 and row.get('extra_record_absent') is True
            and row.get('preserved_store_config') is True and row.get('alternate_database_absent') is True
            and row.get('lease_reacquired') is True
            and row.get('store_before_sha256') == row.get('store_after_sha256')
            and row.get('config_before_sha256') == row.get('config_sha256'), 'preservation_or_retirement')
    for key in ('configuration', 'identity_inspection', 'serving_supervision'):
        part = row.get(key, {})
        cleanup = part.get('cleanup', {})
        require(part.get('cleanup_error') is None and cleanup.get('result') == 'ok'
                and cleanup.get('port') == 'finish_checked' and cleanup.get('direct_child_reaped') is True,
                'existing_owner_supervision')
    require(row.get('profile_cleanup') == {'result': 'ok', 'error': None}, 'owned_profile_cleanup')
    return {'scenario': scenario, 'raw_wire_sha256': row['raw_wire_sha256'], 'actual_code': observed['code'],
            'incarnation': observed['incarnation'], 'preserved_store_config': True, 'owner_cleanup': True,
            'scope': 'Authentic external Rust process evidence only; ordinary app UI/private pipe not observed'}


def verify(private, runner, app, manifest, package_admission, output, run):
    """Strict runtime override; never execute the test's default compiled engine."""
    app, manifest, private = canonical(app), canonical(manifest), canonical(private)
    engine = canonical(app / 'Contents/Resources/nac-web')
    require(runner.get('R') == REVISION and runner.get('P') == PRODUCT and runner.get('R_files') == FILES
            and str(private) == runner.get('private_executable')
            and digest(private) == runner['test_executable_sha256'], 'frozen_R_runner')
    manifest_source = json.loads(bounded_file(manifest, 256 * 1024))['identity']['source']
    alignment = runner.get('schema_alignment', {})
    require(alignment.get('R') == REVISION and alignment.get('P') == PRODUCT
            and alignment.get('manifest_sha256') == digest(manifest)
            and manifest_source.get('revision') == PRODUCT
            and type(manifest_source.get('store_schema')) is int
            and alignment.get('manifest_store_schema') == manifest_source['store_schema']
            and alignment.get('R_schema_source_sha256') == SCHEMA_SHA256
            and alignment.get('P_schema_source_sha256') == SCHEMA_SHA256
            and type(alignment.get('R_supported_schema')) is int
            and alignment['R_supported_schema'] == alignment.get('P_supported_schema')
                == alignment.get('manifest_store_schema') == alignment.get('fixture_main_schema')
            and 0 <= alignment['R_supported_schema'] < 2147483647
            and alignment.get('fixture_future_schema') == alignment['R_supported_schema'] + 1,
            'required_schema_alignment_receipt')
    identity = package_admission['provenance']['engine_identity']
    post = package_admission['provenance']['post_sign_receipt']
    require(identity['source_revision'] == PRODUCT and digest(engine) == post['engine_sha256']
            and digest(manifest) == package_admission['provenance']['manifest_sha256'], 'current_package_phase')
    output.mkdir(mode=0o700)
    home, temporary = output / 'home', output / 'tmp'
    home.mkdir(mode=0o700)
    temporary.mkdir(mode=0o700)
    records = output / 'records'
    env = {'HOME': str(home), 'TMPDIR': str(temporary), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8',
           'NAC_DESKTOP_SCHEMA_ENGINE': str(engine), 'NAC_DESKTOP_SCHEMA_SHA256': post['engine_sha256'],
           'NAC_DESKTOP_SCHEMA_IDENTITY': json.dumps(identity, sort_keys=True), 'NAC_DESKTOP_SCHEMA_OUTPUT': str(records)}
    # Rust owns its four independent profiles, canonical output and checked
    # process-tree retirement. H does not add PID discovery/signals here.
    run([str(private), '--exact', *TESTS, '--nocapture'], output / 'protocol-actual.log', 120, env=env)
    require(records.is_dir() and not records.is_symlink()
            and {p.name for p in records.iterdir()} == {name + '.json' for name in SCENARIOS}, 'four_actual_records')
    observations = []
    for scenario in SCENARIOS:
        data = bounded_file(records / (scenario + '.json'), 64 * 1024)
        observation = validate_record(json.loads(data), scenario, engine, post['engine_sha256'], identity,
                                      runner['test_executable_sha256'])
        observations.append({**observation, 'source_record_sha256': hashlib.sha256(data).hexdigest()})
    require(digest(engine) == post['engine_sha256'] and digest(manifest) == package_admission['provenance']['manifest_sha256'],
            'package_changed_after_verification')
    receipt = {'R': REVISION, 'P': PRODUCT, 'manifest_sha256': digest(manifest), 'engine_sha256': digest(engine),
               'runner_sha256': runner['test_executable_sha256'], 'schema_alignment': alignment, 'observations': observations,
               'native_UI_qualified': False, 'scope': 'Four standalone private process cases only; native matrix still exactly four UI cases'}
    (output / 'protocol-proof.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt
