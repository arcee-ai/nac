"""Pure qualification policy and bounded, exact-value fixture evidence export."""
import json
from ci_paths_budget import check as budget_check, checked_items, checked_digest
import hashlib
import os
from pathlib import Path
import plistlib
import stat

MAX_FILE = 256 * 1024
MAX_TOTAL = 12 * 1024 * 1024
COMPLETE_LOG_LIMIT = 2 * 1024 * 1024  # Opt-in R compiler graph only; total stays 12 MiB.


def console_state(data, uid):
    root = plistlib.loads(data)
    if isinstance(root, list):
        root = root[0]
    sessions = root.get('IOConsoleUsers', [])
    session = next((s for s in sessions if s.get('kCGSSessionUserIDKey') == uid
                    and s.get('kCGSSessionOnConsoleKey') is True), None)
    return {'same_user_on_console': session is not None,
            'login_done': session.get('kCGSessionLoginDoneKey') if session else None,
            'locked': session.get('CGSSessionScreenIsLocked') if session else None,
            'root_locked': root.get('IOConsoleLocked')}


def require_console(data, uid, quartz):
    state = console_state(data, uid)
    if not state['same_user_on_console'] or state['login_done'] is not True:
        raise RuntimeError('GUI unavailable: runner is not the logged-in Aqua console user')
    if any(value is True for value in (state['root_locked'], state['locked'], quartz.get('screen_is_locked'))):
        raise RuntimeError('GUI unavailable: console locked')
    # The observed hosted session omits both optional session lock flags. Do
    # not invent their values. Require independent positive observations from
    # IORegistry and the public caller-session API before normal fixture launch.
    if (state['root_locked'] is not False
            or quartz.get('quartz_session_available') is not True
            or quartz.get('on_console') is not True or quartz.get('login_done') is not True
            or not isinstance(quartz.get('screen_count'), int) or quartz['screen_count'] < 1
            or quartz.get('frontmost_bundle') in (None, '', 'unavailable', 'com.apple.loginwindow')
            or any(value is not None and value is not False
                   for value in (state['locked'], quartz.get('screen_is_locked')))):
        raise RuntimeError('GUI unavailable: positive console/session/screen prerequisites missing or unknown')
    return {'on_console': True, 'login_done': True, 'root_locked': False,
            'session_lock_flag': state['locked'], 'quartz_lock_flag': quartz.get('screen_is_locked'),
            'rendered_app_qualification_required': True}


def qualify_toolchain(actual, expected):
    # Exact image-bound OS pairs retain all historical approved envelopes.
    host = expected.get('image_hosts', {}).get(actual.get('image'), {})
    for key in ('developer_directory', 'xcode', 'sdk', 'os_version', 'os_build'):
        value = host.get(key, expected.get(key)) if key in ('os_version', 'os_build') else expected.get(key)
        if actual.get(key) != value:
            raise RuntimeError(f'{key} drift: expected {value!r}, got {actual.get(key)!r}; requalify explicitly')
    if actual.get('image') not in expected['images']:
        raise RuntimeError(f'image drift: {actual.get("image")!r}; requalify explicitly against official inventory')
    if expected['swift'] is not None and actual['swift'] != expected['swift']:
        raise RuntimeError('Swift compiler identity drift; requalify explicitly')
    return expected['swift'] is not None


def require_terminal_evidence(record):
    terminal = record.get('trusted_terminal', {})
    if (record.get('scenario') not in ('ci-terminal', 'ci-terminal-xctest') or record.get('passed') is not True
            or any(terminal.get(key) is not True for key in
                   ('exact_receipt', 'native_terminal_settled', 'unfocused_input_rejected'))
            or terminal.get('trusted_keydowns', 0) < 1 or terminal.get('synthetic_keydowns') != 0):
        raise RuntimeError('Required actual trusted terminal journey is missing or incomplete')
    return terminal


