"""Bounded diagnostic-only XCTest checkpoints on disposable hosted Macs."""
import json
import os
from pathlib import Path
import plistlib
import re
import signal
import subprocess
import sys
import tempfile
from urllib.error import HTTPError

from postprocess import read_owned

H = '06296d236d42422ede804856de6f240a06d9c535'
TARGET = 'NACDiagnosticUITests'
TEST_ID = 'CheckpointJourneys/testSnapshot()'
TEST_URL = 'test://com.apple.xcode/NACNativeUITests/NACDiagnosticUITests/CheckpointJourneys/testSnapshot'


def parse_export(export):
    """Read only the unique fixed Q-prime attachment; never print exported data."""
    try:
        raw = read_owned(export, ('manifest.json',), 256 * 1024)
        def unique(pairs):
            if len(dict(pairs)) != len(pairs):
                raise ValueError('duplicate key')
            return dict(pairs)
        manifest = json.loads(raw, object_pairs_hook=unique,
                              parse_constant=lambda _: (_ for _ in ()).throw(ValueError('constant')))
        if type(manifest) is not list or len(manifest) != 1 or type(manifest[0]) is not dict:
            return 'unknown'
        group = manifest[0]
        if group.get('testIdentifier') != TEST_ID or group.get('testIdentifierURL', TEST_URL) != TEST_URL:
            return 'unknown'
        entries = group.get('attachments')
        if type(entries) is not list or len(entries) > 4096:
            return 'unknown'
        selected = [item for item in entries if type(item) is dict
                    and re.fullmatch(r'nac-local-network-checkpoint-v1(?:_\d+_[0-9a-fA-F-]{36})?(?:\.txt)?',
                                     str(item.get('suggestedHumanReadableName', '')))]
        if len(selected) != 1:
            return 'unknown'
        name = selected[0].get('exportedFileName')
        if (type(name) is not str or name in ('', '.', '..') or '/' in name or '\\' in name or '\0' in name
                or sum(1 for item in entries if type(item) is dict and item.get('exportedFileName') == name) != 1):
            return 'unknown'
        data = read_owned(export, (name,), 64)
        return 'ocr_title_match' if data == b'ocr_title_match' else 'unknown'
    except (OSError, ValueError, TypeError):
        return 'unknown'


def execute(argv, cwd, timeout, log):
    """Direct-owned process group only; raw compiler/test output stays private."""
    with open(log, 'wb') as stream:
        process = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=stream,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return process.wait(timeout=timeout) == 0
        except subprocess.TimeoutExpired:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
            return False


def project(h, diagnostic, output):
    """Use the exact H maintained project, with a separate diagnostic Q-prime."""
    sys.path.insert(0, str(h / 'desktop/macos'))
    import ci_xctest_project as owner
    owner.checkout(h, H)
    expected_q = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=diagnostic, text=True).strip()
    owner.checkout(diagnostic, expected_q)
    _, base = owner.source_file(h, owner.PROJECT / 'project.pbxproj')
    _, scheme = owner.source_file(h, owner.PROJECT / owner.SCHEME)
    native, _ = owner.source_file(h, owner.NATIVE)
    q, source = owner.source_file(diagnostic, Path('diagnostics/local-network/CheckpointJourneys.swift'))
    if owner.digest(base) != owner.PROJECT_HASH or owner.digest(scheme) != owner.SCHEME_HASH:
        raise ValueError('H project identity')
    generated = owner.source_variant(base, native, q, owner.digest(source), TARGET, 'DIAGNOSTIC')
    selected = scheme.replace(b'NACNativeUITests', TARGET.encode()).replace(
        b'A10000000000000000000004', b'B10000000000000000000004').replace(
        ('container:' + TARGET + '.xcodeproj').encode(), b'container:NACNativeUITests.xcodeproj')
    owner.checkout(h, H)
    owner.checkout(diagnostic, expected_q)
    output.mkdir(mode=0o700)
    path = output / owner.PROJECT.name
    schemes = path / owner.SCHEME.parent
    schemes.mkdir(parents=True)
    (path / 'project.pbxproj').write_bytes(generated)
    (schemes / (TARGET + '.xcscheme')).write_bytes(selected)
    return path


