"""One supported XCTest keyboard journey; never provisions host permissions."""
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import tempfile

from ci_support import require_terminal_evidence
from smoke import cleanup_failed_case

ROOT = Path(__file__).resolve().parents[2]


def require_prerequisites(helper_auth, developer_status, automation_status):
    if (helper_auth.strip() != '2' or 'enabled' not in developer_status.lower()
            or 'disabled' in developer_status.lower()
            or 'DOES NOT REQUIRE' not in automation_status):
        raise RuntimeError('XCTest unavailable: existing helper authorization/developer automation prerequisites missing; no grant requested')
    return {'xcode_helper_accessibility_auth': 2, 'developer_status': developer_status,
            'automation_status': automation_status, 'permission_mutations': False}


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


def run_terminal(raw, run, command):
    # Every command here is an observation. Missing prerequisites stop before
    # XCTest launch; enabling automation or requesting Accessibility is forbidden.
    status = require_prerequisites(
        command(['/usr/bin/sudo', '-n', '/usr/bin/sqlite3', '-readonly',
                 '/Library/Application Support/com.apple.TCC/TCC.db',
                 "SELECT auth_value FROM access WHERE service='kTCCServiceAccessibility' AND client='com.apple.dt.Xcode-Helper' AND client_type=0;"]),
        command(['/usr/sbin/DevToolsSecurity', '-status']), command(['automationmodetool']))
    (raw / 'xctest-prerequisites.json').write_text(json.dumps(status, indent=2) + '\n')
    evidence = raw / 'evidence/ci-terminal-xctest.json'
    app = raw / 'NAC Development Preview Smoke.app'
    result = raw / 'native-input.xcresult'
    with tempfile.TemporaryDirectory(prefix='nac-mac-relocation-') as temporary, \
            tempfile.TemporaryDirectory(prefix='nac-xctest-build-') as derived:
        relocated = Path(temporary) / 'Moved folder with spaces' / app.name
        shutil.copytree(app, relocated)
        executable = relocated / 'Contents/MacOS/NACPreview'
        native_hash = hashlib.sha256(executable.read_bytes()).hexdigest()
        config = raw / 'xctest-fixture.json'
        config.write_text(json.dumps({'app_path': str(relocated), 'evidence': str(evidence),
                                      'native_sha256': native_hash}, indent=2) + '\n')
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
                    'native_sha256': native_hash, 'generated_target': target}
        (raw / 'xctest-runner.json').write_text(json.dumps(metadata, indent=2) + '\n')
        try:
            run(['xcodebuild', 'test-without-building', '-xctestrun', str(runners[0]),
                 '-destination', 'platform=macOS,arch=arm64', '-parallel-testing-enabled', 'NO',
                 '-maximum-concurrent-test-device-destinations', '1', '-resultBundlePath', str(result),
                 '-only-testing:NACNativeUITests/NativeJourneys/testTrustedLocalTerminal'],
                raw / 'xctest-input.log', 240)
            record = json.loads(evidence.read_text())
            terminal = require_terminal_evidence(record)
            if record.get('engine_reaped') is not True or record.get('profile_removed') is not True:
                raise RuntimeError('Native XCTest fixture cleanup incomplete')
            return {'prerequisites': status, 'runner': metadata, 'terminal': terminal}
        finally:
            if evidence.exists():
                record = json.loads(evidence.read_text())
                record.update(relocated_app=str(relocated), native_sha256=native_hash)
                evidence.write_text(json.dumps(record, indent=2) + '\n')
                # Use the existing exact-bundle cleanup while that bundle still
                # exists, including on failed XCTest assertions or a timeout.
                if not record.get('engine_reaped') or not record.get('profile_removed'):
                    cleanup_failed_case(evidence, relocated)
            if result.exists():
                (raw / 'xctest-result.json').write_text(json.dumps(result_receipt(result), indent=2) + '\n')
                summary = command(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(result)])
                (raw / 'xctest-summary.json').write_text(json.dumps(json.loads(summary), indent=2) + '\n')
