"""Ordinary-app admission: declarations, console policy and read-only P owner.

Only inspect_normal_package invokes the nominated product's read-only Python
inventory validator. Nothing launches app/engine code or accesses profiles.
"""
import json
from pathlib import Path
import posixpath
import re
import subprocess
import sys
from urllib.parse import urlsplit

SCHEMA = 'nac342-startup-xctest-v1'
CASES = ('onboarding', 'configuredLocal', 'invalidConfig', 'futureStore')
BASELINE = 'ec4f3a9a8ab2e80d98ff76ca8c536e1e41b413c8'
TEST_ID = 'StartupJourneys/testOrdinaryStartup'
FUTURE_FAILURE_CODE = 'store_schema_incompatible'
FUTURE_FAILURE_STAGE = 'startup'
FUTURE_RECOVERY_MESSAGE = (
    'The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible version of NAC. '
    'Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected.'
)
ENVIRONMENT = {'HOME', 'NAC_HOME', 'PATH', 'LANG', 'NAC_TELEMETRY',
               'NAC_ORCHESTRATION', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL',
               'BROWSER', 'MODELS_DEV_URL'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def require_future_recovery(failure, visible_message):
    """Assert356's nominated typed v1 record and unique shell-owned message.

    Caller must independently bind authentic producer/UI observations to the
    exact candidate. This never classifies logs, observes a process, or proves
    source inclusion, profile integrity, no activation, cleanup, or paint.
    """
    require(failure.get('kind') == 'failed' and type(failure.get('version')) is int
            and failure['version'] == 1 and failure.get('code') == FUTURE_FAILURE_CODE
            and failure.get('stage') == FUTURE_FAILURE_STAGE,
            'Missing nominated serving-startup typed future-schema failure')
    require(visible_message == FUTURE_RECOVERY_MESSAGE,
            'Missing exact unique future-schema recovery message')


def path(value):
    require(isinstance(value, str) and value.startswith('/') and len(value) <= 4096
            and not any(ord(c) < 32 or ord(c) == 127 for c in value)
            and posixpath.normpath(value) == value, 'Noncanonical absolute path')
    return value


def child(value, parent):
    value, parent = path(value), path(parent)
    require(value.startswith(parent + '/'), 'Path escapes owned fixture root')
    return value


def hexadecimal(value, width):
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{' + str(width) + '}', value),
            'Invalid immutable digest')


