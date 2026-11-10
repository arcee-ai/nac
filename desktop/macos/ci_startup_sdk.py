"""Compile the canonical startup XCTest target; never launch tests or the app."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import struct
import sys

from ci_qualifications import require_checkout
import ci_startup_fixture as fixture
from ci_startup import generated_runner
from ci_support import qualify_toolchain
from ci_xctest_project import materialize_project

ROOT = Path(__file__).resolve().parents[2]
SIGNING_OVERRIDES = ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO']


def digest(path, limit=32 * 1024 * 1024):
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError('SDK evidence file exceeds bound')
    return hashlib.sha256(data).hexdigest()


def canonical_root(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve(strict=True) != path or not path.is_dir():
        raise RuntimeError('SDK sources require canonical absolute directories')
    return path


def test_binary(target, runner):
    products = runner.parent.resolve(strict=True)

    def resolve(value, host=None):
        if value.startswith('__TESTROOT__/'):
            path = products / value[len('__TESTROOT__/'):]
        elif host is not None and value.startswith('__TESTHOST__/'):
            path = host / value[len('__TESTHOST__/'):]
        else:
            raise RuntimeError('Unexpected generated SDK product path')
        result = path.resolve(strict=True)
        if not result.is_relative_to(products):
            raise RuntimeError('Generated SDK product escapes derived products')
        return result

    host = resolve(target['TestHostPath']) if '__TESTHOST__/' in target['TestBundlePath'] else None
    bundle = resolve(target['TestBundlePath'], host)
    if bundle.name != 'NACStartupUITests.xctest' or not bundle.is_dir():
        raise RuntimeError('Canonical startup test bundle missing')
    info = plistlib.loads((bundle / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleExecutable') != 'NACStartupUITests':
        raise RuntimeError('Unexpected startup test executable')
    executable = bundle / 'Contents/MacOS/NACStartupUITests'
    if executable.is_symlink() or not executable.is_file():
        raise RuntimeError('Startup test executable missing or symlinked')
    with executable.open('rb') as stream:
        header = stream.read(8)
    if len(header) != 8 or struct.unpack('<II', header) != (0xFEEDFACF, 0x0100000C):
        raise RuntimeError('Startup test executable is not ARM64 Mach-O')
    return {'test_bundle': bundle.name, 'test_bundle_executable_sha256': digest(executable),
            'test_bundle_info_sha256': digest(bundle / 'Contents/Info.plist'), 'architecture': 'arm64'}


def check(harness, expected_sha, tests, output, *, run, command):
    harness, tests = canonical_root(harness), canonical_root(tests)
    output = Path(output)
    if (harness == tests or harness.is_relative_to(tests) or tests.is_relative_to(harness)
            or not output.is_absolute() or output.resolve() != output or output.exists()
            or not output.parent.is_dir() or output.is_relative_to(harness) or output.is_relative_to(tests)):
        raise RuntimeError('SDK check requires separate clean source roots and new external output')
    output.mkdir(mode=0o700)
    report = {'schema': 'nac-startup-sdk-v1', 'acceptance': False, 'test_executions': 0,
              'scope': 'Full canonical XCTest SDK compilation only; no Native acceptance',
              'result': 'failed', 'stage': 'source_admission', 'harness_sha': expected_sha}
    try:
        require_checkout(harness, expected_sha)
        fixture.test_contract(tests)  # Exact immutable Q and all ten canonical files.
        report.update(harness_tree=command(['git', '-C', str(harness), 'rev-parse', 'HEAD^{tree}']),
                      test_source_sha=fixture.TEST_SOURCE, test_files=dict(fixture.TEST_FILES))
        report['stage'] = 'toolchain'
        if platform.system() != 'Darwin' or platform.machine() != 'arm64':
            raise RuntimeError('Full startup SDK gate requires Darwin ARM64')
        actual = {'developer_directory': os.environ.get('DEVELOPER_DIR'),
                  'xcode': command(['xcodebuild', '-version']),
                  'sdk': command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
                  'swift': command(['xcrun', 'swiftc', '--version']),
                  'image': os.environ.get('ImageVersion'),
                  'os_version': command(['sw_vers', '-productVersion']),
                  'os_build': command(['sw_vers', '-buildVersion'])}
        expected = json.loads((harness / 'desktop/macos/ci-toolchain.json').read_text())
        report['toolchain'] = actual
        qualify_toolchain(actual, expected)
        if actual['os_version'] != '26.7.2':
            raise RuntimeError('Required ReceiptControls matrix is macOS 26.7.2')
        report['stage'] = 'project'
        selection = materialize_project(harness, expected_sha, startup_root=tests,
            startup_sha=fixture.TEST_SOURCE, startup_source_sha256=fixture.TEST_FILES['StartupJourneys.swift'],
            output=output / 'project')
        report['selection'] = selection['receipt']
        marker = output / 'compile-only.json'
        marker.write_text(json.dumps({'mode': 'compile-only', 'acceptance': False,
            'harness_sha': expected_sha, 'test_source_sha': fixture.TEST_SOURCE}) + '\n')
        calls = []

        def compile_only(args, log, cap, *, env):
            if args[:2] != ['xcodebuild', 'build-for-testing'] or calls or cap != 240:
                raise RuntimeError('Only one canonical build-for-testing command is admitted')
            argv = [*args, *SIGNING_OVERRIDES]
            calls.append(argv)
            report['command'] = argv
            run(argv, log, cap, env=env, retain_ownership=True)

        report['stage'] = 'build_for_testing'
        runner, receipt = generated_runner(output, marker, digest(marker),
            {'harness_sha': expected_sha}, selection, compile_only)
        if len(calls) != 1:
            raise RuntimeError('Canonical SDK compiler was not invoked')
        report['stage'] = 'generated_artifacts'
        report.update(test_binary(receipt['generated_target'], runner))
        report.update(xctestrun_sha256=digest(runner), runner=receipt,
                      signing_overrides=list(SIGNING_OVERRIDES))
        require_checkout(harness, expected_sha)
        fixture.test_contract(tests)
        report.update(result='passed', stage='complete')
        return report
    except BaseException as error:
        report['failure_kind'] = type(error).__name__
        raise
    finally:
        (output / 'sdk-check.json').write_text(json.dumps(report, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # Reuse the existing bounded process-group/log owner; no alternate supervisor.
    from ci import run, command
    try:
        check(ROOT, args.expected_sha, args.source_root, args.output, run=run, command=command)
    except BaseException as error:
        print('Startup SDK check failed: ' + type(error).__name__ + '; see sdk-check.json', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