def make_fixture(diagnostic, private):
    app = private / 'Fixture.app'
    binary = app / 'Contents/MacOS/CheckpointFixture'
    binary.parent.mkdir(parents=True)
    info = {'CFBundleIdentifier': 'ai.arcee.nac.diagnostic.checkpoint',
            'CFBundleName': 'NAC Diagnostic', 'CFBundleExecutable': 'CheckpointFixture',
            'CFBundlePackageType': 'APPL', 'NSPrincipalClass': 'NSApplication'}
    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
    source = diagnostic / 'diagnostics/local-network/CheckpointFixture.swift'
    if not execute(['xcrun', 'swiftc', str(source), '-o', str(binary)], diagnostic, 120, private / 'fixture-build.log'):
        return None
    if not execute(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], diagnostic, 30, private / 'fixture-sign.log'):
        return None
    return app


def checkpoint(project_path, app, private, name):
    result = private / (name + '.xcresult')
    derived = private / 'derived'
    runners = list((derived / 'Build/Products').glob('*.xctestrun'))
    if len(runners) != 1:
        return 'unknown'
    argv = ['xcodebuild', 'test-without-building', '-xctestrun', str(runners[0]),
            '-destination', 'platform=macOS,arch=arm64', '-parallel-testing-enabled', 'NO',
            '-maximum-concurrent-test-device-destinations', '1', '-resultBundlePath', str(result),
            '-only-testing:' + TARGET + '/CheckpointJourneys/testSnapshot']
    if not execute(argv, project_path.parent, 180, private / (name + '.log')):
        return 'unknown'
    export = private / (name + '-export')
    if not execute(['xcrun', 'xcresulttool', 'export', 'attachments', '--path', str(result),
                    '--test-id', TEST_URL, '--output-path', str(export)], project_path.parent, 60,
                   private / (name + '-export.log')):
        return 'unknown'
    return parse_export(export)


def compare(cell, snapshot, provider_factory, request):
    result = {'diagnostic_only': True, 'cell': cell, 'before_image': 'unknown', 'after_image': 'unknown',
              'operation': 'not_started', 'owned_provider_settlement': 'not_applicable',
              'fixture_process_settlement': 'unknown', 'modal': 'unknown', 'scope': 'diagnostic_fixture_window'}
    result['before_image'] = snapshot('before')
    if cell == 'idle':
        result['operation'] = 'completed'
        result['after_image'] = snapshot('after')
        return result
    if cell not in ('provider', 'loopback'):
        return result
    provider = provider_factory()
    try:
        base = provider.start()
        if cell == 'loopback':
            try:
                request(base, '/')
            except HTTPError:
                pass
        result['operation'] = 'completed'
        result['after_image'] = snapshot('after')
    except Exception:
        result['operation'] = 'unavailable'
    finally:
        try:
            provider.stop(require_complete=False)
            result['owned_provider_settlement'] = 'settled' if provider.settled else 'unknown'
        except Exception:
            result['owned_provider_settlement'] = 'unknown'
    return result


def main():
    cell, harness, controller, temp = sys.argv[1:]
    h, diagnostic, temp = (Path(p).resolve(strict=True) for p in (harness, controller, temp))
    result = {'diagnostic_only': True, 'cell': cell, 'before_image': 'unknown', 'after_image': 'unknown',
              'operation': 'unavailable', 'owned_provider_settlement': 'unknown',
              'fixture_process_settlement': 'unknown', 'modal': 'unknown', 'scope': 'diagnostic_fixture_window'}
    try:
        # This host is disposable. Keep the private tree until host teardown:
        # test-runner failure cannot positively establish app settlement.
        private = Path(tempfile.mkdtemp(prefix='nac-diagnostic-qprime-', dir=temp))
        selected = project(h, diagnostic, private / 'project')
        app = make_fixture(diagnostic, private)
        if app is None:
            raise ValueError('fixture unavailable')
        derived = private / 'derived'
        build = ['xcodebuild', 'build-for-testing', '-project', str(selected), '-scheme', TARGET,
                 '-destination', 'platform=macOS,arch=arm64', '-derivedDataPath', str(derived),
                 '-parallel-testing-enabled', 'NO', 'NAC_UI_FIXTURE=' + str(app)]
        if not execute(build, diagnostic, 180, private / 'build.log'):
            raise ValueError('test build unavailable')
        sys.path.insert(0, str(h / 'desktop/macos'))
        from ci_startup_api import Provider, request
        result = compare(cell, lambda name: checkpoint(selected, app, private, name), Provider, request)
    except Exception:
        pass
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
