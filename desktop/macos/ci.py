#!/usr/bin/env python3
"""Build and qualify the actual development app on a dedicated hosted Mac."""
import argparse
from ci_paths_budget import active, check as budget_check, time_limit, using
from collections import deque
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import threading
import time

from ci_support import (COMPLETE_LOG_LIMIT, console_state, export_evidence, qualify_toolchain, redact_values,
                        require_console, require_terminal_evidence)
from smoke import cleanup_failed_case
from ci_qualifications import require_checkout, require_full_preview, require_workspace, require_rich_capture, select_target
from ci_xctest import run_terminal
from ci_instances import audit_cleanup as audit_instances, qualify as qualify_instances, retain_receipt as retain_instances
from ci_terminal import qualify as qualify_terminal
from ci_startup import qualify as qualify_startup
from ci_lifecycle import qualify as qualify_lifecycle, image_report as lifecycle_image_report
from ci_lifecycle_contract import require_capsule as require_lifecycle_capsule
from ci_lifecycle_finalization import finalize as finalize_lifecycle, gui_guard as lifecycle_gui_guard

ROOT = Path(__file__).resolve().parents[2]
RUN_DEADLINE = time.monotonic() + 30 * 60  # Leave ten job minutes for cleanup/upload.


def command(args, cwd=ROOT):
    seconds=min(30,max(1,RUN_DEADLINE-time.monotonic()))
    seconds=time_limit(seconds)
    value=subprocess.check_output(args,cwd=cwd,text=True,stderr=subprocess.STDOUT,timeout=seconds).strip()
    budget_check()
    return value


def native_report(args, log):
    # AppKit/Vision may log diagnostics to stderr. Keep those separate from
    # the helper's JSON so warnings cannot corrupt a successful observation.
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                            timeout=time_limit(min(60, max(1, RUN_DEADLINE - time.monotonic()))))
    budget_check()
    log.write_text(result.stderr[-65536:])
    if result.returncode:
        raise RuntimeError(f'Native evidence reader failed ({result.returncode}); see {log.name}')
    return json.loads(result.stdout)


