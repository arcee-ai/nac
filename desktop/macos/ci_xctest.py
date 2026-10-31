"""Shared public XCTest launcher; never provisions host permissions."""
import hashlib
import json
from contextlib import contextmanager
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

from ci_support import require_terminal_evidence
from smoke import cleanup_failed_case

ROOT = Path(__file__).resolve().parents[2]


@contextmanager
def relocation_directory(raw):
    """Never remove an input-launched bundle before ownership cleanup settles."""
    path = Path(tempfile.mkdtemp(prefix='nac-mac-relocation-'))
    lease = {'path': path, 'safe_to_remove': True}
    try:
        yield lease
    finally:
        if lease['safe_to_remove']:
            shutil.rmtree(path)
        (raw / 'xctest-relocation.json').write_text(json.dumps({
            'path': str(path), 'bundle_retained_for_unresolved_cleanup': not lease['safe_to_remove']}, indent=2) + '\n')


def require_settled(record, process_status=None):
    if type(record.get('app_pid')) is not int or record['app_pid'] <= 0:
        raise RuntimeError('No exact app ownership record; preserve relocated bundle for diagnosis')
    def status(pid):
        result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
        if result.returncode not in (0, 1):
            raise RuntimeError('Cannot observe owned fixture process settlement')
        return result.stdout.strip()
    for key in ('app_pid', 'engine_pid'):
        pid = record.get(key, 0)
        if type(pid) is not int or pid < 0:
            raise RuntimeError('Invalid exact fixture process identity')
        if pid:
            state = (process_status or status)(pid)
            if state and not state.startswith('Z'):
                raise RuntimeError('Owned XCTest fixture process survived cleanup: ' + key)
    profile = record.get('profile')
    if not profile or Path(profile).is_symlink() or Path(profile).exists():
        raise RuntimeError('Owned XCTest fixture profile removal unavailable/incomplete')


def require_prerequisites(helper_auth, developer_status, automation_status):
    if (helper_auth.strip() != '2' or 'enabled' not in developer_status.lower()
            or 'disabled' in developer_status.lower()
            or 'DOES NOT REQUIRE' not in automation_status):
        raise RuntimeError('XCTest unavailable: existing helper authorization/developer automation prerequisites missing; no grant requested')
    return {'xcode_helper_accessibility_auth': 2, 'developer_status': developer_status,
            'automation_status': automation_status,
            'declared_no_permission_mutation_commands': True}


def observe_prerequisites(command):
    rows = json.loads(command(['/usr/bin/sudo', '-n', '/usr/bin/sqlite3', '-json', '-readonly',
        '/Library/Application Support/com.apple.TCC/TCC.db',
        "SELECT service,client,client_type,auth_value,auth_reason,auth_version,hex(csreq) AS csreq_hex,"
        "policy_id,indirect_object_identifier_type,indirect_object_identifier,"
        "hex(indirect_object_code_identity) AS indirect_identity_hex,flags,last_modified "
        "FROM access WHERE service='kTCCServiceAccessibility' AND client='com.apple.dt.Xcode-Helper' AND client_type=0;"]) or '[]')
    return {'xcode_helper_accessibility_rows': rows,
            'developer_status': command(['/usr/sbin/DevToolsSecurity', '-status']),
            'automation_status': command(['automationmodetool'])}


def authorization_policy(observation):
    rows = observation['xcode_helper_accessibility_rows']
    if (len(rows) != 1 or rows[0].get('service') != 'kTCCServiceAccessibility'
            or rows[0].get('client') != 'com.apple.dt.Xcode-Helper' or rows[0].get('client_type') != 0):
        raise RuntimeError('Missing or ambiguous existing Xcode Helper authorization; no grant requested')
    require_prerequisites(str(rows[0].get('auth_value')), observation['developer_status'], observation['automation_status'])
    # Mode enabled/disabled is transient session state, independent from its
    # existing no-auth configuration. Timestamps are retained, not policy.
    return {'helper': {key: value for key, value in rows[0].items() if key != 'last_modified'},
            'developer_mode_enabled': True, 'automation_authentication_required': False}


def require_generated_runner(data, config_path):
    """Inspect Xcode's actual generated runner without manufacturing metadata."""
    def dictionaries(value):
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from dictionaries(child)
        elif isinstance(value, list):
            for child in value:
                yield from dictionaries(child)
    matches = [node for node in dictionaries(data)
               if node.get('IsUITestBundle') is True and node.get('BlueprintName') == 'NACNativeUITests']
    if len(matches) != 1:
        raise RuntimeError('Expected exactly one actual generated native UI test target')
    target = matches[0]
    if (target.get('EnvironmentVariables', {}).get('NAC_UI_FIXTURE') != str(config_path)
            or not target.get('TestBundlePath', '').endswith('.xctest')):
        raise RuntimeError('Generated XCTest runner did not bind the exact fixture configuration')
    return target


def result_receipt(path):
    """Bind sanitized tool exports to the real generated result bundle."""
    if not path.is_dir() or path.is_symlink():
        raise RuntimeError('Xcode did not generate its required result bundle')
    digest = hashlib.sha256()
    count = total = 0
    for file in sorted(path.rglob('*')):
        if file.is_symlink():
            raise RuntimeError('Unexpected symlink in generated XCTest result')
        if not file.is_file():
            continue
        size = file.stat().st_size
        total += size
        count += 1
        digest.update(str(file.relative_to(path)).encode() + b'\0' + str(size).encode() + b'\0')
        with file.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
    return {'files': count, 'bytes': total, 'tree_sha256': digest.hexdigest(),
            'retention': 'Sanitized xcresulttool export only; raw result may contain host diagnostics'}


