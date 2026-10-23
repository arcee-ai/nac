#!/usr/bin/env python3
"""One production-embedded native terminal journey and a failing byte control."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import time
import uuid

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('portability', Path(__file__).with_name('nightly-portability.py'))
portability = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portability)
ROOT = portability.ROOT
WEB = ROOT / 'crates/nac-server/web'
SOURCE = WEB / 'e2e/terminal-local-acceptance.e2e.ts'
TITLE = 'connected native shell, less resize, and trusted browser bracketed UTF-8 paste return to the same shell'


def verify_result(path, negative=False):
    report = json.loads(path.read_text())
    tests = [test for suite in report['suites'] for spec in suite.get('specs', [])
             if spec['title'] == TITLE for test in spec['tests']]
    if len(tests) != 1 or len(tests[0]['results']) != 1:
        raise RuntimeError('exactly one selected test and one attempt required')
    result = tests[0]['results'][0]
    if negative:
        if result['status'] != 'failed' or len(result.get('errors', [])) != 1 or not result['errors'][0].get('message', '').startswith('Error: native paste byte negative control\n\n'):
            raise RuntimeError('negative control did not fail at the selected paste-byte assertion')
    elif result['status'] != 'passed' or tests[0]['status'] != 'expected':
        raise RuntimeError('native journey did not pass; skipped/retried cases are not acceptance')
    if report.get('errors'):
        raise RuntimeError('Playwright infrastructure or cleanup errors')
    stats = report['stats']
    if stats['expected'] != (0 if negative else 1) or stats['unexpected'] != (1 if negative else 0) or stats['skipped'] or stats['flaky']:
        raise RuntimeError('unexpected test selection or result')


def owned_processes(marker):
    args = ['ps', 'eww', '-axo', 'pid=,stat=,command='] if platform.system() == 'Darwin' else ['ps', 'eww', '-e', '-o', 'pid=,stat=,command=']
    listing = subprocess.check_output(args, text=True)
    token = re.compile(r'(?:^|\s)NAC_E2E_CLEANUP_ID=' + re.escape(marker) + r'(?:-|\s|$)')
    return [int(fields[0]) for line in listing.splitlines()
            if len(fields := line.split(None, 2)) == 3 and not fields[1].startswith('Z') and token.search(fields[2])]


def settle_owned(marker):
    before = owned_processes(marker)
    for signum in (signal.SIGTERM, signal.SIGKILL):
        deadline = time.monotonic() + 3
        while pids := owned_processes(marker):
            for pid in pids:
                try:
                    os.kill(pid, signum)
                except ProcessLookupError:
                    pass
            if time.monotonic() >= deadline:
                break
            time.sleep(.025)
        if not pids:
            break
    remaining = owned_processes(marker)
    if remaining:
        raise RuntimeError(f'owned detached processes survived cleanup: {remaining}')
    return before


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error('--output must be a new or empty evidence directory')
    output.mkdir(parents=True, exist_ok=True)
    report = {'result': 'failed', 'platform': platform.platform(), 'architecture': platform.machine(),
              'phases': [], 'run_id': os.environ.get('GITHUB_RUN_ID'), 'event': os.environ.get('GITHUB_EVENT_NAME', 'local')}
    started = time.monotonic()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, portability.interrupt)
    mutant = None
    marker = uuid.uuid4().hex
    report['cleanup_marker'] = marker
    try:
        report['candidate'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        if not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha) or args.expected_sha != report['candidate']:
            raise RuntimeError('immutable candidate mismatch')
        if platform.system() not in ('Darwin', 'Linux'):
            raise RuntimeError('requires native ARM macOS or Linux')
        if platform.system() == 'Darwin' and platform.machine() != 'arm64':
            raise RuntimeError('macOS coverage requires actual ARM64')
        shell = '/bin/zsh' if platform.system() == 'Darwin' else '/bin/bash'
        for executable in (shell, '/usr/bin/less'):
            if not os.access(executable, os.X_OK):
                raise RuntimeError(f'required executable unavailable: {executable}')
        if any(key.startswith('NAC_E2E_REMOTE') and value for key, value in os.environ.items()):
            raise RuntimeError('focused native journey requires local isolated harness, not remote settings')
        env = dict(os.environ, CARGO_PROFILE_TEST_DEBUG='0', NAC_E2E_CLEANUP_ID=marker)
        run = lambda command, label, environment=env: portability.run(command, output / f'{label}.log', environment, report['phases'], label)
        report['python'] = run(['python3', '--version'], 'python')
        report['node'] = run(['node', '--version'], 'node')
        report['rustc'] = run(['rustc', '-Vv'], 'rustc')
        run([os.environ.get('CARGO', 'cargo'), 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'], 'build')
        binary = (ROOT / os.environ.get('CARGO_TARGET_DIR', 'target') / 'debug/nac-web').resolve()
        if not os.access(binary, os.X_OK):
            raise RuntimeError(f'built nac-web unavailable: {binary}')
        command = ['npm', '--prefix', str(WEB), 'run', 'test:e2e', '--']
        def episode(file, label):
            episode_env = dict(env, NAC_E2E_BINARY=str(binary), NAC_E2E_ARTIFACTS=str(output / label),
                               PLAYWRIGHT_JSON_OUTPUT_FILE=str(output / f'{label}.json'))
            return run(command + [file, '--grep', TITLE, '--reporter=json'], label, episode_env)
        episode(SOURCE.name, 'journey')
        verify_result(output / 'journey.json')
        # A disposable sibling keeps identical imports/fixtures and leaves candidate source untouched.
        # The sole deliberate fault is an incorrect expected bracket prefix, after real trusted paste.
        original = SOURCE.read_text()
        needle = 'expect(pasteInputs.flat(), "trusted paste product input bytes").toEqual(\n      Array.from(new TextEncoder().encode("\\x1b[200~Ω中\\rliteral paste\\x1b[201~")),\n    );'
        if original.count(needle) != 1:
            raise RuntimeError('negative-control assertion anchor drift')
        # The preceding real PTY assertion must pass before the deliberately wrong HTTP expectation.
        replacement = needle.replace('trusted paste product input bytes', 'native paste byte negative control').replace('200~', '200X')
        changed = original.replace(needle, replacement)
        mutant = SOURCE.with_name(f'terminal-byte-negative-{uuid.uuid4().hex}.e2e.ts')
        mutant.write_text(changed)
        try:
            episode(mutant.name, 'negative-control')
        except RuntimeError:
            if report['phases'][-1].get('returncode') != 1:
                raise
        else:
            raise RuntimeError('negative control unexpectedly passed')
        verify_result(output / 'negative-control.json', negative=True)
        report['result'] = 'passed (native journey; byte negative control failed as required)'
    except Exception as error:
        report['error'] = str(error)
    finally:
        if mutant is not None:
            mutant.unlink(missing_ok=True)
        try:
            report['owned_pids_before_cleanup'] = settle_owned(marker)
            report['owned_pids_remaining'] = owned_processes(marker)
            if report['owned_pids_before_cleanup'] and report['result'].startswith('passed'):
                report['result'] = 'failed'
                report['error'] = 'fixture teardown leaked owned processes; runner settled them'
        except Exception as cleanup_error:
            report['result'] = 'failed'
            report['cleanup_error'] = str(cleanup_error)
        report['seconds'] = round(time.monotonic() - started, 3)
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        lines = ['# Focused native terminal browser', '',
                 f'Candidate: `{report.get("candidate", "unavailable")}`',
                 f'Platform: {report["platform"]} / {report["architecture"]}',
                 f'Result: **{report["result"]}**',
                 f'Total runner seconds: {report["seconds"]}', '',
                 report.get('error', ''), '',
                 '| Phase | Seconds | Exit | Log |', '|---|---:|---:|---|']
        for phase in report['phases']:
            lines.append(f'| {phase["label"]} | {phase["seconds"]} | '
                         f'{phase.get("returncode", "interrupted")} | {phase["log"]} |')
        lines += ['', 'Positive acceptance requires exit 0; the separate negative control requires exit 1 at the byte assertion. No retries.']
        (output / 'summary.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if report['result'].startswith('passed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