def run(args, log, timeout, cwd=ROOT, cleanup_grace=5, *, env=None, abort=None, retain_ownership=False,
        complete_output_limit=None):
    """Retain every accepted handle through thread startup, waits and teardown."""
    print(f'Native CI phase: {log.name}', flush=True)
    process,thread=None,None
    primary,teardown=None,None
    reaped=False
    bound=active()
    if complete_output_limit is not None and (type(complete_output_limit) is not int
            or not 0 < complete_output_limit <= COMPLETE_LOG_LIMIT):
        raise ValueError('Invalid complete output capture limit')
    chunks=deque(maxlen=64 if complete_output_limit is None else None)
    bytes_seen=bytes_retained=0
    overflow=drain_finished=False
    drain_error=capture_failure=None
    try:
        if abort is not None and abort():
            raise RuntimeError('Native fixture ownership unavailable before helper launch')
        seconds=time_limit(min(timeout,max(1,RUN_DEADLINE-time.monotonic())),15)
        process=subprocess.Popen(args,cwd=cwd,stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT,start_new_session=True,env=env)
        budget_check()
        def drain():
            nonlocal bytes_seen,bytes_retained,overflow,drain_error,drain_finished
            try:
                while chunk:=process.stdout.read(4096):
                    if complete_output_limit is None:
                        chunks.append(chunk)
                    else:
                        bytes_seen+=len(chunk)
                        kept=chunk[:max(0,complete_output_limit-bytes_retained)]
                        if kept:chunks.append(kept)
                        bytes_retained+=len(kept)
                        overflow=bytes_seen>complete_output_limit
                drain_finished=True
            except BaseException as error:
                if complete_output_limit is None:raise
                drain_error=error
        thread=threading.Thread(target=drain,daemon=True)
        budget_check()
        thread.start()
        seconds=min(seconds,time_limit(seconds,15))
        deadline=time.monotonic()+seconds
        while True:
            budget_check()
            if abort is not None and abort():
                raise RuntimeError('Native fixture ownership unavailable during helper execution')
            if complete_output_limit is not None:
                if overflow:raise RuntimeError('Native complete output exceeds capture limit')
                if drain_error is not None:raise RuntimeError('Native complete output drain failed')
            remaining=deadline-time.monotonic()
            if remaining<=0:raise subprocess.TimeoutExpired(args,seconds)
            try:
                code=process.wait(timeout=min(.1,remaining) if abort is not None or bound is not None
                                  or complete_output_limit is not None else remaining)
                reaped=True
                break
            except subprocess.TimeoutExpired:
                if abort is None and bound is None and complete_output_limit is None:raise
        budget_check()
        if code:raise RuntimeError(f'{args[0]} failed ({code}); see {log.name}')
    except BaseException as error:
        primary=error
        if bound is not None and isinstance(error,subprocess.TimeoutExpired):
            bound.owner.fail(bound.kind+': helper timeout')
        raise
    finally:
        # Budget checks are synchronous. No alarm crosses Popen acquisition.
        # The existing helper-group authority is unchanged and always attempted.
        try:
            if process is not None and process.poll() is None:
                os.killpg(process.pid,signal.SIGTERM)
                try:process.wait(timeout=cleanup_grace)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid,signal.SIGKILL)
                    process.wait(timeout=5)
                reaped=True
            elif process is not None:reaped=True
        except BaseException as error:teardown=error
        try:
            if thread is not None and thread.is_alive():thread.join(timeout=5)
            if process is not None and (thread is None or not thread.is_alive()):process.stdout.close()
            log.write_bytes(b''.join(chunks))
        except BaseException as error:teardown=teardown or error
        unknown=(process is not None and not reaped) or (thread is not None and thread.is_alive())
        if complete_output_limit is not None and primary is None and (overflow or drain_error is not None or not drain_finished or unknown):
            capture_failure=RuntimeError('Native complete output exceeds capture limit' if overflow else
                                         'Native complete output drain failed')
            primary=capture_failure
        if bound is not None or retain_ownership or complete_output_limit is not None:
            owner=bound.owner if bound is not None else None
            if owner is not None and (teardown is not None or unknown):owner.fail('helper finalization unknown')
            try:
                with using(owner.retention if owner is not None else None):
                    receipt=dict(
                        accepted=process is not None,pid=process.pid if process else None,
                        reaped=reaped,drain_settled=thread is None or not thread.is_alive(),unknown=unknown,
                        primary_error=type(primary).__name__ if primary else None,
                        teardown_error=type(teardown).__name__ if teardown else None)
                    if complete_output_limit is not None:
                        receipt['output_capture']=dict(mode='complete',limit_bytes=complete_output_limit,
                            bytes_seen=bytes_seen,bytes_retained=bytes_retained,overflow=overflow,
                            complete=drain_finished and not overflow and drain_error is None and teardown is None and not unknown,
                            sha256=hashlib.sha256(b''.join(chunks)).hexdigest())
                    log.with_name(log.name+'.ownership.json').write_text(json.dumps(receipt)+'\n')
            except BaseException:
                if owner is not None:owner.fail('retention: helper ownership receipt unknown')
                elif primary is None:raise  # Explicit custody cannot silently lose its receipt.
        if teardown is not None and (primary is None or (bound is None and complete_output_limit is None and not retain_ownership)):raise teardown
        if capture_failure is not None:raise capture_failure
        if primary is None:budget_check()
        elif bound is not None:
            try:budget_check()
            except TimeoutError:pass  # Preserve primary failure; expiry remains latched.


def _recorded_command(pid):
    """Only a confirmed disappearance turns a failed ps lookup into no target."""
    if not pid or not alive(pid):
        return ''
    try:
        args = command(['/bin/ps', '-p', str(pid), '-o', 'command='])
    except subprocess.CalledProcessError as error:
        # With stderr combined, a diagnostic or any other status is unknown.
        if error.returncode != 1 or error.output != '' or alive(pid):
            raise
        return ''
    if not args and alive(pid):
        raise RuntimeError('Recorded fixture observation is empty while still live; refusing signal')
    return args


