#!/usr/bin/env python3
"""Build and qualify the actual development app on a dedicated hosted Mac."""
import argparse
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import tempfile
import threading
import time

from ci_support import export_evidence, qualify_toolchain, redact_values, require_console
from smoke import cleanup_failed_case

ROOT = Path(__file__).resolve().parents[2]


def command(args):
    return subprocess.check_output(args, cwd=ROOT, text=True, stderr=subprocess.STDOUT).strip()


def run(args, log, timeout):
    """Drain output continuously, retaining at most 256 KiB, including failure."""
    chunks = deque(maxlen=64)
    process = subprocess.Popen(args, cwd=ROOT, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, start_new_session=True)
    def drain():
        while chunk := process.stdout.read(4096):
            chunks.append(chunk)
    thread = threading.Thread(target=drain, daemon=True)
    thread.start()
    try:
        code = process.wait(timeout=timeout)
        if code:
            raise RuntimeError(f'{args[0]} failed ({code}); see {log.name}')
    finally:
        # This group contains our build/driver helpers, never an unrelated app.
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        thread.join(timeout=5)
        log.write_bytes(b''.join(chunks))


def settle_apps(raw):
    """Recover only bundles named in this invocation's app ownership records."""
    results = []
    for record in sorted((raw / 'evidence').glob('*.json')):
        data = json.loads(record.read_text())
        pid = data.get('app_pid')
        if not pid:
            continue
        engine_pid = data.get('engine_pid', 0)
        target = pid if alive(pid) else engine_pid
        args = command(['/bin/ps', '-p', str(target), '-o', 'command=']) if target and alive(target) else ''
        if args:
            member = 'MacOS/NACPreview' if target == pid else 'Resources/nac-web'
            suffix = '/NAC Development Preview Smoke.app/Contents/' + member
            path, found, _ = args.partition(suffix)
            prefix = Path(tempfile.gettempdir()).resolve()
            executable = Path(path + found)
            if (not found or not executable.is_absolute()
                    or not executable.resolve().is_relative_to(prefix)
                    or not any(p.startswith('nac-mac-relocation-') for p in executable.parts)):
                raise RuntimeError('Owned app executable binding cannot be verified; refusing signal')
            bundle = Path(path + '/NAC Development Preview Smoke.app')
            cleanup_failed_case(record, bundle)
            results.append({'scenario': data.get('scenario'), 'fallback_cleanup': True})
        root = data.get('profile')
        if root and Path(root).exists():
            raise RuntimeError('Fixture profile survived cleanup')
        if data.get('engine_pid') and alive(data['engine_pid']):
            raise RuntimeError('Recorded fixture engine survived cleanup')
        if alive(pid):
            raise RuntimeError('Recorded fixture app survived cleanup')
    return results


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--preflight-only', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        parser.error('--output must not exist')
    output.mkdir(parents=True)
    raw = output.parent / (output.name + '-private')
    raw.mkdir(mode=0o700)
    report = {'result': 'failed', 'acceptance': 'ALL-354 baseline only; full journeys incomplete',
              'source_sha': command(['git', 'rev-parse', 'HEAD']),
              'source_dirty': bool(command(['git', 'status', '--porcelain'])),
              'pr_head': os.environ.get('PR_HEAD_SHA'), 'pr_base': os.environ.get('PR_BASE_SHA'),
              'workflow_sha': os.environ.get('GITHUB_SHA'), 'event': os.environ.get('GITHUB_EVENT_NAME'),
              'run_id': os.environ.get('GITHUB_RUN_ID'), 'run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT')}
    started = time.time()
    def interrupt(signum, _frame):
        raise RuntimeError(f'CI interrupted by signal {signum}')
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, interrupt)
    try:
        if report['source_sha'] != args.expected_sha or report['source_dirty']:
            raise RuntimeError('Expected clean exact candidate checkout')
        if platform.system() != 'Darwin' or platform.machine() != 'arm64':
            raise RuntimeError('Native prerequisite unavailable: Darwin ARM64 required')
        expected = json.loads((ROOT / 'desktop/macos/ci-toolchain.json').read_text())
        actual = {'developer_directory': os.environ.get('DEVELOPER_DIR'),
                  'xcode': command(['xcodebuild', '-version']),
                  'sdk': command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
                  'swift': command(['xcrun', 'swiftc', '--version']),
                  'image': os.environ.get('ImageVersion'),
                  'os_version': command(['sw_vers', '-productVersion']),
                  'os_build': command(['sw_vers', '-buildVersion'])}
        report['toolchain'] = actual
        compiler_pinned = qualify_toolchain(actual, expected)
        console = subprocess.check_output(['/usr/sbin/ioreg', '-a', '-n', 'Root', '-d', '1'])
        report['console'] = require_console(console, os.getuid())
        report['rustc'] = command(['rustc', '-Vv'])
        report['node'] = command(['node', '--version'])
        if args.preflight_only:
            report['result'] = 'preflight-only'
            return
        os.environ['NAC_MAC_OUTPUT'] = str(raw)
        run(['bash', 'desktop/macos/preview.sh', 'build'], raw / 'ordinary-build.log', 900)
        ordinary = raw / 'NAC Development Preview.app/Contents/MacOS/NACPreview'
        report['ordinary_build'] = {}
        for name, binary in [('native_sha256', ordinary), ('engine_sha256', ordinary.parent.parent / 'Resources/nac-web')]:
            with binary.open('rb') as stream:
                report['ordinary_build'][name] = hashlib.file_digest(stream, 'sha256').hexdigest()
        symbols = command(['/usr/bin/nm', str(ordinary)])
        if 'PreviewSmoke' in symbols or '--smoke-output' in command(['/usr/bin/strings', str(ordinary)]):
            raise RuntimeError('Ordinary app contains test instrumentation')
        os.environ['NAC_MAC_SKIP_ENGINE_BUILD'] = '1'
        run(['bash', 'desktop/macos/preview.sh', 'smoke'], raw / 'app-journeys.log', 800)
        helper = raw / 'native-image-reader'
        run(['xcrun', 'swiftc', '-swift-version', '5', 'desktop/macos/CIEvidence.swift',
             '-o', str(helper)], raw / 'image-reader-build.log', 90)
        images = [raw / 'evidence' / name for name in ('streamed-chat.png', 'persisted-chat.png')]
        report['images'] = json.loads(command([str(helper), *map(str, images)]))
        report['result'] = 'passed' if compiler_pinned else 'unqualified-swift'
        if not compiler_pinned:
            raise RuntimeError('Smoke completed; pin observed Swift compiler identity before acceptance')
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        try:
            report['cleanup'] = settle_apps(raw)
        except Exception as error:
            report['cleanup_error'] = str(error)
            report['result'] = 'failed'
            raise
        finally:
            crashes = Path.home() / 'Library/Logs/DiagnosticReports'
            count = 0
            for crash in sorted(crashes.glob('NACPreview*')):
                if crash.is_file() and not crash.is_symlink() and crash.stat().st_mtime >= started and count < 3:
                    with crash.open('rb') as stream:
                        (raw / f'crash-{count}{crash.suffix}').write_bytes(stream.read(65536))
                    count += 1
            report['crash_reports'] = count
            report['elapsed_seconds'] = round(time.time() - started, 3)
            (raw / 'ci-report.json').write_text(json.dumps(report, indent=2) + '\n')
            # Bundle resources and binaries are not uploaded. Export only bounded
            # evidence, logs and our report, with exact-value redaction.
            export_evidence(raw, output, redact_values())


if __name__ == '__main__':
    main()
