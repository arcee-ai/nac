"""Pure qualification policy and bounded, exact-value fixture evidence export."""
import json
import os
from pathlib import Path
import plistlib

MAX_FILE = 256 * 1024
MAX_TOTAL = 12 * 1024 * 1024


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
    for key in ('developer_directory', 'xcode', 'sdk', 'os_version', 'os_build'):
        if actual.get(key) != expected.get(key):
            raise RuntimeError(f'{key} drift: expected {expected.get(key)!r}, got {actual.get(key)!r}; requalify explicitly')
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


def export_evidence(raw, output, replacements):
    """Export only our fixture files, never arbitrary HOME or process listings."""
    output.mkdir(parents=True, exist_ok=True)
    total = 0
    manifest = []
    for source in sorted(raw.rglob('*')):
        if any(part.endswith(('.app', '.xcresult')) for part in source.relative_to(raw).parts):
            continue
        if source.is_symlink() or not source.is_file():
            continue
        if source.suffix not in ('.log', '.json', '.png', '.ips', '.crash'):
            continue
        size = source.stat().st_size
        limit = 2 * 1024 * 1024 if source.suffix == '.png' else MAX_FILE
        if source.suffix == '.png' and size > limit:
            raise RuntimeError(f'Image exceeds evidence limit: {source.name}')
        with source.open('rb') as stream:
            data = stream.read(limit)
        if source.suffix != '.png':
            text = data.decode('utf-8', errors='replace')
            for original, replacement in replacements:
                if original:
                    text = text.replace(original, replacement)
            data = text.encode()
        total += len(data)
        if total > MAX_TOTAL:
            raise RuntimeError('Fixture evidence exceeds total upload limit')
        target = output / source.relative_to(raw)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        manifest.append({'file': str(source.relative_to(raw)), 'bytes': len(data), 'truncated': size > limit})
    (output / 'export.json').write_text(json.dumps(manifest, indent=2) + '\n')


def redact_values():
    values = [(os.environ.get('HOME', ''), '<runner-home>'),
              (str(Path.cwd()), '<checkout>'), ('must-not-reach-engine', '<fixture-key>')]
    # Only exact secret values are masked; do not export the environment itself.
    for key, value in os.environ.items():
        if any(word in key.upper() for word in ('TOKEN', 'PASSWORD', 'SECRET', 'API_KEY')) and len(value) >= 8:
            values.append((value, '<redacted>'))
    return sorted(values, key=lambda row: len(row[0]), reverse=True)
