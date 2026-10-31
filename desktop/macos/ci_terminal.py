"""Exact-source, fixed-operation public XCTest terminal qualification."""
import hashlib
import json
import os
from pathlib import Path
import shutil

from ci_qualifications import require_checkout
from ci_xctest import run_terminal

CONTRACT = Path(__file__).with_name('ci-terminal-operations.json')
NAMES = ('unicode', 'interrupt-arm', 'interrupt', 'recovery', 'resize', 'size-readback')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_contract(contract, target, source):
    phases = contract.get('phases', [])
    if (contract.get('schema') != 1 or contract.get('scenario') != 'terminal-xctest'
            or contract.get('terminal_source_head') != target['source_sha']
            or contract.get('total_seconds_limit') != 240 or target.get('phase_count') != 6 or target.get('scenario_count') != 1
            or tuple(phase.get('name') for phase in phases) != NAMES
            or set(contract.get('source_files', {})) != {'desktop/macos/TerminalFixture.swift',
                'desktop/macos/TerminalJourneys.swift', 'desktop/macos/TerminalSmoke.swift', 'desktop/macos/terminal/xctest.md'}):
        raise RuntimeError('Terminal fixed-operation/source contract differs')
    for sequence, phase in enumerate(phases, 1):
        operation = phase['operation']
        if (phase.get('sequence') != sequence
                or phase.get('seconds_limit') != (10 if sequence == 3 else 60)):
            raise RuntimeError('Terminal phase sequence/deadline differs')
        if sequence == 3:
            valid = operation == {'kind': 'key', 'key': 'c', 'modifiers': ['control']}
            count = 1
        elif sequence == 5:
            valid = operation == {'kind': 'resize-window', 'width_delta': -160, 'height_delta': -80}
            count = 0
        else:
            valid = (set(operation) == {'kind', 'text'} and operation['kind'] == 'type-text-and-return'
                     and isinstance(operation['text'], str) and '\n' not in operation['text'])
            count = len(operation.get('text', '').encode()) + 1
        if not valid or phase.get('expected_input_bytes') != count:
            raise RuntimeError('Terminal operation/byte count differs')
    for name, expected in contract['source_files'].items():
        file = source / name
        if file.is_symlink() or not file.is_file() or digest(file) != expected:
            raise RuntimeError('Nominated terminal fixture source differs: ' + name)
    return contract


def require_episode(record, contract, assets):
    identity = record.get('terminal_xctest_identity', {})
    phases = record.get('terminal_xctest_phases', [])
    if (record.get('scenario') != contract['scenario'] or record.get('error') is not None
            or any(record.get(key) is not True for key in ('passed', 'engine_reaped', 'profile_removed'))
            or identity.get('schema') != 1 or identity.get('unfocused_guard_rejected') is not True
            or identity.get('total_seconds_limit') != 240 or identity.get('app_pid') != record.get('app_pid')
            or not isinstance(identity.get('app_launch_epoch'), (int, float)) or identity['app_launch_epoch'] <= 0
            or any(type(identity.get(key)) is not int or identity[key] <= 0
                   for key in ('app_pid', 'engine_pid', 'target_window_number'))
            or any(not isinstance(identity.get(key), str) or not identity[key]
                   for key in ('session_id', 'terminal_id', 'controller_revision', 'bundle_path'))
            or identity.get('session_id') != record.get('session_id')
            or identity.get('terminal_id') != record.get('terminal_id') or len(phases) != 6
            or record.get('terminal_xctest_phase') != {'schema': 1, 'sequence': 6, 'state': 'finished'}):
        raise RuntimeError('Terminal episode identity/completion/cleanup incomplete')
    for phase, expected in zip(phases, contract['phases']):
        proof = phase.get('proof', {})
        count = expected['expected_input_bytes']
        if (phase.get('schema') != 1 or phase.get('state') != 'verified'
                or any(phase.get(key) != expected[key] for key in ('sequence', 'name', 'operation', 'seconds_limit'))
                or any(phase.get(key) != identity[key] for key in ('app_pid', 'target_window_number', 'session_id', 'terminal_id'))
                or type(proof.get('input_bytes')) is not int or proof['input_bytes'] != count or proof.get('synthetic_events') != 0
                or proof.get('terminal_alive') is not True or proof.get('controller_revision') != identity['controller_revision']
                or type(proof.get('elapsed_ms')) is not int or not 0 <= proof['elapsed_ms'] <= expected['seconds_limit'] * 1000
                or type(proof.get('input_posts')) is not int or proof['input_posts'] != proof.get('written_receipts')
                or (proof['input_posts'] <= 0 if count else proof['input_posts'] != 0)
                or type(proof.get('trusted_keydowns')) is not int
                or (proof['trusted_keydowns'] <= 0 if count else proof['trusted_keydowns'] != 0)):
            raise RuntimeError('Terminal phase independent byte/provenance proof incomplete: ' + expected['name'])
    for name in ('trusted-mac-keyboard-unicode', 'xctest-ctrl-c-recovery', 'resize-pty-readback'):
        if record.get('checks', {}).get(name, {}).get('status') != 'pass':
            raise RuntimeError('Terminal required named check incomplete: ' + name)
    served = record.get('embedded_assets', [])
    if (not served or any(asset.get('sha256') != assets.get(asset.get('path')) for asset in served)
            or not any(asset.get('path', '').endswith('.js') for asset in served)
            or not any(asset.get('path', '').endswith('.css') for asset in served)):
        raise RuntimeError('Terminal served production assets differ from exact source')
    for name in ('xctest-unicode', 'xctest-completed'):
        paint = record.get('paint_' + name, {})
        if any(paint.get(key) is not True for key in ('animation_frame', 'occlusion_visible', 'visible_acceptance')):
            raise RuntimeError('Terminal post-input frame unavailable: ' + name)
    return {'phases': phases, 'named_checks': ['trusted-mac-keyboard-unicode', 'xctest-ctrl-c-recovery', 'resize-pty-readback'],
            'full_terminal_acceptance': False, 'visible_paint_acceptance': 'raw images require independent review',
            'scope': 'One public XCTest Unicode/control/resize episode; no physical keyboard, IME, paste or full job-control claim'}