def settle_apps(raw, cleanup=None, extra_alive=None, workspace=False):
    """Recover owned records independently, retaining every cleanup failure."""
    results = []
    failures = []
    cleaner = cleanup or cleanup_failed_case
    extra_alive = extra_alive or alive
    records = [record for folder in ('evidence', 'workspace') for record in (raw / folder).glob('*.json')]
    app_name = 'NAC Development Preview.app' if workspace else 'NAC Development Preview Smoke.app'
    prefixes = ('nac-mac-relocation-', 'nac-wk-workspace-') if workspace else ('nac-mac-relocation-',)
    for record in sorted(records):
        try:
            data = json.loads(record.read_text())
            pid = data.get('app_pid')
            if not pid:
                continue
            engine_pid = data.get('engine_pid', 0)
            args = ''
            for target in (pid, engine_pid):
                args = _recorded_command(target)
                if args:
                    break
            bundle = Path(data.get('relocated_app', '/missing-confirmed-dead-bundle'))
            if args:
                member = 'MacOS/NACPreview' if target == pid else 'Resources/nac-web'
                suffix = '/' + app_name + '/Contents/' + member
                path, found, _ = args.partition(suffix)
                prefix = Path(tempfile.gettempdir()).resolve()
                executable = Path(path + found)
                if (not found or not executable.is_absolute()
                        or not executable.resolve().is_relative_to(prefix)
                        or not any(p.startswith(prefixes) for p in executable.parts)):
                    raise RuntimeError('Owned app executable binding cannot be verified; refusing signal')
                bundle = Path(path + '/' + app_name)
            root = data.get('profile')
            extras = [data[key] for key in ('app_helper_pid', 'descendant_pid') if data.get(key)]
            if args or (root and Path(root).exists()) or any(extra_alive(pid) for pid in extras):
                cleaner(record, bundle)
                results.append({'scenario': data.get('scenario'), 'fallback_cleanup': True})
            settled_by = time.monotonic() + 3
            while any(extra_alive(pid) for pid in extras) and time.monotonic() < settled_by:
                time.sleep(.025)
            if any(extra_alive(pid) for pid in extras):
                raise RuntimeError('Recorded owned fixture helper/descendant survived cleanup')
            if root and Path(root).exists():
                raise RuntimeError('Fixture profile survived cleanup')
            if data.get('engine_pid') and alive(data['engine_pid']):
                raise RuntimeError('Recorded fixture engine survived cleanup')
            if alive(pid):
                raise RuntimeError('Recorded fixture app survived cleanup')
        except Exception as error:
            failures.append((record.name, error))
    if failures:
        details = '; '.join(f'{name}: {type(error).__name__}: {error}' for name, error in failures)
        raise RuntimeError(f'Owned fixture cleanup failed: {details}') from failures[0][1]
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
    parser.add_argument('--qualification', help='One checked-in immutable supplier target')
    parser.add_argument('--source-root', type=Path, help='Separate unchanged target checkout')
    parser.add_argument('--test-source-root', type=Path, help='Exact external startup XCTest checkout')
    parser.add_argument('--protocol-source-root', type=Path, help='Exact external startup Rust verifier checkout')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        parser.error('--output must not exist')
    output.mkdir(parents=True)
    raw = output.parent / (output.name + '-private')
    raw.mkdir(mode=0o700)
    report = {'result': 'failed', 'acceptance': 'Named native qualification only; full ALL-354 incomplete',
              'harness_sha': command(['git', 'rev-parse', 'HEAD']),
              'harness_dirty': bool(command(['git', 'status', '--porcelain'])),
              'pr_head': os.environ.get('PR_HEAD_SHA'), 'pr_base': os.environ.get('PR_BASE_SHA'),
              'workflow_sha': os.environ.get('GITHUB_SHA'), 'event': os.environ.get('GITHUB_EVENT_NAME'),
              'run_id': os.environ.get('GITHUB_RUN_ID'), 'run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT')}
    started = time.time()
    source_root = ROOT
    target = None
    target_module = None
    workspace = False
    instances = False
    terminal = False
    startup = False
    lifecycle = False
    def interrupt(signum, _frame):
        raise RuntimeError(f'CI interrupted by signal {signum}')
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, interrupt)
    try:
        if report['harness_sha'] != args.expected_sha or report['harness_dirty']:
            raise RuntimeError('Expected clean exact candidate checkout')
        if args.qualification:
            target = select_target(args.qualification)
            workspace = target['suite'] == 'workspace'
            instances = target['suite'] == 'instances'
            terminal = target['suite'] == 'terminal'
            startup = target['suite'] == 'startup'
            lifecycle = target['suite'] == 'lifecycle'
            if not args.source_root or args.source_root.is_symlink():
                raise RuntimeError('Qualification requires an explicit non-symlink source root')
            source_root = args.source_root.resolve()
            if source_root == ROOT or source_root.is_relative_to(ROOT):
                raise RuntimeError('Supplier source must be a separate checkout, not part of the harness')
            report['qualification'] = args.qualification
            report['target_contract'] = target
            if lifecycle:
                if not args.source_root.is_absolute() or args.source_root.resolve() != args.source_root:
                    raise RuntimeError('Lifecycle requires a canonical absolute supplier checkout')
                require_lifecycle_capsule(os.environ.get('NAC_LIFECYCLE_CUSTODY', ''), args.expected_sha, os.environ)
        elif args.source_root:
            raise RuntimeError('Separate source root requires an approved qualification key')
        external_roots = []
        if startup:
            if not args.source_root.is_absolute() or args.source_root.resolve() != args.source_root:
                raise RuntimeError('Startup requires a canonical absolute product checkout')
            for path, key in ((args.test_source_root, 'test_source_sha'),
                              (args.protocol_source_root, 'protocol_source_sha')):
                if path is None or not path.is_absolute() or path.is_symlink() or path.resolve() != path:
                    raise RuntimeError('Startup requires exact canonical external source checkouts')
                external_roots.append((path, target[key]))
            roots = [ROOT, source_root, *(root for root, _ in external_roots)]
            if any(a == b or a.is_relative_to(b) or b.is_relative_to(a)
                   for index, a in enumerate(roots) for b in roots[index + 1:]):
                raise RuntimeError('Startup P/Q/R/H checkouts must be separate and non-overlapping')
        elif args.test_source_root or args.protocol_source_root:
            raise RuntimeError('External test/protocol sources require the finite startup qualification')
        report.update(require_checkout(source_root, target['source_sha'] if target else args.expected_sha))
        for root, sha in external_roots:
            require_checkout(root, sha)
        if platform.system() != 'Darwin' or platform.machine() != 'arm64':
            raise RuntimeError('Native prerequisite unavailable: Darwin ARM64 required')
        run(['make', 'setup'], raw / 'setup.log', 600)
        if target:
            run(['make', 'setup'], raw / 'target-setup.log', 600, cwd=source_root)
            require_checkout(source_root, target['source_sha'])
        for index, (root, sha) in enumerate(external_roots):
            run(['make', 'setup'], raw / f'external-{index}-setup.log', 600, cwd=root)
            require_checkout(root, sha)
        if command(['git', 'status', '--porcelain']):
            raise RuntimeError('Locked setup modified the candidate source')
        run(['python3', '-B', '-m', 'unittest', 'discover', '-s', 'desktop/macos', '-p', 'test_*.py'],
            raw / 'fixture-controls.log', 60)
        envelope = target['envelope'] if target else 'ci-toolchain.json'
        expected = json.loads((ROOT / 'desktop/macos' / envelope).read_text())
        actual = {'developer_directory': os.environ.get('DEVELOPER_DIR'),
                  'xcode': command(['xcodebuild', '-version']),
                  'sdk': command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
                  'swift': command(['xcrun', 'swiftc', '--version']),
                  'image': os.environ.get('ImageVersion'),
                  'os_version': command(['sw_vers', '-productVersion']),
                  'os_build': command(['sw_vers', '-buildVersion'])}
        report['toolchain'] = actual
        report['xcode_select_default'] = command(['xcode-select', '-p'])
        compiler_pinned = qualify_toolchain(actual, expected)
        console = subprocess.check_output(['/usr/sbin/ioreg', '-a', '-n', 'Root', '-d', '1'])
        report['console_state'] = console_state(console, os.getuid())
        gui_helper = raw / 'native-gui-reader'
        run(['xcrun', 'swiftc', '-swift-version', '5', 'desktop/macos/CIGUI.swift',
             '-o', str(gui_helper)], raw / 'gui-reader-build.log', 90)
        report['quartz'] = native_report([str(gui_helper)], raw / 'gui-reader.log')
        report['console'] = require_console(console, os.getuid(), report['quartz'])
        report['rustc'] = command(['rustc', '-Vv'])
        report['node'] = command(['node', '--version'])
        if args.preflight_only:
            report['result'] = 'preflight-only'
            return
        os.environ['NAC_MAC_OUTPUT'] = str(raw)
        for key in ('NAC_MAC_ENGINE', 'NAC_MAC_SKIP_ENGINE_BUILD', 'NAC_MAC_SMOKE_SCENARIOS', 'NAC_MAC_CI_TERMINAL'):
            os.environ.pop(key, None)
        os.environ.update(NAC_SOURCE_REVISION=report['source_sha'], NAC_BUILD_TRACK='dev',
                          NAC_BUILD_ID='dev-' + report['source_sha'])
        if target and not instances and not startup and not lifecycle:
            # Reuse the exact source owner's failure cleanup, including its
            # native fixture helpers. No code is copied into that checkout.
            sys.path.insert(0, str(source_root / 'desktop/macos'))
            try:
                spec = importlib.util.spec_from_file_location('qualified_target_smoke', source_root / 'desktop/macos/smoke.py')
                loaded = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(loaded)
                target_module = loaded
            finally:
                sys.path.pop(0)
        if lifecycle:
            report.update(qualify_lifecycle(raw, source_root, target, args.expected_sha,
                                           run, command, lifecycle_image_report, RUN_DEADLINE, report=report))
        elif startup:
            report.update(qualify_startup(raw, source_root, args.test_source_root, args.protocol_source_root,
                                         args.expected_sha, run, command, native_report))
        elif instances:
            report.update(qualify_instances(raw, source_root, target, run, command, native_report))
        elif terminal:
            report.update(qualify_terminal(raw, source_root, target, run, command, native_report,
                                          target_module.cleanup_failed_case))
        else:
            run(['bash', 'desktop/macos/preview.sh', 'build'], raw / 'ordinary-build.log', 900, cwd=source_root)
            ordinary = raw / 'NAC Development Preview.app/Contents/MacOS/NACPreview'
            report['ordinary_build'] = {}
            for name, binary in [('native_sha256', ordinary), ('engine_sha256', ordinary.parent.parent / 'Resources/nac-web')]:
                with binary.open('rb') as stream:
                    report['ordinary_build'][name] = hashlib.file_digest(stream, 'sha256').hexdigest()
            engine = ordinary.parent.parent / 'Resources/nac-web'
            report['engine_version'] = command([str(engine), '--version'])
            if report['source_sha'][:12] not in report['engine_version']:
                raise RuntimeError('Built engine does not identify the exact target source')
            identity_file = ordinary.parent.parent / 'Resources/engine-identity.json'
            if identity_file.exists():
                report['engine_identity'] = json.loads(identity_file.read_text())
                if report['engine_identity'].get('source_revision') != report['source_sha']:
                    raise RuntimeError('Bundled engine manifest belongs to another target source')
            symbols = command(['/usr/bin/nm', str(ordinary)])
            if any(name in symbols for name in ('PreviewSmoke', 'CITerminal')) or '--smoke-output' in command(['/usr/bin/strings', str(ordinary)]):
                raise RuntimeError('Ordinary app contains test instrumentation')
            os.environ['NAC_MAC_SKIP_ENGINE_BUILD'] = '1'
            if workspace:
                # The source owner requires a private exact-source binary; the
                # dedicated runner owns it throughout this complete job.
                cargo_target = Path(os.environ.get('CARGO_TARGET_DIR', source_root / 'target'))
                if not cargo_target.is_absolute():
                    cargo_target = source_root / cargo_target
                os.environ['NAC_MAC_ENGINE'] = str(cargo_target / 'debug/nac-web')
                run(['bash', 'desktop/macos/workspace.sh'], raw / 'workspace-build.log', 120, cwd=source_root)
                app = raw / 'NAC Development Preview.app'
                run(['python3', '-B', 'desktop/macos/smoke.py', str(app), str(raw / 'evidence')],
                    raw / 'app-journeys.log', 800, cwd=source_root)
                run(['python3', '-B', 'desktop/macos/workspace.py', 'run', str(app), str(raw / 'workspace'),
                     '--baseline', str(raw / 'evidence/summary.json')], raw / 'workspace-journeys.log', 650, cwd=source_root)
                episodes = {name: json.loads((raw / 'workspace' / (name + '.json')).read_text())
                            for name in ('workspace-direct', 'workspace-legacy')}
                report['target_suite'] = require_workspace(json.loads((raw / 'workspace/matrix.json').read_text()),
                    episodes, json.loads((raw / 'evidence/summary.json').read_text()), target)
                report['rich_capture'] = require_rich_capture(episodes['workspace-direct'],
                    json.loads((raw / 'workspace/matrix.json').read_text())['provenance'],
                    raw / 'workspace/workspace-direct-rich-chat.png', source_root / 'desktop/macos/WorkspaceFixture.swift')
                report['rich_capture']['episode_sha256'] = hashlib.sha256((raw / 'workspace/workspace-direct.json').read_bytes()).hexdigest()
            else:
                run(['bash', 'desktop/macos/preview.sh', 'smoke'], raw / 'app-journeys.log', 800, cwd=source_root)
            if target and not workspace:
                report['target_suite'] = require_full_preview(json.loads((raw / 'evidence/summary.json').read_text()),
                    target, report['ordinary_build']['engine_sha256'])
            elif not target:
                report['xctest'] = run_terminal(raw, run, command)
                report['trusted_terminal'] = require_terminal_evidence(json.loads((raw / 'evidence/ci-terminal-xctest.json').read_text()))
            helper = raw / 'native-image-reader'
            run(['xcrun', 'swiftc', '-swift-version', '5', 'desktop/macos/CIEvidence.swift',
                 '-o', str(helper)], raw / 'image-reader-build.log', 90)
            images = [raw / 'evidence' / name for name in ('streamed-chat.png', 'persisted-chat.png')]
            report['images'] = native_report([str(helper), *map(str, images)], raw / 'image-reader.log')
            if workspace:
                for kind, name in [('workspace-rich', 'workspace-direct-rich-chat.png'), ('approval', 'workspace-direct-approval.png'),
                                   ('chat', 'workspace-legacy-legacy.png')]:
                    flags = [] if kind == 'chat' else ['--' + kind]
                    report.setdefault('workspace_images', []).extend(native_report(
                        [str(helper), *flags, str(raw / 'workspace' / name)], raw / (kind + '-image-reader.log')))
            if not target:
                report['terminal_image'] = native_report([str(helper), '--terminal', str(raw / 'evidence/trusted-terminal.png')],
                                                          raw / 'terminal-image-reader.log')
        report['quartz_end'] = native_report([str(gui_helper)], raw / 'gui-reader-end.log')
        if lifecycle:
            lifecycle_gui_guard(report['quartz_end'], [(str(source_root), '<target-checkout>'), *redact_values()])
        console_end = subprocess.check_output(['/usr/sbin/ioreg', '-a', '-n', 'Root', '-d', '1'], timeout=15)
        report['console_end'] = require_console(console_end, os.getuid(), report['quartz_end'])
        require_checkout(source_root, report['source_sha'])
        require_checkout(ROOT, args.expected_sha)
        report['result'] = 'passed' if compiler_pinned else 'unqualified-swift'
        if not compiler_pinned:
            raise RuntimeError('Smoke completed; pin observed Swift compiler identity before acceptance')
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        try:
            if instances:
                try:
                    report['instance_cleanup'] = audit_instances(raw / 'instances', raw / 'instance-dev/InstanceObservation', command)
                finally:
                    report['instance_receipt_index'] = retain_instances(raw / 'instances')
            if startup:
                report['cleanup'] = {'owner': 'startup preinstalled OS witness; per-case receipts',
                                     'generic_JSON_PID_cleanup_used': False}
            elif lifecycle:
                report['cleanup'] = {'owner': 'immutable ALL-344 driver finally and external per-case residual audit',
                                     'generic_JSON_PID_cleanup_used': False,
                                     'receipt_glob': 'lifecycle/*/external-result.json'}
            else:
                report['cleanup'] = settle_apps(raw, cleanup=target_module.cleanup_failed_case if target_module else None,
                                                extra_alive=getattr(target_module, 'alive', None), workspace=workspace or terminal)
        except Exception as error:
            report['cleanup_error'] = str(error)
            report['result'] = 'failed'
            raise
        finally:
            crashes = Path.home() / 'Library/Logs/DiagnosticReports'
            if lifecycle:
                report['elapsed_seconds'] = round(time.time() - started, 3)
                finalize_lifecycle(raw, output, report, [(str(source_root), '<target-checkout>'), *redact_values()],
                                   crashes=crashes, started=started)
            else:
                count = 0
                for crash in sorted(crashes.glob('NACPreview*')):
                    if crash.is_file() and not crash.is_symlink() and crash.stat().st_mtime >= started and count < 3:
                        with crash.open('rb') as stream:
                            (raw / f'crash-{count}{crash.suffix}').write_bytes(stream.read(65536))
                        count += 1
                report['crash_reports'] = count
                report['elapsed_seconds'] = round(time.time() - started, 3)
                (raw / 'ci-report.json').write_text(json.dumps(report, indent=2) + '\n')
                export_evidence(raw, output, [(str(source_root), '<target-checkout>'), *redact_values()], include_hashes=startup)


if __name__ == '__main__':
    main()