def export_evidence(raw, output, replacements, *, include_hashes=False, strict_json=False, essential_first=False):
    """Export only our fixture files, never arbitrary HOME or process listings."""
    output.mkdir(parents=True, exist_ok=True)
    total = 0
    manifest = []
    def priority(source):
        relative = source.relative_to(raw)
        essential = source.name in ('essential.json', 'ci-report.json', 'runner.json', 'configuration.json')
        return (0 if essential_first and essential else 1, str(relative))
    for source in sorted(checked_items(raw.rglob('*')),key=priority):
        budget_check()
        if any(part.endswith(('.app', '.xcresult')) for part in source.relative_to(raw).parts):
            continue
        if source.is_symlink() or not source.is_file():
            continue
        if source.suffix not in ('.log', '.json', '.png', '.ips', '.crash'):
            continue
        size = source.stat().st_size
        limit = 2 * 1024 * 1024 if source.suffix == '.png' else MAX_FILE
        capture = None
        if str(source.relative_to(raw)) == 'startup-protocol-runner/protocol-build.log':
            owner = source.with_name(source.name + '.ownership.json')
            descriptor = os.open(owner, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
                    raise RuntimeError('Complete R compiler log ownership receipt unavailable')
                encoded = stream.read(8193)
            if len(encoded) > 8192:
                raise RuntimeError('Complete R compiler log ownership receipt exceeds bound')
            ownership = json.loads(encoded)
            capture = ownership.get('output_capture', {})
            if (capture.get('mode') != 'complete' or type(capture.get('limit_bytes')) is not int
                    or not 0 < capture['limit_bytes'] <= COMPLETE_LOG_LIMIT
                    or type(capture.get('complete')) is not bool or type(capture.get('overflow')) is not bool
                    or type(capture.get('bytes_seen')) is not int or type(capture.get('bytes_retained')) is not int
                    or not 0 <= capture['bytes_retained'] == size <= capture['limit_bytes']
                    or capture['bytes_seen'] < size
                    or capture['overflow'] != (capture['bytes_seen'] > capture['limit_bytes'])
                    or (capture['complete'] and (capture['overflow'] or capture['bytes_seen'] != size
                        or any(ownership.get(k) is not True for k in ('accepted', 'reaped', 'drain_settled'))
                        or ownership.get('unknown') is not False or ownership.get('teardown_error') is not None))):
                raise RuntimeError('Complete R compiler log capture receipt invalid')
            limit = capture['limit_bytes']
        if source.suffix == '.png' and size > limit:
            raise RuntimeError(f'Image exceeds evidence limit: {source.name}')
        if strict_json and source.suffix == '.json':
            if size > limit:
                raise RuntimeError('Essential JSON exceeds evidence limit; original retained: ' + source.name)
            json.loads(source.read_bytes())
        with source.open('rb') as stream:
            data = stream.read(limit)
            if capture is not None and hashlib.sha256(data).hexdigest() != capture.get('sha256'):
                raise RuntimeError('Complete R compiler log digest changed')
            if include_hashes:
                stream.seek(0)
                source_sha256 = checked_digest(stream).hexdigest()
        if source.suffix != '.png':
            text = data.decode('utf-8', errors='replace')
            for original, replacement in replacements:
                if original:
                    text = text.replace(original, replacement)
            data = text.encode()
        total += len(data)
        if total > MAX_TOTAL:
            raise RuntimeError('Fixture evidence exceeds total upload limit')
        budget_check()
        target = output / source.relative_to(raw)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        entry = {'file': str(source.relative_to(raw)), 'bytes': len(data), 'truncated': size > limit}
        if capture is not None:
            entry.update(capture_complete=capture['complete'], truncated=not capture['complete'])
        if include_hashes:
            entry.update(raw_source_sha256=source_sha256, raw_source_bytes=size,
                         exported_sha256=hashlib.sha256(data).hexdigest())
        budget_check()
        manifest.append(entry)
        if essential_first:
            # Keep a valid prefix index even when later verbose export fails.
            (output / 'export.json').write_text(json.dumps(manifest, indent=2) + '\n')
    budget_check()
    (output / 'export.json').write_text(json.dumps(manifest, indent=2) + '\n')


def retain_path_failure_report(raw, output, replacements):
    """Repair only already exported failure metadata; never retry the export.

    This bounded finally writer preserves the original retention-completeness
    fact and prefix index. It acquires no actor or new work/retention allowance.
    """
    def read(path, limit):
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise RuntimeError('Failure report metadata exceeds its regular-file bound')
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise RuntimeError('Failure report metadata changed beyond its bound')
        return data

    def overwrite(descriptor, data):
        os.lseek(descriptor, 0, os.SEEK_SET)
        os.ftruncate(descriptor, 0)
        remaining = memoryview(data)
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise OSError('Failure metadata write made no progress')
            remaining = remaining[written:]

    target, index = output / 'ci-report.json', output / 'export.json'
    if raw.resolve() != raw or output.resolve() != output:
        raise RuntimeError('Failure report roots must remain canonical')
    if not target.exists():
        return  # No successfully exported report; never invent retained evidence.
    old_report = read(target, MAX_FILE)  # Reject a substituted symlink/nonregular destination.
    data = read(raw / 'ci-report.json', MAX_FILE)
    json.loads(data)
    text = data.decode('utf-8')
    for original, replacement in replacements:
        if original:
            text = text.replace(original, replacement)
    exported = text.encode()
    if len(exported) > MAX_FILE:
        raise RuntimeError('Redacted failure report exceeds evidence limit')
    json.loads(exported)
    old_index = read(index, MAX_TOTAL) if index.exists() else None
    manifest = json.loads(old_index) if old_index is not None else []
    if type(manifest) is not list or any(type(row) is not dict or type(row.get('file')) is not str for row in manifest):
        raise RuntimeError('Failure report prefix index is invalid')
    # Include a final written-but-not-yet-indexed payload from a partial export.
    total = len(exported)
    for path in output.rglob('*'):
        if path not in (target, index) and not path.is_symlink() and path.is_file():
            total += path.stat().st_size
            if total > MAX_TOTAL:
                raise RuntimeError('Fixture evidence exceeds total upload limit')
    if total > MAX_TOTAL:
        raise RuntimeError('Fixture evidence exceeds total upload limit')
    entry = dict(file='ci-report.json', bytes=len(exported), truncated=False,
                 raw_source_sha256=hashlib.sha256(data).hexdigest(), raw_source_bytes=len(data),
                 exported_sha256=hashlib.sha256(exported).hexdigest())
    manifest = [entry if row['file'] == 'ci-report.json' else row for row in manifest]
    if not any(row['file'] == 'ci-report.json' for row in manifest):
        manifest.append(entry)
    encoded_index = (json.dumps(manifest, indent=2) + '\n').encode()
    if len(encoded_index) > MAX_TOTAL:
        raise RuntimeError('Failure report prefix index exceeds evidence limit')
    destinations, writers = [], []
    changed = False
    primary = None
    try:
        # Both destinations must be open and regular before either is changed.
        # Retain original descriptors through writer close for bounded rollback.
        for path in (target, index):
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
            destinations.append(descriptor)
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise RuntimeError('Failure report destination is not regular')
        for descriptor in destinations:
            writers.append(os.dup(descriptor))
        changed = True
        for descriptor, data in zip(writers, (exported, encoded_index)):
            overwrite(descriptor, data)
        for descriptor in list(writers):
            os.close(descriptor)
            writers.remove(descriptor)
    except BaseException as error:
        primary = error
        try:
            if changed:
                overwrite(destinations[0], old_report)
                if old_index is not None:
                    overwrite(destinations[1], old_index)
            if old_index is None and len(destinations) == 2:
                current, opened = index.lstat(), os.fstat(destinations[1])
                if (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
                    raise RuntimeError('Failure report index binding changed during rollback')
                index.unlink()
        except BaseException as rollback_error:
            # Persistent storage failure can defeat rollback too. Preserve the
            # first failure and report this explicitly; no atomicity is claimed.
            error.add_note('Failure report/index restoration: ' + type(rollback_error).__name__)
        raise
    finally:
        close_error = None
        for descriptor in writers + destinations:
            try:
                os.close(descriptor)
            except OSError as error:
                close_error = close_error or error
        if close_error is not None:
            if primary is None:
                raise close_error  # Pair is complete, but descriptor cleanup failed.
            primary.add_note('Failure metadata descriptor cleanup: ' + type(close_error).__name__)


def redact_values():
    values = [(os.environ.get('HOME', ''), '<runner-home>'),
              (str(Path.cwd()), '<checkout>'), ('must-not-reach-engine', '<fixture-key>')]
    # Only exact secret values are masked; do not export the environment itself.
    for key, value in os.environ.items():
        if any(word in key.upper() for word in ('TOKEN', 'PASSWORD', 'SECRET', 'API_KEY')) and len(value) >= 8:
            values.append((value, '<redacted>'))
    return sorted(values, key=lambda row: len(row[0]), reverse=True)