def run_terminal(raw, run, command, *, app_name='NAC Development Preview Smoke.app',
                 scenario='ci-terminal-xctest', test_name='testTrustedLocalTerminal',
                 operations=None, validate=require_terminal_evidence, cleanup=cleanup_failed_case):
    # Every command here is an observation. Missing prerequisites stop before
    # XCTest launch; enabling automation or requesting Accessibility is forbidden.
    status = observe_prerequisites(command)
    (raw / 'xctest-prerequisites.json').write_text(json.dumps(status, indent=2) + '\n')
    initial_policy = authorization_policy(status)
    evidence = raw / 'evidence' / (scenario + '.json')
    evidence.parent.mkdir(exist_ok=True)
    app = raw / app_name
    result = raw / 'native-input.xcresult'
    with relocation_directory(raw) as relocation, \
            tempfile.TemporaryDirectory(prefix='nac-xctest-build-') as derived:
        relocated = relocation['path'] / 'Moved folder with spaces' / app.name
        shutil.copytree(app, relocated)
        executable = relocated / 'Contents/MacOS/NACPreview'
        native_hash = hashlib.sha256(executable.read_bytes()).hexdigest()
        config = raw / 'xctest-fixture.json'
        config.write_text(json.dumps({'app_path': str(relocated), 'evidence': str(evidence),
                                      'native_sha256': native_hash, 'scenario': scenario,
                                      'operations': operations,
                                      'driver_evidence': str(raw / 'xctest-driver.json')}, indent=2) + '\n')
        run(['xcodebuild', 'build-for-testing', '-project',
             'desktop/macos/NativeUITests/NACNativeUITests.xcodeproj', '-scheme', 'NACNativeUITests',
             '-destination', 'platform=macOS,arch=arm64', '-derivedDataPath', derived,
             '-parallel-testing-enabled', 'NO', 'NAC_UI_FIXTURE=' + str(config)],
            raw / 'xctest-build.log', 180)
        runners = list((Path(derived) / 'Build/Products').glob('*.xctestrun'))
        if len(runners) != 1:
            raise RuntimeError('Xcode must generate exactly one real .xctestrun')
        runner_bytes = runners[0].read_bytes()
        generated = plistlib.loads(runner_bytes)
        target = require_generated_runner(generated, config)
        metadata = {'generator': 'xcodebuild build-for-testing',
                    'xctestrun_sha256': hashlib.sha256(runner_bytes).hexdigest(),
                    'fixture_sha256': hashlib.sha256(config.read_bytes()).hexdigest(),
                    'native_sha256': native_hash, 'generated_target': target}
        (raw / 'xctest-runner.json').write_text(json.dumps(metadata, indent=2) + '\n')
        before = None
        try:
            before = observe_prerequisites(command)
            (raw / 'xctest-prerequisites-before.json').write_text(json.dumps(before, indent=2) + '\n')
            if authorization_policy(before) != initial_policy:
                raise RuntimeError('Existing XCTest authorization policy changed during build; stopping before input')
            if hashlib.sha256(config.read_bytes()).hexdigest() != metadata['fixture_sha256']:
                raise RuntimeError('XCTest fixed fixture configuration changed during build')
            relocation['safe_to_remove'] = False
            run(['xcodebuild', 'test-without-building', '-xctestrun', str(runners[0]),
                 '-destination', 'platform=macOS,arch=arm64', '-parallel-testing-enabled', 'NO',
                 '-maximum-concurrent-test-device-destinations', '1', '-resultBundlePath', str(result),
                 '-only-testing:NACNativeUITests/NativeJourneys/' + test_name],
                raw / 'xctest-input.log', 420 if operations else 240)
            record = json.loads(evidence.read_text())
            if operations and (record.get('terminal_xctest_identity', {}).get('bundle_path') != str(relocated.resolve())
                               or hashlib.sha256(executable.read_bytes()).hexdigest() != native_hash):
                raise RuntimeError('Terminal XCTest runtime bundle/executable binding differs')
            terminal = validate(record)
            if record.get('engine_reaped') is not True or record.get('profile_removed') is not True:
                raise RuntimeError('Native XCTest fixture cleanup incomplete')
            return {'prerequisites': status, 'runner': metadata, 'terminal': terminal}
        finally:
            try:
                if evidence.exists():
                    record = json.loads(evidence.read_text())
                    record.update(relocated_app=str(relocated), native_sha256=native_hash)
                    evidence.write_text(json.dumps(record, indent=2) + '\n')
                    # Existing exact-bundle cleanup while the bundle exists,
                    # including failed XCTest assertions or a timeout.
                    if not record.get('engine_reaped') or not record.get('profile_removed'):
                        cleanup(evidence, relocated)
                    require_settled(record)
                    relocation['safe_to_remove'] = True
                elif not relocation['safe_to_remove']:
                    raise RuntimeError('Input launch produced no ownership receipt; preserving exact relocated bundle')
            finally:
                try:
                    after = observe_prerequisites(command)
                    (raw / 'xctest-prerequisites-after.json').write_text(json.dumps(after, indent=2) + '\n')
                    unchanged = before is not None and authorization_policy(after) == authorization_policy(before)
                    (raw / 'xctest-policy-comparison.json').write_text(json.dumps({
                        'persistent_authorization_policy_unchanged': unchanged,
                        'transient_active_mode_compared': False}, indent=2) + '\n')
                    if not unchanged:
                        raise RuntimeError('Persistent XCTest authorization policy changed; qualification stopped')
                finally:
                    if result.exists():
                        (raw / 'xctest-result.json').write_text(json.dumps(result_receipt(result), indent=2) + '\n')
                        summary = command(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(result)])
                        (raw / 'xctest-summary.json').write_text(json.dumps(json.loads(summary), indent=2) + '\n')
