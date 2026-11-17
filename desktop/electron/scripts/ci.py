#!/usr/bin/env python3
"""Normal optimized, exact-source actual-Electron Mac CI; no release claims."""
import argparse
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'desktop/macos'))
from ci_support import require_console  # Same read-only hosted Aqua admission.

LIMIT = 256 * 1024


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def sanitized(text, replacements):
    for original, replacement in sorted(replacements, key=lambda pair: -len(pair[0])):
        if original:
            text = text.replace(original, replacement)
    # Fixture tokens/paths may also be embedded in error messages. Never export
    # raw attachments, profiles, screenshots, stores, headers or process lists.
    text = re.sub(r'/Users/[^/\s"\\]+', '<home>', text)
    text = re.sub(r'(?i)(authorization[=: ]+)([^\s,"}]+)', r'\1<redacted>', text)
    return text


def source_identity(expected):
    if not re.fullmatch('[a-f0-9]{40}', expected):
        raise RuntimeError('Expected source must be one immutable SHA')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'],
                                    cwd=ROOT, text=True).strip()
    if actual != expected or dirty:
        raise RuntimeError('CI requires the exact clean source checkout')
    return actual


def summary(document):
    """Select bounded test verdicts; base64 attachments are deliberately absent."""
    rows = []
    def visit(suite, parents):
        titles = [*parents, suite.get('title', '')]
        for spec in suite.get('specs', []):
            for test in spec.get('tests', []):
                rows.append(dict(file=spec['file'], line=spec['line'],
                                 title=' / '.join([*titles, spec['title']]),
                                 expected=test['expectedStatus'], status=test['status'],
                                 results=[dict(status=r['status'], duration=r['duration'],
                                               errors=[e.get('message', '')[:4000]
                                                       for e in r.get('errors', [])[:3]])
                                          for r in test.get('results', [])],
                                 annotations=test.get('annotations', [])))
        for child in suite.get('suites', []):
            visit(child, titles)
    for suite in document.get('suites', []):
        visit(suite, [])
    if not rows or len(rows) > 200:
        raise RuntimeError('Actual-app scenario report missing or exceeds bound')
    return rows


def require_verdict(scenarios, records, remaining):
    if not scenarios:
        raise RuntimeError('Actual-app scenario report missing')
    if any(row['status'] != 'expected' or not row['results']
           or any(result['status'] != 'passed' for result in row['results']) for row in scenarios):
        raise RuntimeError('Actual-app report contains failed/skipped/unsupported scenarios')
    if not records or any(record['settled'] is not True for record in records) or remaining:
        raise RuntimeError('Positive fixture/owned-child cleanup proof missing')


