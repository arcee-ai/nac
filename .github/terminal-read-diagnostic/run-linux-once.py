"""One unchanged canonical pressure case; filtered protocol, no acceptance claim."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
import uuid

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ['NAC_DIAG_SUT_ROOT']).resolve()
WEB = ROOT / 'crates/nac-server/web'
TITLE = 'connected renderer keeps copy selection, input, resize and Ctrl-C responsive under finite noisy output'

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

protocol = load('protocol_metadata', HERE / 'protocol_metadata.py')
cleanup = load('terminal_browser', ROOT / '.github/scripts/terminal-browser.py')

class CleanupExpired(BaseException):
    pass

def expire_cleanup(*_):
    raise CleanupExpired()

def run():
    output = Path(os.environ['NAC_DIAG_EVIDENCE']) / 'linux-pressure-diagnostic-once'
    output.mkdir(mode=0o700)  # Refuse a second episode or overwritten evidence.
    identity = json.loads((Path(os.environ['NAC_DIAG_EVIDENCE']) / 'identity.json').read_text())
    binary = Path(identity['binary_path'])
    assert hashlib.file_digest(binary.open('rb'), 'sha256').hexdigest() == identity['binary_sha256']
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == identity['head']
    assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT)
    marker = uuid.uuid4().hex
    report = dict(identity=identity, cleanup_marker=marker, scope='Hosted Linux retained-producer diagnostic only; distinct dispatch, not normal same-run CI admission or latency acceptance',
                  case_deadline_seconds=85, cleanup_deadline_seconds=12,
                  raw_protocol_persisted=False, stdout_overflow=False,
                  oversized_protocol_lines=0, infrastructure_errors=0)
    env = dict(os.environ, DEBUG='pw:protocol', DEBUG_COLORS='0', FORCE_COLOR='0',
               PW_RUNNER_DEBUG='1',  # Keep raw worker stderr out of trace/reporter interception.
               NAC_E2E_BINARY=str(binary), NAC_E2E_CLEANUP_ID=marker,
               NAC_E2E_ARTIFACTS=str(output / 'artifacts'))
    for key in list(env):
        if key == 'DEBUG_FILE' or key.startswith('PLAYWRIGHT_JSON_'):
            del env[key]
        if key.startswith('NAC_E2E_REMOTE') and env[key]:
            raise RuntimeError('remote fixture configuration is not permitted')
    command = ['node', str(WEB / 'node_modules/@playwright/test/cli.js'), 'test',
               '--config', str(WEB / 'playwright.config.ts'),
               'terminal-local-acceptance.e2e.ts', '--grep', re.escape(TITLE),
               '--workers=1', '--retries=0', '--reporter=json']
    process = None
    started = time.monotonic()
    stdout = bytearray()
    partial = bytearray()
    dropping_line = False
    selector = selectors.DefaultSelector()
    filtered = None
    try:
        with (output / 'protocol-metadata.jsonl').open('x') as sink:
            filtered = protocol.MetadataFilter(sink)
            process = subprocess.Popen(command, cwd=WEB, env=env, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, start_new_session=True)
            selector.register(process.stdout, selectors.EVENT_READ, 'stdout')
            selector.register(process.stderr, selectors.EVENT_READ, 'stderr')
            while selector.get_map():
                if time.monotonic() - started > 85:
                    raise TimeoutError('single outer deadline exhausted')
                for key, _ in selector.select(.1):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    if key.data == 'stdout':
                        remaining = max(0, 4 * 1024 * 1024 - len(stdout))
                        stdout.extend(chunk[:remaining])
                        report['stdout_overflow'] |= len(chunk) > remaining
                        continue
                    # Drain continuously after caps; never write the raw stream.
                    for segment in chunk.splitlines(keepends=True):
                        complete = segment.endswith(b'\n')
                        if not dropping_line and len(partial) + len(segment) <= 1024 * 1024:
                            partial.extend(segment)
                        elif not dropping_line:
                            dropping_line = True
                            partial.clear()
                            report['oversized_protocol_lines'] += 1
                        if complete:
                            if not dropping_line:
                                filtered.line(partial.decode('utf-8', errors='replace').rstrip())
                            partial.clear()
                            dropping_line = False
            if partial and not dropping_line:
                filtered.line(partial.decode('utf-8', errors='replace').rstrip())
            report['protocol'] = filtered.counts
        report['returncode'] = process.wait(timeout=2)
        if report['stdout_overflow']:
            raise RuntimeError('JSON report exceeded memory cap')
        parsed = json.loads(stdout)
        def results(suite):
            for spec in suite.get('specs', []):
                for test in spec['tests']:
                    yield dict(title=spec['title'], status=test['status'],
                               attempts=[dict(status=r['status'], duration=r['duration'],
                                              errors=[e.get('message', '')[:4000] for e in r.get('errors', [])]) for r in test['results']])
            for child in suite.get('suites', []):
                yield from results(child)
        report['tests'] = [r for suite in parsed['suites'] for r in results(suite)]
        report['infrastructure_errors'] = len(parsed.get('errors', []))
        assert len(report['tests']) == 1 and report['tests'][0]['title'] == TITLE
        assert len(report['tests'][0]['attempts']) == 1
        report['stats'] = parsed['stats']
        report['canonical_case_passed'] = (report['tests'][0]['status'] == 'expected'
            and report['tests'][0]['attempts'][0]['status'] == 'passed'
            and parsed['stats']['expected'] == 1
            and not any(parsed['stats'][name] for name in ('unexpected', 'skipped', 'flaky'))
            and not report['infrastructure_errors'])
    except BaseException as error:
        report['runner_error'] = type(error).__name__
    finally:
        if filtered is not None:
            report['protocol'] = filtered.counts
        selector.close()
        previous_alarm = signal.getsignal(signal.SIGALRM)
        signal.signal(signal.SIGALRM, expire_cleanup)
        signal.alarm(12)
        try:
            # A live unreaped owner binds this group. After it has exited, use
            # the unique inherited marker rather than signal a reusable group ID.
            if process is not None and process.poll() is None:
                try:
                    cleanup.portability.signal_owned_group(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        cleanup.portability.signal_owned_group(process.pid, signal.SIGKILL)
                        process.wait(timeout=2)
                except Exception as error:
                    report['process_cleanup_error'] = type(error).__name__
            try:
                report['owned_pids_before_cleanup'] = cleanup.settle_owned(marker)
                report['owned_pids_remaining'] = cleanup.owned_processes(marker)
            except Exception as error:
                report['cleanup_error'] = type(error).__name__
        except CleanupExpired:
            report['cleanup_error'] = 'deadline expired; process closure unverified'
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous_alarm)
        try:
            report['source_head_after'] = subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, timeout=2).strip()
            report['source_status_after'] = subprocess.check_output(
                ['git', 'status', '--porcelain'], cwd=ROOT, text=True, timeout=2).strip()
            report['binary_sha256_after'] = hashlib.file_digest(binary.open('rb'), 'sha256').hexdigest()
            if (report['source_head_after'] != identity['head'] or report['source_status_after']
                    or report['binary_sha256_after'] != identity['binary_sha256']):
                report['binding_error'] = 'SUT or binary changed'
        except Exception as error:
            report['binding_error'] = type(error).__name__
        report['seconds'] = time.monotonic() - started
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if (report.get('returncode') == 0 and report.get('canonical_case_passed')
        and not any(report.get(k) for k in ('runner_error', 'cleanup_error',
                'process_cleanup_error', 'binding_error', 'owned_pids_before_cleanup', 'owned_pids_remaining'))) else 1

if __name__ == '__main__':
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, cleanup.portability.interrupt)
    raise SystemExit(run())
