"""Admit one pinned historical producer for a distinct diagnostic dispatch."""
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SOURCE = 'e7b557dc558ac4382bd0f8e7308b4d5bd306f3b5'
TREE = '50608e2733c0436989b76c2b81140ef2bd6338aa'
OUTER_BYTES = 42945815
OUTER_SHA = '1e086b5eed3257ab1e39a17ed7de5f1b8d6886b56736da1d026b3108883886b7'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read(command, cwd=None):
    return subprocess.check_output(command, cwd=cwd, text=True, timeout=15).strip()


def main():
    root = Path(os.environ['NAC_DIAG_SUT_ROOT']).resolve()
    evidence = Path(os.environ['NAC_DIAG_EVIDENCE']).resolve()
    evidence.mkdir(mode=0o700, exist_ok=True)
    report = {'result': 'HOLD', 'scope': 'Retained producer admission for a distinct private diagnostic; not normal same-run CI admission'}
    try:
        receipt = json.loads((HERE / 'producer-receipt.json').read_text())
        control = json.loads((HERE / 'control.json').read_text())
        actual_image = os.environ['ImageOS'] + '@' + os.environ['ImageVersion']
        actual_rustc = read(['rustc', '--version'])
        actual_attempt = int(os.environ['GITHUB_RUN_ATTEMPT'])
        report.update(producer_receipt=receipt, control=control,
                      consumer_run_id=os.environ['GITHUB_RUN_ID'], consumer_attempt=actual_attempt,
                      consumer_image=actual_image, consumer_rustc=actual_rustc,
                      platform=platform.system(), architecture=platform.machine())
        require(os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch', 'dispatch only')
        require(control['run_id'] == os.environ['GITHUB_RUN_ID'], 'control/new-run mismatch')
        require(control['run_id'] != receipt['run_id'], 'must be a distinct diagnostic run')
        require(actual_attempt == 1, 'one attempt only; rerun is not admitted')
        require(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'requires actual x86_64 Linux')
        require(read(['git', 'rev-parse', 'HEAD'], root) == SOURCE, 'exact SUT source mismatch')
        require(read(['git', 'rev-parse', 'HEAD^{tree}'], root) == TREE, 'SUT tree mismatch')
        require(not read(['git', 'status', '--porcelain'], root), 'SUT checkout is dirty')
        require(actual_rustc == receipt['rustc'], 'compiler mismatch; no fallback build')
        require(read(['node', '--version']) == 'v24.22.1', 'Node version mismatch')
        for package in ('playwright-core', '@playwright/test'):
            manifest = root / 'crates/nac-server/web/node_modules' / package / 'package.json'
            require(json.loads(manifest.read_text())['version'] == '1.62.1', 'Playwright version mismatch')
        archive_zip = HERE / 'producer.zip'
        require(not archive_zip.is_symlink() and archive_zip.is_file(), 'outer archive must be regular')
        require(archive_zip.stat().st_size == OUTER_BYTES, 'outer byte count mismatch')
        with archive_zip.open('rb') as source:
            require(hashlib.file_digest(source, 'sha256').hexdigest() == OUTER_SHA, 'outer digest mismatch')
        archive = HERE / 'browser-binary.tar.gz'
        with zipfile.ZipFile(archive_zip) as zipped:
            members = zipped.infolist()
            require(len(members) == 1, 'unexpected ZIP member count')
            member = members[0]
            mode = member.external_attr >> 16
            require(member.filename == 'browser-binary.tar.gz' and not member.is_dir(), 'unexpected ZIP member')
            require(not member.flag_bits & 1, 'encrypted ZIP member')
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG), 'ZIP member is not regular')
            require(member.file_size == receipt['archive_bytes'], 'inner archive size mismatch')
            remaining = receipt['archive_bytes']
            digest = hashlib.sha256()
            with zipped.open(member) as source, archive.open('xb') as destination:
                while chunk := source.read(min(1024 * 1024, remaining + 1)):
                    remaining -= len(chunk)
                    require(remaining >= 0, 'oversized ZIP content')
                    digest.update(chunk)
                    destination.write(chunk)
            require(remaining == 0 and digest.hexdigest() == receipt['archive_sha256'], 'inner digest mismatch')
        environment = dict(os.environ, BROWSER_BINARY_RECEIPT=json.dumps(receipt, separators=(',', ':')))
        # Deliberately name the OLD producer. The actual new dispatch is recorded
        # separately above. Never pass the new run ID as if this were same-run CI.
        command = [sys.executable, str(root / '.github/scripts/browser-binary.py'), 'consume',
                   '--archive', str(archive), '--output-dir', str(HERE / 'binary-runtime'),
                   '--source', SOURCE, '--repository', 'arcee-ai/nac',
                   '--run-id', '42304372728', '--attempt', str(actual_attempt),
                   '--target', 'x86_64-unknown-linux-gnu', '--rustc', actual_rustc,
                   '--runner-image', actual_image]
        completed = subprocess.run(command, env=environment, text=True, capture_output=True, timeout=30)
        require(completed.returncode == 0, 'canonical consumer rejected retained producer')
        admission = json.loads(completed.stdout)
        report['canonical_consumer'] = admission
        require(admission['mode'] == 'artifact', 'canonical consumer requests source fallback; HOLD, no build')
        binary = Path(admission['binary'])
        require(admission['binary_sha256'] == receipt['binary_sha256'], 'admitted binary digest mismatch')
        with binary.open('rb') as source:
            require(hashlib.file_digest(source, 'sha256').hexdigest() == receipt['binary_sha256'], 'runtime digest mismatch')
        # Source-only discovery: no browser, server or test execution. Refuse
        # broad selection before the one allowed pressure invocation starts.
        title = 'connected renderer keeps copy selection, input, resize and Ctrl-C responsive under finite noisy output'
        web = root / 'crates/nac-server/web'
        discovery_env = dict(os.environ)
        for name in list(discovery_env):
            if name in ('DEBUG', 'DEBUG_FILE') or name.startswith('PLAYWRIGHT_JSON_'):
                del discovery_env[name]
        import re
        discovery = subprocess.run(['node', str(web / 'node_modules/@playwright/test/cli.js'),
            'test', '--config', str(web / 'playwright.config.ts'),
            'terminal-local-acceptance.e2e.ts', '--grep', re.escape(title),
            '--workers=1', '--retries=0', '--list', '--reporter=json'],
            cwd=web, env=discovery_env, text=True, capture_output=True, timeout=30)
        require(discovery.returncode == 0, 'exact-case discovery failed')
        listed = json.loads(discovery.stdout)
        def specs(suite):
            yield from suite.get('specs', [])
            for child in suite.get('suites', []):
                yield from specs(child)
        selected = [spec for suite in listed['suites'] for spec in specs(suite)]
        require(len(selected) == 1 and selected[0]['title'] == title
                and len(selected[0]['tests']) == 1
                and not selected[0]['tests'][0]['results']
                and not listed.get('errors'), 'discovery must select exactly one unexecuted case')
        report['discovery'] = {'title': title, 'selected': 1, 'executed': 0, 'exit': 0}
        identity = dict(head=SOURCE, tree=TREE, binary_path=str(binary),
                        binary_sha256=receipt['binary_sha256'], binary_bytes=receipt['binary_bytes'],
                        producer_run_id=receipt['run_id'], producer_attempt=receipt['run_attempt'],
                        artifact_id=13546575180, consumer_run_id=control['run_id'],
                        consumer_attempt=actual_attempt, consumer_image=actual_image,
                        control_head=control['head'], scope=report['scope'])
        (evidence / 'identity.json').write_text(json.dumps(identity, indent=2) + '\n')
        report['result'] = 'ADMITTED_FOR_ONE_DIAGNOSTIC'
    except Exception as error:
        # Fixed messages only: no subprocess streams, environment or credentials.
        report['error_type'] = type(error).__name__
        if isinstance(error, RuntimeError):
            report['reason'] = str(error)
    finally:
        (evidence / 'producer-admission.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'result': report['result'], 'reason': report.get('reason')}))
    return 0 if report['result'] == 'ADMITTED_FOR_ONE_DIAGNOSTIC' else 1


if __name__ == '__main__':
    raise SystemExit(main())