class Lane:
    def __init__(self, output, expected):
        self.output = output
        output.mkdir(parents=True, exist_ok=False)
        self.raw = Path(tempfile.mkdtemp(prefix='nac-electron-ci-')).resolve()
        self.replacements = [(str(ROOT), '<checkout>'), (str(self.raw), '<private-fixture>'),
                             (str(Path.home()), '<home>'), ('nac-e2e-dummy-only', '<fixture-key>')]
        for key, value in os.environ.items():
            if re.search(r'(?i)(token|secret|password|api_key|credential)', key) and len(value) >= 4:
                self.replacements.append((value, '<redacted>'))
        # Build tooling may use its normal caches; the app receives ONLY its
        # fixture's explicit environment in fixture.ts, never this build env.
        self.env = {key: value for key, value in os.environ.items() if key in (
            'PATH', 'HOME', 'USER', 'LOGNAME', 'DEVELOPER_DIR', 'SDKROOT',
            'CARGO_HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN', 'CARGO_BUILD_JOBS', 'CI')}
        self.env.update(NAC_SOURCE_REVISION=expected, NAC_BUILD_TRACK='dev',
                        NAC_BUILD_ID='dev-' + expected, CARGO_INCREMENTAL='0',
                        TMPDIR=str(self.raw), PYTHONDONTWRITEBYTECODE='1')
        self.report = dict(version=1, result='failed', source_sha=expected,
                           admission_sha=os.environ.get('ADMISSION_SHA'), phases=[],
                           hosted_gui_executed=False, cleanup='not-observed')
        self.deadline = time.monotonic() + 45 * 60  # Leave job time for cleanup/upload.

    def write(self, name, value):
        encoded = sanitized(json.dumps(value, indent=2), self.replacements).encode()
        if len(encoded) > LIMIT:
            raise RuntimeError('Structured evidence exceeds bound: ' + name)
        (self.output / name).write_bytes(encoded + b'\n')

    def run(self, name, args, seconds, env=None):
        seconds = min(seconds, self.deadline - time.monotonic())
        if seconds <= 0:
            raise RuntimeError('Electron CI run deadline exhausted')
        print('Electron CI phase: ' + name, flush=True)
        start = time.monotonic()
        process = subprocess.Popen(args, cwd=ROOT, env=env or self.env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        chunks = deque(maxlen=64)
        def drain():
            while chunk := process.stdout.read(4096):
                chunks.append(chunk)
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        try:
            code = process.wait(timeout=seconds)
        finally:
            if process.poll() is None:
                # Signal only the exact retained tool/controller child. Engine
                # custody remains its own protocol; no PID/group adoption.
                process.terminate()
                try:
                    process.wait(timeout=35)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            reader.join(timeout=5)
            if not reader.is_alive():
                process.stdout.close()
            text = sanitized(b''.join(chunks).decode('utf8', errors='replace'), self.replacements)
            (self.output / (name + '.log')).write_bytes(text.encode()[-LIMIT:])
            self.report['phases'].append(dict(name=name, code=process.returncode,
                                              seconds=round(time.monotonic() - start, 2)))
        if reader.is_alive() or code:
            raise RuntimeError(name + ' failed; see bounded phase log')

    def gui(self, suffix):
        helper = self.raw / 'gui'
        if not helper.exists():
            self.run('gui-build', ['xcrun', 'swiftc', '-swift-version', '5',
                                  'desktop/macos/CIGUI.swift', '-o', str(helper)], 90)
        console = subprocess.check_output(['/usr/sbin/ioreg', '-a', '-n', 'Root', '-d', '1'], timeout=15)
        quartz = json.loads(subprocess.check_output([str(helper)], timeout=15))
        facts = require_console(console, os.getuid(), quartz)
        self.report['console_' + suffix] = facts

    def toolchain(self):
        def observe(args):
            try:
                result = subprocess.run(args, cwd=ROOT, env=self.env, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, text=True, timeout=30)
                return dict(code=result.returncode, output=result.stdout.strip()[:8192])
            except (OSError, subprocess.TimeoutExpired) as error:
                return dict(code=None, failure=type(error).__name__)
        # The workflow pins Mac/Xcode/Rust/Node. Record their actual values;
        # Electron's bundled Chromium is not the Swift WK supplier envelope.
        self.report['toolchain'] = dict(
            developer_directory_configured=self.env.get('DEVELOPER_DIR'),
            developer_directory_selected=observe(['xcode-select', '-p']),
            xcode=observe(['xcodebuild', '-version']),
            sdk=observe(['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
            swift=observe(['xcrun', 'swiftc', '--version']),
            clang=observe(['xcrun', 'clang', '--version']),
            rustc=observe(['rustc', '-Vv']), node=observe(['node', '--version']),
            os_build=observe(['sw_vers', '-buildVersion']))

    def audit(self, app):
        # Select only exact private candidate command paths and fixture root.
        # Retain PID numbers, never the all-process listing or other owners.
        prefixes = [str(app) + '/', str(self.raw) + '/', str(ROOT / 'desktop/electron') + ' ']
        rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,command='], text=True, timeout=15)
        return [int(match[1]) for row in rows.splitlines()
                if (match := re.match(r'\s*(\d+)\s+(.*)', row))
                and int(match[1]) != os.getpid() and any(prefix in match[2] for prefix in prefixes)]

    def execute(self, expected):
        source_identity(expected)
        if platform.system() != 'Darwin' or platform.machine() != 'arm64':
            raise RuntimeError('Actual-app CI requires Apple Silicon macOS; unsupported is failure')
        self.report.update(os_version=platform.mac_ver()[0], architecture=platform.machine(),
                           runner_image=os.environ.get('ImageVersion'), engine_mode='normal-release')
        self.toolchain()
        self.gui('before')
        self.run('setup', ['make', 'setup'], 300)
        self.run('electron-install', ['npm', '--prefix', 'desktop/electron', 'ci'], 180)
        self.run('engine-build', ['cargo', 'build', '--locked', '--release', '-p', 'nac-server', '--bin', 'nac-web'], 1800)
        engine = ROOT / 'target/release/nac-web'
        identity = json.loads(subprocess.check_output([str(engine), '__desktop-identity'], env=self.env, timeout=15))
        if identity != dict(product_version=(ROOT / 'version.txt').read_text().strip(),
                            source_revision=expected, build_id='dev-' + expected, track='dev'):
            raise RuntimeError('Normal optimized engine identity differs from exact source')
        self.report['engine_identity'] = identity
        self.run('prepare', ['node', 'desktop/electron/scripts/prepare.cjs'], 120)
        self.run('owner-tests', ['npm', '--prefix', 'desktop/electron', 'test'], 240)
        package_env = dict(self.env, NAC_ELECTRON_OUTPUT=str(self.raw / 'package'))
        self.run('package', ['node', 'desktop/electron/scripts/package.cjs'], 180, package_env)
        app = self.raw / 'package/NAC Electron.app'
        manifest_file = app / 'Contents/Resources/manifest.json'
        manifest = json.loads(manifest_file.read_text())
        if manifest['sourceRevision'] != expected or manifest['engine_identity'] != identity:
            raise RuntimeError('Package source identity mismatch')
        self.report.update(manifest_sha256=digest(manifest_file), package=manifest,
                           engine_input_sha256=digest(engine))
        test_env = dict(self.env, NAC_ELECTRON_APP=str(app), NAC_ELECTRON_CI='1',
                        NAC_ELECTRON_CI_SHA=expected, NAC_ELECTRON_CI_REPORT=str(self.raw / 'tests.json'),
                        NAC_ELECTRON_CI_RESULTS=str(self.raw / 'results'),
                        NAC_ELECTRON_CI_RECORDS=str(self.raw / 'cleanup.jsonl'))
        scenarios = None
        try:
            self.report['hosted_gui_attempted'] = os.environ.get('GITHUB_ACTIONS') == 'true'
            self.run('actual-app', ['npm', '--prefix', 'desktop/electron', 'run', 'test:e2e'], 600, test_env)
        finally:
            self.report['remaining_candidate_pids'] = self.audit(app)
            records_file = self.raw / 'cleanup.jsonl'
            records = [json.loads(row) for row in records_file.read_text().splitlines()] if records_file.exists() else []
            self.write('cleanup.json', records)
            self.report['hosted_gui_executed'] = any(record['enginePid'] > 0 for record in records) and os.environ.get('GITHUB_ACTIONS') == 'true'
            self.report['cleanup'] = 'proven' if (records and all(r['settled'] for r in records)
                                                  and not self.report['remaining_candidate_pids']) else 'unproven'
            tests_file = self.raw / 'tests.json'
            if tests_file.exists():
                scenarios = summary(json.loads(tests_file.read_text()))
                self.write('scenarios.json', scenarios)
        require_verdict(scenarios, records, self.report['remaining_candidate_pids'])
        self.gui('after')
        source_identity(expected)
        self.report['result'] = 'passed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    lane = Lane(args.output.absolute(), args.expected_sha)
    try:
        lane.execute(args.expected_sha)
    except Exception as error:
        lane.report['failure'] = str(error)
        print('Electron CI failed: ' + type(error).__name__, file=sys.stderr)
    finally:
        lane.write('identity.json', lane.report)
    return 0 if lane.report['result'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