def _declarations(config, receipt):
    """Validate declarations only; returned scope never means runtime passed."""
    require(config.get('schema') == SCHEMA and config.get('scenario') in CASES,
            'Unexpected startup contract')
    require(config.get('contract_baseline') == BASELINE, 'Acceptance baseline changed')
    for key, width in [('source_sha', 40), ('native_sha256', 64), ('engine_sha256', 64),
                       ('info_plist_sha256', 64), ('build_receipt_sha256', 64),
                       ('startup_source_sha256', 64)]:
        hexadecimal(config.get(key), width)
    root = path(config['fixture_root'])
    require(posixpath.basename(root).startswith('nac342-xctest-'), 'Unowned fixture root')
    app = child(config['app_path'], root)
    require(app.endswith('/Moved app folder with spaces/NAC.app'), 'Unexpected ordinary bundle')
    home = child(config['home'], root)
    nac = child(config['nac_home'], home)
    child(config['workspace'], root)
    child(config['expected_store'], nac)
    environment = config['environment']
    require(isinstance(environment, dict) and set(environment) == ENVIRONMENT,
            'Launch environment must be the exact fixture allowlist')
    require(all(isinstance(value, str) and '\0' not in value and len(value) <= 4096
                for value in environment.values()), 'Invalid fixture environment')
    require(environment['HOME'] == home and environment['NAC_HOME'] == nac
            and environment['NAC_ORCHESTRATION'] == '0'
            and environment['NAC_TELEMETRY'] == 'disabled'
            and environment['GIT_CONFIG_NOSYSTEM'] == '1'
            and environment['GIT_CONFIG_GLOBAL'] == '/dev/null'
            and environment['BROWSER'] == 'none'
            and environment['PATH'] == '/usr/bin:/bin:/usr/sbin:/sbin'
            and environment['LANG'] == 'en_US.UTF-8', 'Fixture isolation differs')
    catalog = urlsplit(environment['MODELS_DEV_URL'])
    require(catalog.scheme == 'http' and catalog.hostname == '127.0.0.1'
            and catalog.port is not None and catalog.port > 0 and not catalog.username
            and not catalog.password and not catalog.query and not catalog.fragment
            and catalog.path == '/models-dev', 'Catalog must be the owned loopback fixture')
    require(receipt.get('source_head') == config['source_sha']
            and receipt.get('source_dirty') is False
            and receipt.get('engine_identity', {}).get('source_revision') == config['source_sha']
            and receipt.get('mode') == 'app-build'
            and receipt.get('normal_startup') is True
            and receipt.get('preview_definitions_excluded') is True
            and receipt.get('smoke_instrumentation') is False,
            'Candidate is not a clean ordinary LOCAL_APP build')
    flags = receipt.get('compiler_flags', [])
    definitions = [flags[index + 1] for index, flag in enumerate(flags[:-1]) if flag == '-D']
    require(definitions == ['LOCAL_APP'] and flags[-1:] != ['-D'], 'Unexpected compilation flags')
    require(config.get('bundle_id') in ('ai.arcee.nac.local-development', 'ai.arcee.nac.dev')
            and receipt.get('bundle_identifier', config.get('bundle_id')) == config.get('bundle_id'),
            'Unexpected development bundle identity')
    # Instance instrumentation is absent in ec4; successors must explicitly
    # remain ordinary if the additional field exists.
    require(receipt.get('instance_smoke_instrumentation', False) is False,
            'Instance smoke cannot qualify ordinary paint')
    if 'ax_witness' in config:
        witness = config['ax_witness']
        require(config['scenario'] == 'configuredLocal' and type(witness) is dict
            and set(witness) == {'path', 'nonce', 'helper_path', 'helper_sha256', 'support_sha256', 'owner_pid', 'deadline_ns'},
            'Invalid external AX declaration')
        require(path(witness['path']) == root + '/ax-witness/receipt.json'
            and type(witness['owner_pid']) is int and 0 < witness['owner_pid'] < 2**31
            and type(witness['deadline_ns']) is str and re.fullmatch('[1-9][0-9]*', witness['deadline_ns'])
            and 0 < int(witness['deadline_ns']) < 2**64, 'Invalid external AX owner/deadline')
        path(witness['helper_path'])
        for key in ('nonce', 'helper_sha256'):
            hexadecimal(witness[key], 64)
        require(type(witness['support_sha256']) is dict and set(witness['support_sha256']) == {'StartupAXGuard.swift', 'StartupAXReceipt.swift'}, 'AX source inventory differs')
        for value in witness['support_sha256'].values():
            hexadecimal(value, 64)
    return {'scope': 'declaration_admission_only', 'scenario': config['scenario'],
            'actual_ui_run': False, 'paint_qualified': False}


def validate(config, receipt):
    """Legacy unsigned declarations only; never use on a signed package."""
    result = _declarations(config, receipt)
    require(all(receipt.get(key) == config[key] for key in
                ('native_sha256', 'engine_sha256', 'info_plist_sha256')),
            'Declared unsigned bundle hashes differ')
    return result


def require_console(root, uid, quartz):
    """H require_console semantics, retaining Q's unique matching UID guard."""
    sessions = [row for row in root.get('IOConsoleUsers', [])
                if row.get('kCGSSessionUserIDKey') == uid
                and row.get('kCGSSessionOnConsoleKey') is True]
    require(len(sessions) == 1 and sessions[0].get('kCGSessionLoginDoneKey') is True,
            'GUI unavailable: unique logged-in console user missing')
    session = sessions[0]
    flags = (session.get('CGSSessionScreenIsLocked'), quartz.get('screen_is_locked'))
    require(root.get('IOConsoleLocked') is False
            and quartz.get('quartz_session_available') is True
            and quartz.get('on_console') is True and quartz.get('login_done') is True
            and type(quartz.get('screen_count')) is int and quartz['screen_count'] >= 1
            and isinstance(quartz.get('frontmost_bundle'), str)
            and quartz['frontmost_bundle'] not in ('', 'unavailable', 'com.apple.loginwindow')
            and all(flag is None or flag is False for flag in flags),
            'GUI unavailable: positive observations missing, locked or malformed')
    return {'on_console': True, 'login_done': True, 'root_locked': False,
            'session_lock_flag': flags[0], 'quartz_lock_flag': flags[1],
            'rendered_app_qualification_required': True}


