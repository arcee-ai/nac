"""Strict admission of canonical lifecycle-build output, separate from normal."""
import json
import plistlib

from native_receipt import (BUILD_SUPPORT, ENGINE, ENGINE_IDENTITY, NORMAL_FLAGS,
                            NORMAL_SOURCES, RECEIPT, SHELL, expected_identity)
from provenance import digest, inventory, run

LIFECYCLE_SOURCES = NORMAL_SOURCES | {'desktop/macos/LifecycleSmoke.swift',
                                    'desktop/macos/RecoverySmoke.swift'}
LIFECYCLE_FLAGS = NORMAL_FLAGS + ['-D', 'PREVIEW_SMOKE', '-D', 'LIFECYCLE_SMOKE']
OBSERVER_SOURCE = 'desktop/macos/InstanceObservation.swift'
OBSERVER_FLAGS = ['-parse-as-library', '-swift-version', '5', '-target',
                  'arm64-apple-macosx14.0', '-O', '-framework', 'AppKit']
UNSIGNED_FILES = {'Contents/Info.plist', SHELL, ENGINE, RECEIPT, ENGINE_IDENTITY}


def validate_lifecycle_receipt(app, source, engine_receipt, observed_identity, source_root):
    files = inventory(app)
    if set(files) != UNSIGNED_FILES:
        raise ValueError('Lifecycle builder requires its closed five-file unsigned layout')
    receipt = json.loads((app / RECEIPT).read_text())
    expected = dict(version=1, phase='unsigned-build', mode='lifecycle-build',
                    normal_startup=True, smoke_instrumentation=True,
                    instance_smoke_instrumentation=False, lifecycle_smoke_instrumentation=True,
                    attention_smoke_instrumentation=False, source_dirty=False,
                    preview_definitions_excluded=True)
    for key, value in expected.items():
        if type(receipt.get(key)) is not type(value) or receipt[key] != value:
            raise ValueError('Canonical lifecycle instrumentation/receipt mode required')
    if 'fixture_markers_absent' in receipt:
        raise ValueError('Lifecycle fixture cannot claim ordinary fixture exclusion')
    if receipt.get('source_head') != source['revision']:
        raise ValueError('Lifecycle receipt belongs to another source')
    if receipt.get('compiler_flags') != LIFECYCLE_FLAGS:
        raise ValueError('Lifecycle compiler flags differ from canonical builder')
    for field, names in [('native_source_files', LIFECYCLE_SOURCES),
                         ('build_support_files', BUILD_SUPPORT)]:
        rows = receipt.get(field, {})
        if set(rows) != names:
            raise ValueError('Lifecycle compiler/source support roster differs')
        for name, expected_hash in rows.items():
            path = source_root / name
            if path.is_symlink() or digest(path) != expected_hash:
                raise ValueError('Lifecycle source/support hash mismatch')
    identity = expected_identity(source, engine_receipt['build'])
    if (receipt.get('engine_identity') != identity or observed_identity != identity
            or json.loads((app / ENGINE_IDENTITY).read_text()) != identity):
        raise ValueError('Lifecycle engine identity mismatch')
    metadata = run('/bin/bash', source_root / 'desktop/macos/BundleIdentity.sh',
                   app / ENGINE_IDENTITY, 'instance-smoke', cwd=source_root).splitlines()
    if len(metadata) != 2:
        raise ValueError('Invalid lifecycle track factory output')
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if (receipt.get('bundle_identifier') != metadata[0] + '.lifecycle'
            or info.get('CFBundleIdentifier') != metadata[0] + '.lifecycle'
            or receipt.get('bundle_name') != metadata[1]
            or info.get('CFBundleName') != metadata[1]):
        raise ValueError('Lifecycle bundle metadata differs from canonical factory')
    if digest(app / ENGINE) != engine_receipt['engine']['sha256']:
        raise ValueError('Lifecycle builder used another private engine')
    for field, name in [('engine_sha256', ENGINE), ('native_sha256', SHELL),
                        ('info_plist_sha256', 'Contents/Info.plist')]:
        if receipt.get(field) != files[name]['sha256']:
            raise ValueError('Lifecycle unsigned output digest mismatch')
    if not receipt.get('sdk_version'):
        raise ValueError('Missing lifecycle SDK identity')
    return receipt
