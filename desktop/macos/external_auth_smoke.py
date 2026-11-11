#!/usr/bin/env python3
"""Run the owned actual .app/system-WK + real system-browser auth fixture.

Requires the shared browser lease and the common builder's external-auth hook.
Does not synthesize OS input or change the system browser, credentials, or TCC.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

from external_auth_fixture import AuthFixture, cleanup_note
from smoke import session_lock_state
from instance_console import require_console


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def auth_arguments(arguments):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_app', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--console-observer', type=Path)
    options = parser.parse_args(arguments)
    return (options.source_app.resolve(), options.output.resolve(),
            options.console_observer.resolve() if options.console_observer is not None else None)


def require_isolated_host(observer=None):
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_OS') != 'macOS':
        raise SystemExit('Real external-browser qualification requires the coordinator-approved isolated hosted Mac contract; no launch attempted')
    if observer is not None:
        # The hosted controller supplies its exact source-compiled observer.
        # Missing optional session bits never replace Root/UID/Quartz evidence.
        return require_console(observer, [], 'hosted-auth-driver-before-launch')
    console = session_lock_state()
    if not console['observed'] or console['locked'] is not False:
        raise SystemExit('Real external-browser qualification requires an unlocked isolated Mac/browser profile; no launch attempted')
    return console


def retire_client(process):
    """Only the original LaunchServices client handle; never an app/browser PID."""
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
    else:
        process.wait(timeout=0)


def close_launch(process, log, primary):
    failure = primary
    actions = [] if process is None else [('Auth launch client retirement', lambda: retire_client(process))]
    actions.append(('Auth launch log close', log.close))
    for stage, close in actions:
        try:
            close()
        except BaseException as error:
            if failure is None:
                failure = error
            else:
                cleanup_note(failure, stage, error)
    if primary is None and failure is not None:
        raise failure


@contextmanager
def relocated_app(source, evidence, prefix):
    root = Path(tempfile.mkdtemp(prefix=prefix)).resolve()
    inode = root.stat().st_ino
    app = root / source.name
    custody = {'launched': False, 'settled': True}
    primary = None
    try:
        shutil.copytree(source, app)
        yield app, custody
    except BaseException as error:
        primary = error
        raise
    finally:
        if custody['launched'] and (primary is not None or not custody['settled']):
            notice = f'Auth custody unresolved; retained app root {root}; evidence {evidence}'
            if primary is not None:
                primary.add_note(notice)
            try:
                print(notice, file=sys.stderr)
            except BaseException as error:
                if primary is None:
                    raise
                cleanup_note(primary, 'Auth retention notice', error)
            if primary is None:
                raise RuntimeError(notice)
        else:
            try:
                if root.is_symlink() or root.stat().st_ino != inode:
                    raise AssertionError('Refusing removal of a replaced auth relocation root')
                shutil.rmtree(root)
            except BaseException as error:
                if primary is None:
                    raise
                cleanup_note(primary, 'Auth relocation removal', error)


def require_actor_exit(pid):
    if type(pid) is not int or not 0 < pid < 2**31:
        raise AssertionError('Incomplete auth actor identity; retirement unknown')
    result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'pid=,stat='],
                            capture_output=True, text=True, timeout=3)
    # Darwin ps reports an absent selector with exit1 and no rows/diagnostic.
    # Denial, failure, empty successful output and live/zombie rows are unknown.
    if result.returncode != 1 or result.stdout.strip() or result.stderr.strip():
        raise AssertionError('Auth actor retirement is unproven')


def require_terminal(record, scenario, build, profile=None):
    if not isinstance(record, dict) or record.get('scenario') != scenario:
        raise AssertionError('Incomplete auth case binding')
    for key in ['passed', 'commands_retired'] + (['stopped'] if profile is not None else
            ['engine_reaped', 'profile_removed', 'identity_retired']):
        if record.get(key) is not True:
            raise AssertionError('Incomplete auth terminal facts')
    source = build['source_revision']
    if (not isinstance(source, str) or len(source) != 40 or any(c not in '0123456789abcdef' for c in source)
            or not isinstance(build['build_id'], str) or not build['build_id']
            or record.get('ready_source') != source or record.get('ready_build') != build['build_id']):
        raise AssertionError('Auth terminal source identity differs')
    incarnation = record.get('launch_incarnation')
    if not isinstance(incarnation, str):
        raise AssertionError('Incomplete auth launch incarnation')
    if uuid.UUID(incarnation).int == 0:
        raise AssertionError('Incomplete auth launch incarnation')
    def same_store(value, expected):
        # Foundation can omit Darwin's /private alias; bind the physical store.
        return isinstance(value, str) and Path(value).is_absolute() and Path(value).resolve() == expected.resolve()
    if profile is not None:
        if not same_store(record.get('ready_store'), profile.store) or not same_store(record.get('selected_store'), profile.store):
            raise AssertionError('Auth terminal store binding differs')
        if incarnation == profile.last_incarnation:
            raise AssertionError('Auth launch reused a retired incarnation')
    else:
        value = record.get('profile')
        if not isinstance(value, str):
            raise AssertionError('Incomplete auth profile binding')
        root = Path(value)
        if (not root.is_absolute() or root.is_symlink() or not root.name.startswith('nac-mac-preview-')
                or root.resolve().parent != Path(tempfile.gettempdir()).resolve()
                or not same_store(record.get('ready_store'), root / 'store.db') or root.exists()
                or record.get('ready_track') != build['track']):
            raise AssertionError('Auth preview profile retirement is unproven')
    if record.get('app_pid') == record.get('engine_pid'):
        raise AssertionError('Auth actor roles are not distinct')
    require_actor_exit(record.get('app_pid'))
    require_actor_exit(record.get('engine_pid'))


def require_callback_witness(record, build):
    """Two retained positive rows, not a complete capture of the bounded log tail."""
    result = record.get('external_auth', {})
    proof = result.get('wrong_state_callback_witness', {})
    def need(value):
        if not value:
            raise AssertionError('Incomplete callback rejection/custody witness')
    def integer(value):
        need(type(value) is int and value >= 0)
        return value
    def decimal(value):
        need(isinstance(value, str) and value.isascii() and value.isdigit() and str(int(value)) == value)
        return int(value)
    def runtime(value):
        need(isinstance(value, dict) and set(value) == {
            'source_revision', 'build_id', 'schema_version', 'scenario', 'store_engine', 'journal_mode'})
        need(value['source_revision'] == build['source_revision'] and value['build_id'] == build['build_id']
             and integer(value['schema_version']) == record['ready_schema']
             and value['scenario'] == 'native-external-auth' and value['store_engine'] == 'sqlite'
             and value['journal_mode'] == 'wal')
    need(result.get('wrong_state_rejected_then_canceled') is True
         and proof.get('state_rejection_observed') is True and proof.get('rejection_before_cancel') is True
         and proof.get('complete_stream_capture') is False)
    need(proof.get('source') == build['source_revision'] and proof.get('build') == build['build_id']
         and integer(proof.get('schema')) == record['ready_schema']
         and integer(proof.get('engine_pid')) == record['engine_pid']
         and proof.get('engine_incarnation') == record['launch_incarnation'])
    for key in ['engine_incarnation', 'document', 'view', 'launch', 'recorder_id']:
        need(isinstance(proof.get(key), str) and uuid.UUID(proof[key]).int != 0)
    integer(record['ready_schema'])
    integer(record['engine_pid'])
    owner = decimal(proof.get('owner'))
    need(owner > 0 and 0 < decimal(proof.get('rejection_observed_ns')) < decimal(proof.get('cancel_issued_ns')))
    before, after = proof.get('token_counts_before'), proof.get('token_counts_after')
    need(isinstance(before, list) and isinstance(after, list) and len(before) == len(after) == 2)
    need([integer(v) for v in before] == [integer(v) for v in after])
    observations = proof.get('observations')
    need(isinstance(observations, list) and len(observations) == 2)
    for row, name, outcome in zip(observations,
            ['nac.mcp.oauth.callback.listening', 'nac.mcp.oauth.callback.state_rejected'], ['started', 'error']):
        need(isinstance(row, dict) and set(row) == {'timestamp_unix_ms', 'export_recorder_id',
            'name', 'kind', 'outcome', 'correlation', 'runtime'})
        need(integer(row['timestamp_unix_ms']) > 0 and row['export_recorder_id'] == proof['recorder_id']
             and row['name'] == name and row['kind'] == 'diagnostic' and row['outcome'] == outcome)
        need(isinstance(row['correlation'], dict) and set(row['correlation']) == {'generation'}
             and integer(row['correlation']['generation']) == owner)
        runtime(row['runtime'])
    finals = []
    for line in record.get('engine_log_after_shutdown', '').splitlines():
        if line.startswith('nac-telemetry-export '):
            row = json.loads(line[len('nac-telemetry-export '):])
            if row.get('final_receipt') is True and row.get('process_id') == record['engine_pid']:
                finals.append(row)
    need(len(finals) == 1)
    final = finals[0]
    need(integer(final['process_id']) == record['engine_pid'] and final['recorder_id'] == proof['recorder_id']
         and 1 <= integer(final['capacity']) <= 4096 and integer(final['receipt_failures']) == 0)
    runtime(final['runtime'])
    stats = final['stats']
    need(isinstance(stats, dict) and set(stats) == {'accepted', 'exported', 'dropped', 'failures'})
    counts = {key: integer(value) for key, value in stats.items()}
    need(counts['accepted'] == counts['exported'] >= 2 and counts['dropped'] == counts['failures'] == 0)
    need(record.get('engine_reaped') is True and record.get('identity_retired') is True
         and record.get('profile_removed') is True and record.get('commands_retired') is True)


def main():
    source_app, output, observer = auth_arguments(sys.argv[1:])
    console = require_isolated_host(observer)
    output.mkdir(parents=True, exist_ok=True)
    evidence = output / 'external-auth.json'
    assert not evidence.exists(), 'Use a fresh evidence destination'
    receipt = json.loads((source_app / 'Contents/Resources/build-receipt.json').read_text())
    engine = source_app / 'Contents/Resources/nac-web'
    build = json.loads(subprocess.check_output([str(engine), '__desktop-identity'], text=True))
    assert set(build) == {'product_version', 'build_id', 'source_revision', 'track'}
    assert not build['build_id'].startswith('native-auth-fixture-v1-')
    assert receipt['engine_identity'] == build and receipt['source_head'] == build['source_revision']
    assert receipt['mode'] == 'smoke-build' and receipt['source_dirty'] is False
    assert receipt['smoke_instrumentation'] is True and receipt['normal_startup'] is False
    assert 'PREVIEW_SMOKE' in receipt['compiler_flags'] and 'NATIVE_AUTH_FIXTURE' not in receipt['compiler_flags']
    assert digest(engine) == receipt['engine_sha256']
    assert digest(source_app / 'Contents/MacOS/NACPreview') == receipt['native_sha256']
    metadata = {'scope': 'actual-app-system-WK-to-real-system-browser; DOM-driven; local auth doubles',
                'physical_input_qualified': False, 'real_vendor_qualified': False,
                'session': console, 'build_receipt': receipt,
                'engine_sha256': digest(source_app / 'Contents/Resources/nac-web'),
                'native_sha256': digest(source_app / 'Contents/MacOS/NACPreview')}
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    with relocated_app(source_app, evidence, 'nac-external-auth-app-') as (app, custody):
        with AuthFixture() as fixture:
            log = (output / 'launch.log').open('wb')
            launch = None
            primary = None
            try:
                custody.update(launched=True, settled=False)
                launch = subprocess.Popen(['/usr/bin/open', '-n', '-W', str(app), '--args',
                    '--smoke-output', str(evidence), '--smoke-scenario', 'external-auth',
                    '--external-auth-origin', fixture.origin], stdout=log, stderr=subprocess.STDOUT)
                deadline = time.monotonic() + 180
                while launch.poll() is None and time.monotonic() < deadline:
                    time.sleep(.1)
                if launch.poll() is None:
                    raise TimeoutError('Actual external-auth app did not finish within 180 seconds')
                if launch.wait(timeout=0) != 0:
                    raise AssertionError('Actual external-auth scenario failed; inspect sanitized evidence')
                if time.monotonic() > deadline:
                    raise TimeoutError('External-auth terminal receipt exceeded original app deadline')
                record = json.loads(evidence.read_text())
                require_terminal(record, 'external-auth', build)
                require_callback_witness(record, build)
                snapshot = fixture.snapshot()
                (output / 'browser-observations.json').write_text(json.dumps(snapshot, indent=2) + '\n')
            except BaseException as error:
                primary = error
                raise
            finally:
                close_launch(launch, log, primary)
            custody['settled'] = True
    print(f'Actual external auth evidence: {output}')


if __name__ == '__main__':
    main()