# Isolate P's imports from H/Q module namespaces; -B prevents writes to P.
# This calls inventory/post-sign validation only, never package.main, signing,
# native compilation, __desktop-identity or any app/engine executable.
_OWNER_INSPECTION = r'''
import hashlib, json, plistlib, sys
from pathlib import Path
root, expected, manifest_path, relocated = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4])
sys.path.insert(0, str(root / 'desktop/macos/packaging'))
from package import verify_files
from provenance import clean_source, digest, inventory, object_digest
from native_receipt import NORMAL_SOURCES, BUILD_SUPPORT, NORMAL_FLAGS, FIXTURE_MARKERS, expected_identity
def need(valid, message):
    if not valid: raise ValueError(message)
source = clean_source(root)
need(source['revision'] == expected, 'Wrong clean product source')
manifest = json.loads(manifest_path.read_bytes())
need(manifest.get('post_sign_receipt', {}).get('phase') == 'ad-hoc-preparation', 'Explicit post-sign phase required')
verify_files(manifest, manifest_path.parent)
files = inventory(relocated)
need(files == manifest['bundle']['files'], 'Relocated full inventory differs')
marker = json.loads((relocated / 'Contents/Resources/PackageIdentity.json').read_bytes())
receipt = json.loads((relocated / 'Contents/Resources/build-receipt.json').read_bytes())
engine = json.loads((relocated / 'Contents/Resources/engine-identity.json').read_bytes())
info = plistlib.loads((relocated / 'Contents/Info.plist').read_bytes())
need(marker == manifest['identity'] and marker.get('schema_version') == 1
     and marker.get('purpose') == 'normal-app-preparation' and marker.get('consumer_distribution') is False
     and marker.get('source') == source, 'Foreign product PackageIdentity')
need(marker.get('native_build_receipt') == receipt, 'Embedded unsigned receipt differs from sealed native_build_receipt')
need(receipt.get('version') == 1 and receipt.get('phase') == 'unsigned-build'
     and receipt.get('source_head') == expected and receipt.get('source_dirty') is False
     and receipt.get('mode') == 'app-build' and receipt.get('normal_startup') is True
     and receipt.get('smoke_instrumentation') is False and receipt.get('instance_smoke_instrumentation') is False
     and receipt.get('preview_definitions_excluded') is True and receipt.get('compiler_flags') == NORMAL_FLAGS,
     'Unsigned compiler/source/mode provenance differs')
need(receipt.get('fixture_markers_absent') == FIXTURE_MARKERS and bool(receipt.get('sdk_version'))
     and not any(value.encode() in (relocated / 'Contents/MacOS/NACPreview').read_bytes() for value in FIXTURE_MARKERS),
     'Missing fixture exclusion or SDK provenance')
for key, roster in [('native_source_files', NORMAL_SOURCES), ('build_support_files', BUILD_SUPPORT)]:
    need(set(receipt.get(key, {})) == roster, 'Product compiler/support roster differs')
    for name, value in receipt[key].items():
        need(not (root / name).is_symlink() and digest(root / name) == value, 'Product source input differs')
identity = expected_identity(source, marker['build'])
need(set(engine) == {'product_version', 'source_revision', 'track', 'build_id'}
     and engine == identity == receipt.get('engine_identity') == marker.get('engine_identity')
     and identity['track'] == 'dev' and identity['build_id'] == 'dev-' + expected,
     'Full product engine identity differs')
need(info.get('CFBundleIdentifier') == receipt.get('bundle_identifier') == manifest['bundle']['identifier'] == 'ai.arcee.nac.dev'
     and info.get('CFBundleName') == receipt.get('bundle_name'), 'Track bundle identity differs')
need(receipt.get('engine_sha256') == marker.get('engine_input', {}).get('sha256'), 'Unsigned engine input differs')
post = manifest['post_sign_receipt']
need(post.get('source_revision') == expected and post.get('engine_identity') == identity, 'Post-sign source identity differs')
print(json.dumps({'source_sha': expected, 'engine_identity': identity, 'bundle_id': info['CFBundleIdentifier'],
 'manifest_sha256': digest(manifest_path), 'package_identity_sha256': digest(relocated / 'Contents/Resources/PackageIdentity.json'),
 'engine_identity_sha256': digest(relocated / 'Contents/Resources/engine-identity.json'),
 'build_receipt_sha256': digest(relocated / 'Contents/Resources/build-receipt.json'),
 'inventory_sha256': object_digest(files), 'unsigned_receipt': receipt,
 'post_sign_receipt': post, 'manifest_phase': post['phase']}))
'''


