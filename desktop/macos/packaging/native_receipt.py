"""Admission of the sole native builder's nominated unsigned normal app output."""
import json
import plistlib

from provenance import digest, inventory, run

ENGINE = 'Contents/Resources/nac-web'
SHELL = 'Contents/MacOS/NACPreview'
RECEIPT = 'Contents/Resources/build-receipt.json'
ENGINE_IDENTITY = 'Contents/Resources/engine-identity.json'

# ALL-343's exact normal compiler contract, nominated at 9f215ec9. This is an
# admission policy, not another compiler/source-selection writer. New native
# suppliers must explicitly extend it with their qualified normal source set.
NORMAL_SOURCES = {
    f'desktop/macos/{name}.swift' for name in (
        'main', 'PreviewApp', 'PreviewEngine', 'EngineProtocol',
        'CommandEnvironment', 'DesktopStartup', 'EngineFailure', 'AppInstance', 'StoreConflict')
}
BUILD_SUPPORT = {'desktop/macos/preview.sh', 'desktop/macos/BundleIdentity.sh',
                 'desktop/macos/build_receipt.py'}
NORMAL_FLAGS = ['-swift-version', '5', '-target', 'arm64-apple-macosx14.0', '-O',
                '-framework', 'AppKit', '-framework', 'WebKit', '-D', 'LOCAL_APP']
FIXTURE_MARKERS = ['preview-dummy-only', 'nac-mac-preview-', 'FixtureProvider', 'FixtureBootstrap']


def expected_identity(source, build):
    return {'product_version': source['product_version'], 'source_revision': source['revision'],
            'track': build['track'], 'build_id': build['id']}


def validate_native_receipt(app, source, engine_receipt, observed_identity, source_root):
    """Validate actual bytes and compiler inputs; never turn this into readiness."""
    files = inventory(app)
    if set(files) != {'Contents/Info.plist', SHELL, ENGINE, RECEIPT, ENGINE_IDENTITY}:
        raise ValueError('Unexpected native builder output; normal bundle must have the nominated closed layout')
    receipt = json.loads((app / RECEIPT).read_text())
    if (receipt.get('version') != 1 or receipt.get('phase') != 'unsigned-build'
            or receipt.get('mode') != 'app-build' or receipt.get('normal_startup') is not True
            or receipt.get('smoke_instrumentation') is not False
            or receipt.get('instance_smoke_instrumentation') is not False
            or receipt.get('source_dirty') is not False
            or receipt.get('preview_definitions_excluded') is not True):
        raise ValueError('A clean ordinary normal-app producer receipt is required')
    if receipt.get('source_head') != source['revision']:
        raise ValueError('Native receipt belongs to a different source revision')
    if receipt.get('compiler_flags') != NORMAL_FLAGS:
        raise ValueError('Normal compiler flags differ from the nominated noninstrumented contract')
    inputs = receipt.get('native_source_files', {})
    if set(inputs) != NORMAL_SOURCES:
        raise ValueError('Normal compiler source list differs from the nominated fixture-free contract')
    for name, expected in inputs.items():
        path = source_root / name
        if path.is_symlink() or digest(path) != expected:
            raise ValueError('Native compiler source hash differs from clean checkout')
    support = receipt.get('build_support_files', {})
    if set(support) != BUILD_SUPPORT:
        raise ValueError('Native build support differs from the nominated producer contract')
    for name, expected in support.items():
        path = source_root / name
        if path.is_symlink() or digest(path) != expected:
            raise ValueError('Native build support hash differs from clean checkout')
    identity = expected_identity(source, engine_receipt['build'])
    embedded = json.loads((app / ENGINE_IDENTITY).read_text())
    if receipt.get('engine_identity') != identity or embedded != identity or observed_identity != identity:
        raise ValueError('Bundled engine identity does not match native receipt/source/build')
    # Reuse the nominated producer's single read-only track factory. Do not
    # introduce a second stable/beta/dev mapping in packaging or read ambient track.
    metadata = run('/bin/bash', source_root / 'desktop/macos/BundleIdentity.sh',
                   app / ENGINE_IDENTITY, 'normal', cwd=source_root).splitlines()
    if len(metadata) != 2:
        raise ValueError('Invalid bundle identity factory output')
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if (receipt.get('bundle_identifier') != metadata[0] or receipt.get('bundle_name') != metadata[1]
            or info.get('CFBundleIdentifier') != metadata[0] or info.get('CFBundleName') != metadata[1]):
        raise ValueError('Normal bundle metadata differs from the bundled-engine track factory')
    if digest(app / ENGINE) != engine_receipt['engine']['sha256']:
        raise ValueError('Native builder used a different private engine')
    for key, name in [('engine_sha256', ENGINE), ('native_sha256', SHELL),
                      ('info_plist_sha256', 'Contents/Info.plist')]:
        if receipt.get(key) != files[name]['sha256']:
            raise ValueError('Unsigned native output digest differs from producer receipt')
    if receipt.get('fixture_markers_absent') != FIXTURE_MARKERS:
        raise ValueError('Missing producer fixture-exclusion proof')
    binary = (app / SHELL).read_bytes()
    if any(marker.encode() in binary for marker in FIXTURE_MARKERS):
        raise ValueError('Normal binary contains a disposable preview marker')
    if not receipt.get('sdk_version'):
        raise ValueError('Missing producer SDK identity')
    return receipt