def require_dispatches(rows, contract):
    if len(rows) != len(contract['phases']):
        raise RuntimeError('XCTest did not retain exactly six one-time dispatch observations')
    for row, expected in zip(rows, contract['phases']):
        if (row.get('state') != 'dispatched-once' or any(row.get(key) != value for key, value in expected.items())
                or type(row.get('elapsed_ms')) is not int or not 0 <= row['elapsed_ms'] <= expected['seconds_limit'] * 1000):
            raise RuntimeError('XCTest dispatch sequence/literal/completion differs')
    return rows


def qualify(raw, source, target, run, command, native_report, cleanup):
    require_checkout(source, target['source_sha'])
    contract = require_contract(json.loads(CONTRACT.read_text()), target, source)
    (raw / 'terminal-operations.json').write_text(json.dumps(contract, indent=2) + '\n')
    run(['cargo', 'build', '--locked', '-p', 'nac-server', '--bin', 'nac-web'], raw / 'terminal-engine-build.log', 900, cwd=source)
    cargo_target = Path(os.environ.get('CARGO_TARGET_DIR', source / 'target'))
    if not cargo_target.is_absolute():
        cargo_target = source / cargo_target
    engine = raw / 'private-engine/nac-web'
    engine.parent.mkdir()
    shutil.copy2(cargo_target / 'debug/nac-web', engine)
    os.environ.update(NAC_MAC_ENGINE=str(engine), NAC_MAC_SKIP_ENGINE_BUILD='1')
    run(['bash', 'desktop/macos/terminal.sh'], raw / 'terminal-build.log', 180, cwd=source)
    app = raw / 'NAC Development Preview.app'
    build = json.loads((app / 'Contents/Resources/terminal-build.json').read_text())
    expected = {'source_head': target['source_sha'], 'source_status': '', 'engine_sha256': digest(engine),
                'native_sha256': digest(app / 'Contents/MacOS/NACPreview'),
                'normal_sha256': digest(raw / 'normal-preview'), 'ordinary_smoke_sha256': digest(raw / 'ordinary-smoke'),
                'compile_flags': ['PREVIEW_SMOKE', 'TERMINAL_SMOKE']}
    if any(build.get(key) != value for key, value in expected.items()) or target['source_sha'][:12] not in build.get('engine_version', ''):
        raise RuntimeError('Terminal build source/identity/flags differ')
    for name, value in build['native_sources'].items():
        if digest(source / name) != value:
            raise RuntimeError('Terminal native build source differs: ' + name)
    (raw / 'terminal-build.json').write_text(json.dumps(build, indent=2) + '\n')
    assets = {'/assets/dist/' + str(file.relative_to(source / 'crates/nac-server/assets/dist')): digest(file)
              for file in (source / 'crates/nac-server/assets/dist').rglob('*') if file.is_file()}
    if build.get('asset_files') != assets:
        raise RuntimeError('Terminal build assets differ from target source')
    result = run_terminal(raw, run, command, app_name=app.name, scenario=contract['scenario'],
                          test_name='testTerminalUnicodeControlResize', operations=contract['phases'],
                          validate=lambda record: require_episode(record, contract, assets), cleanup=cleanup)
    dispatches = require_dispatches(json.loads((raw / 'xctest-driver.json').read_text()), contract)
    helper = raw / 'native-image-reader'
    run(['xcrun', 'swiftc', '-swift-version', '5', 'desktop/macos/CIEvidence.swift', '-o', str(helper)],
        raw / 'terminal-image-reader-build.log', 90)
    images = []
    for mode in ('unicode', 'completed'):
        image = raw / 'evidence' / ('terminal-xctest-xctest-' + mode + '.png')
        if image.is_symlink() or not image.is_file():
            raise RuntimeError('Terminal input image missing or redirected')
        observed = native_report([str(helper), '--terminal-' + mode, str(image)], raw / ('terminal-' + mode + '-image-reader.log'))
        images.append({'path': str(image.relative_to(raw)), 'sha256': digest(image), 'observation': observed})
    require_checkout(source, target['source_sha'])
    return {'xctest': result, 'terminal_build': build, 'terminal_images': images,
            'terminal_dispatches': dispatches, 'terminal_operations_sha256': digest(CONTRACT),
            'terminal_driver_receipt_sha256': digest(raw / 'xctest-driver.json')}