def inspect_normal_package(manifest_path, relocated_app, product_root, *, product_sha):
    """Read-only full owner inventory/post-sign admission; no profile/UI access.

    product_root is the explicitly nominated clean same-repository P input,
    never an arbitrary external dependency. No signature authenticity claim.
    """
    hexadecimal(product_sha, 40)
    product_root = Path(path(str(product_root)))
    require(product_root.resolve() == product_root, 'Noncanonical product checkout')
    top = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=product_root, text=True).strip()
    require(Path(top).resolve() == product_root, 'Product root must be the exact checkout root')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=product_root, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=product_root, text=True)
    require(actual == product_sha and not dirty, 'Product checkout must be exact and clean')
    owner = product_root / 'desktop/macos/packaging/package.py'
    committed = subprocess.check_output(['git', 'show', product_sha + ':desktop/macos/packaging/package.py'], cwd=product_root)
    require(not owner.is_symlink() and owner.read_bytes() == committed, 'Foreign product owner')
    inputs = [Path(path(str(value))) for value in (manifest_path, relocated_app)]
    require(all(value.resolve(strict=True) == value and not value.is_symlink() for value in inputs),
            'Package paths must be canonical and not symlinked')
    result = subprocess.run([sys.executable, '-B', '-c', _OWNER_INSPECTION, str(product_root), product_sha,
                             *(str(value) for value in inputs)],
                            capture_output=True, timeout=60)
    require(result.returncode == 0, 'Product owner rejected package: ' + result.stderr[-2048:].decode(errors='replace'))
    require(len(result.stdout) <= 256 * 1024, 'Owner admission proof exceeds bound')
    return json.loads(result.stdout)


def validate_normal_package(config, manifest_path, product_root, *, product_sha, test_sha, harness_sha):
    """Admit final normal bytes while retaining the original unsigned receipt."""
    for value in (product_sha, test_sha, harness_sha):
        hexadecimal(value, 40)
    require(config.get('source_sha') == product_sha and config.get('test_source_sha') == test_sha
            and config.get('harness_sha') == harness_sha, 'P/Q/H source binding differs')
    proof = inspect_normal_package(manifest_path, config['app_path'], product_root, product_sha=product_sha)
    result = _declarations(config, proof['unsigned_receipt'])
    for key in ('manifest_sha256', 'package_identity_sha256', 'engine_identity_sha256', 'build_receipt_sha256'):
        hexadecimal(config.get(key), 64)
        require(config[key] == proof[key], 'Distinct package provenance hash differs: ' + key)
    require(config.get('engine_identity') == proof['engine_identity'], 'Full configured engine identity differs')
    require(all(config[key] == proof['post_sign_receipt'][key] for key in
                ('native_sha256', 'engine_sha256', 'info_plist_sha256')),
            'Runtime hashes must match explicit post-sign fields')
    return {**result, 'scope': 'normal_package_admission_only', 'P': product_sha,
            'Q': test_sha, 'H': harness_sha, 'provenance': proof}
