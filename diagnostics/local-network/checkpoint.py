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


def parse_export(export, positive=False, folder=False):
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
            return ('unknown', 'attachment_invalid')
        group = manifest[0]
        method = 'testPositiveControl' if positive else 'testFolderControl' if folder else 'testSnapshot'
        test_id = 'CheckpointJourneys/' + method + '()'
        test_url = TEST_URL.replace('testSnapshot', method)
        if group.get('testIdentifier') != test_id or group.get('testIdentifierURL', test_url) != test_url:
            return ('unknown', 'attachment_invalid')
        entries = group.get('attachments')
        if type(entries) is not list or len(entries) > 4096:
            return ('unknown', 'attachment_invalid')
        selected = [item for item in entries if type(item) is dict
                    and re.fullmatch(r'nac-local-network-checkpoint-v1(?:_\d+_[0-9a-fA-F-]{36})?(?:\.txt)?',
                                     str(item.get('suggestedHumanReadableName', '')))]
        if len(selected) != 1:
            return ('unknown', 'attachment_invalid')
        name = selected[0].get('exportedFileName')
        if (type(name) is not str or name in ('', '.', '..') or '/' in name or '\\' in name or '\0' in name
                or sum(1 for item in entries if type(item) is dict and item.get('exportedFileName') == name) != 1):
            return ('unknown', 'attachment_invalid')
        data = read_owned(export, (name,), 64)
        if data not in (b'ocr_title_match', b'unknown'):
            return ('unknown', 'attachment_invalid')
        return (data.decode('ascii'), 'ocr_complete')
    except (OSError, ValueError, TypeError):
        return ('unknown', 'attachment_invalid')


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


def make_fixture(diagnostic, product, private):
    app = private / 'Fixture.app'
    binary = app / 'Contents/MacOS/CheckpointFixture'
    binary.parent.mkdir(parents=True)
    info = {'CFBundleIdentifier': 'ai.arcee.nac.diagnostic.checkpoint',
            'CFBundleName': 'NAC Diagnostic', 'CFBundleExecutable': 'CheckpointFixture',
            'CFBundlePackageType': 'APPL', 'NSPrincipalClass': 'NSApplication'}
    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
    source = diagnostic / 'diagnostics/local-network/CheckpointFixture.swift'
    owners = [product / 'desktop/macos/NativeFolderPanel.swift', product / 'desktop/macos/NativeFolderSelection.swift']
    if not execute(['xcrun', 'swiftc', '-parse-as-library', str(source), *map(str, owners), '-o', str(binary)],
                   diagnostic, 120, private / 'fixture-build.log'):
        return None
    if not execute(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], diagnostic, 30, private / 'fixture-sign.log'):
        return None
    return app


def checkpoint(project_path, app, private, name):
    result = private / (name + '.xcresult')
    derived = private / 'derived'
    runners = list((derived / 'Build/Products').glob('*.xctestrun'))
    if len(runners) != 1:
        return ('unknown', 'runner_unavailable')
    method = 'testPositiveControl' if name == 'positive' else 'testFolderControl' if name == 'panel' else 'testSnapshot'
    test_url = TEST_URL.replace('testSnapshot', method)
    argv = ['xcodebuild', 'test-without-building', '-xctestrun', str(runners[0]),
            '-destination', 'platform=macOS,arch=arm64', '-parallel-testing-enabled', 'NO',
            '-maximum-concurrent-test-device-destinations', '1', '-resultBundlePath', str(result),
            '-only-testing:' + TARGET + '/CheckpointJourneys/' + method]
    if not execute(argv, project_path.parent, 180, private / (name + '.log')):
        return ('unknown', 'test_failed')
    export = private / (name + '-export')
    if not execute(['xcrun', 'xcresulttool', 'export', 'attachments', '--path', str(result),
                    '--test-id', test_url, '--output-path', str(export)], project_path.parent, 60,
                   private / (name + '-export.log')):
        return ('unknown', 'export_failed')
    return parse_export(export, positive=name == 'positive', folder=name == 'panel')


def compare(cell, snapshot, provider_factory, request, engine_operation=None):
    result = {'diagnostic_only': True, 'cell': cell, 'positive_image': 'unknown', 'positive_coverage': 'not_started',
              'before_image': 'unknown', 'before_coverage': 'not_started', 'after_image': 'unknown',
              'after_coverage': 'not_started', 'operation': 'not_started',
              'owned_provider_settlement': 'not_applicable', 'fixture_process_settlement': 'unknown',
              'modal': 'unknown', 'scope': 'diagnostic_fixture_window', 'build_coverage': 'complete'}
    def sample(name):
        try:
            return snapshot(name)
        except Exception:
            return ('unknown', 'test_unavailable')
    result['positive_image'], result['positive_coverage'] = sample('positive')
    if result['positive_image'] != 'ocr_title_match' or result['positive_coverage'] != 'ocr_complete':
        return result
    result['before_image'], result['before_coverage'] = sample('before')
    if cell == 'idle':
        result['operation'] = 'completed'
        result['after_image'], result['after_coverage'] = sample('after')
        return result
    if cell == 'panel':
        result['after_image'], result['after_coverage'] = sample('panel')
        result['operation'] = 'panel_sheet_observed' if result['after_coverage'] == 'ocr_complete' else 'unavailable'
        return result
    if cell not in ('provider', 'loopback', 'engine'):
        return result
    provider = provider_factory()
    try:
        base = provider.start()
        if cell == 'loopback':
            try:
                request(base, '/')
            except HTTPError:
                pass
        if cell == 'engine':
            if engine_operation is None:
                raise ValueError('engine operation unavailable')
            with engine_operation(base):
                result['operation'] = 'completed'
                result['after_image'], result['after_coverage'] = sample('after')
        else:
            result['operation'] = 'completed'
            result['after_image'], result['after_coverage'] = sample('after')
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
    cell, harness, controller, product, tests, temp = sys.argv[1:]
    h, diagnostic, product, tests, temp = (Path(p).resolve(strict=True) for p in (harness, controller, product, tests, temp))
    result = {'diagnostic_only': True, 'cell': cell, 'positive_image': 'unknown', 'positive_coverage': 'not_started',
              'before_image': 'unknown', 'before_coverage': 'not_started', 'after_image': 'unknown',
              'after_coverage': 'not_started', 'build_coverage': 'project_unavailable', 'operation': 'unavailable',
              'owned_provider_settlement': 'unknown', 'fixture_process_settlement': 'unknown',
              'modal': 'unknown', 'scope': 'diagnostic_fixture_window'}
    try:
        # This host is disposable. Keep the private tree until host teardown:
        # test-runner failure cannot positively establish app settlement.
        private = Path(tempfile.mkdtemp(prefix='nac-diagnostic-qprime-', dir=temp))
        selected = project(h, diagnostic, private / 'project')
        result['build_coverage'] = 'fixture_unavailable'
        sys.path.insert(0, str(h / 'desktop/macos'))
        from ci_qualifications import require_checkout
        require_checkout(product, H)
        require_checkout(tests, '5306800fd6ea70471ecd372a4f495621e0f74695')
        app = make_fixture(diagnostic, product, private)
        if app is None:
            raise ValueError('fixture unavailable')
        result['build_coverage'] = 'build_failed'
        derived = private / 'derived'
        build = ['xcodebuild', 'build-for-testing', '-project', str(selected), '-scheme', TARGET,
                 '-destination', 'platform=macOS,arch=arm64', '-derivedDataPath', str(derived),
                 '-parallel-testing-enabled', 'NO', 'NAC_UI_FIXTURE=' + str(app)]
        if not execute(build, diagnostic, 180, private / 'build.log'):
            raise ValueError('test build unavailable')
        from ci_startup_api import Provider, request
        operation = None
        if cell == 'engine':
            from checkpoint_engine import prepare_engine_operation
            result['build_coverage'] = 'engine_package_unavailable'
            operation = prepare_engine_operation(h, product, tests, private)
        result['build_coverage'] = 'complete'
        result = compare(cell, lambda name: checkpoint(selected, app, private, name), Provider, request, operation)
    except Exception:
        pass
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
