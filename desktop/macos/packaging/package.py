#!/usr/bin/env python3
"""One outer Mac packaging owner; the existing native builder owns compilation."""
import argparse
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True

from provenance import (ROOT, clean_source, digest, inventory, new_directory,
                        object_digest, run, validate_receipt, write_json)

FIXTURE_APP = 'NAC Development Preview.app'
FIXTURE_ENGINE = 'Contents/Resources/nac-web'
FIXTURE_SHELL = 'Contents/MacOS/NACPreview'


def require_mac():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('Packaging requires actual Apple Silicon macOS')


def toolchain():
    return {'os': run('/usr/bin/sw_vers'), 'architecture': platform.machine(),
            'swift': run('/usr/bin/xcrun', 'swiftc', '--version'),
            'sdk': run('/usr/bin/xcrun', '--show-sdk-version'),
            'developer_directory': run('/usr/bin/xcode-select', '-p')}


def verify_version(engine, source):
    expected = f"nac-web {source['product_version']} ({source['revision'][:12]})"
    if run(engine, '--version') != expected:
        raise ValueError('Engine does not report the exact product version/source prefix')


def prepare_engine(args):
    require_mac()
    source = clean_source()
    output = new_directory(args.output)
    build = {'track': args.track, 'id': f"{args.track}-{source['revision']}"}
    env = dict(os.environ, NAC_BUILD_TRACK=build['track'], NAC_BUILD_ID=build['id'],
               NAC_SOURCE_REVISION=source['revision'], MACOSX_DEPLOYMENT_TARGET='14.0')
    subprocess.run(['cargo', 'build', '--release', '--locked', '-p', 'nac-server',
                    '--bin', 'nac-web', '--target', 'aarch64-apple-darwin'],
                   cwd=ROOT, env=env, check=True)
    target = Path(env.get('CARGO_TARGET_DIR', ROOT / 'target'))
    engine = output / 'nac-web'
    # Copy and hash while the caller still owns the Rust build lease.
    shutil.copy2(target / 'aarch64-apple-darwin/release/nac-web', engine)
    verify_version(engine, source)
    if clean_source() != source:
        raise ValueError('Source changed during engine compilation')
    receipt = {'schema_version': 1, 'source': source, 'build': build,
               'target': 'aarch64-apple-darwin', 'deployment_target': '14.0',
               'engine': {'sha256': digest(engine), 'size': engine.stat().st_size},
               'rustc': run('rustc', '-Vv'), 'toolchain': toolchain(),
               'identity_evidence': 'build environment plus --version; not runtime receipt qualification'}
    write_json(output / 'engine-build.json', receipt)
    print(output / 'engine-build.json')


def executable_evidence(path):
    if run('/usr/bin/lipo', '-archs', path) != 'arm64':
        raise ValueError(f'Expected arm64-only code: {path.name}')
    dependencies = run('/usr/bin/otool', '-L', path).splitlines()[1:]
    for line in dependencies:
        library = line.strip().split(' (', 1)[0]
        if not library.startswith(('/usr/lib/', '/System/Library/', '@rpath/libswift')):
            raise ValueError(f'Non-system runtime dependency in {path.name}: {library}')
    return {'architecture': 'arm64', 'dependencies': [x.strip() for x in dependencies],
            'build_commands': run('/usr/bin/vtool', '-show-build', path)}


def sign_adhoc(app, engine):
    # Leaf first, then outer bundle. Never --deep sign or borrow reference entitlements.
    for target in (app / engine, app):
        run('/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none',
            '--options', 'runtime', target)
    return verify_signatures(app, engine)


def verify_signatures(app, engine):
    results = {}
    for label, target in [('engine', app / engine), ('app', app)]:
        run('/usr/bin/codesign', '--verify', '--strict', '--verbose=2', target)
        result = subprocess.run(['/usr/bin/codesign', '-d', '--entitlements', ':-', str(target)],
                                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        entitlements = plistlib.loads(result.stdout) if result.stdout.strip() else {}
        if entitlements:
            raise ValueError(f'Unexpected entitlements on {label}: {sorted(entitlements)}')
        details = subprocess.run(['/usr/bin/codesign', '-d', '--verbose=4', str(target)],
                                 check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        fields = details.stderr
        if 'Signature=adhoc' not in fields or 'runtime' not in fields:
            raise ValueError('Expected ad-hoc hardened-runtime fixture signature')
        results[label] = {'kind': 'ad-hoc', 'hardened_runtime': True, 'entitlements': {}}
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', '--verbose=2', app)
    return results


def build_fixture(args):
    require_mac()
    source = clean_source()
    receipt_path = Path(args.engine_receipt).resolve(strict=True)
    receipt = json.loads(receipt_path.read_text())
    engine = receipt_path.parent / 'nac-web'
    validate_receipt(receipt, source, engine)
    verify_version(engine, source)
    output = new_directory(args.output)
    env = dict(os.environ, NAC_MAC_OUTPUT=str(output), NAC_MAC_ENGINE=str(engine),
               NAC_MAC_SKIP_ENGINE_BUILD='1')
    # Existing single native writer; build never launches the fixture or user stores.
    subprocess.run([str(ROOT / 'desktop/macos/preview.sh'), 'build'], cwd=ROOT, env=env, check=True)
    app = output / FIXTURE_APP
    if digest(app / FIXTURE_ENGINE) != receipt['engine']['sha256']:
        raise ValueError('Native builder consumed a different engine')
    executables = {name: executable_evidence(app / name)
                   for name in (FIXTURE_SHELL, FIXTURE_ENGINE)}
    plist_path = app / 'Contents/Info.plist'
    info = plistlib.loads(plist_path.read_bytes())
    if info['CFBundleIdentifier'] != 'ai.arcee.nac.development-preview':
        raise ValueError('Unexpected fixture bundle identity')
    info['CFBundleShortVersionString'] = source['product_version']
    info['CFBundleVersion'] = source['product_version']
    plist_path.write_bytes(plistlib.dumps(info, sort_keys=True))
    resources = app / 'Contents/Resources'
    shutil.copy2(ROOT / 'LICENSE', resources / 'LICENSE')
    shutil.copytree(ROOT / 'crates/nac-server/assets/dist/licenses', resources / 'licenses')
    identity = {'schema_version': 1, 'purpose': 'development-preview-fixture',
                'consumer_distribution': False, 'source': source, 'build': receipt['build'],
                'engine_input': receipt['engine'], 'native_builder': 'desktop/macos/preview.sh',
                'native_builder_sha256': digest(ROOT / 'desktop/macos/preview.sh'),
                'instrumentation': 'ordinary preview includes disposable profile/provider; PREVIEW_SMOKE absent',
                'minimum_os': {'declared': info['LSMinimumSystemVersion'], 'qualified': None},
                'toolchain': toolchain()}
    write_json(resources / 'PackageIdentity.json', identity)
    signatures = sign_adhoc(app, FIXTURE_ENGINE)
    if clean_source() != source:
        raise ValueError('Source changed during native build/package')
    container = output / 'NAC-development-preview-fixture-arm64.zip'
    run('/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, container)
    files = inventory(app)
    manifest = {'schema_version': 1, 'identity': identity, 'bundle': {
        'name': app.name, 'identifier': info['CFBundleIdentifier'], 'files': files,
        'sha256': object_digest(files), 'executables': executables},
        'container': {'name': container.name, 'sha256': digest(container), 'size': container.stat().st_size},
        'signatures': signatures, 'qualification': {'developer_id': False, 'notarized': False,
        'stapled': False, 'gatekeeper': False, 'quarantined_download': False,
        'applications_install': False, 'app_translocation': False, 'actual_app_runtime': False}}
    write_json(output / 'manifest.json', manifest)
    print(output / 'manifest.json')


def verify_files(manifest, directory):
    """Offline integrity check. A digest is not publisher authentication."""
    if manifest.get('schema_version') != 1:
        raise ValueError('Unsupported package manifest')
    bundle = manifest['bundle']
    container = manifest['container']
    for name in (bundle['name'], container['name']):
        if Path(name).name != name or name in ('', '.', '..'):
            raise ValueError('Manifest artifact name must be one path component')
    files = inventory(directory / bundle['name'])
    if files != bundle['files'] or object_digest(files) != bundle['sha256']:
        raise ValueError('Bundle inventory/digest mismatch')
    archive = directory / container['name']
    if archive.is_symlink() or digest(archive) != container['sha256'] or archive.stat().st_size != container['size']:
        raise ValueError('Container digest mismatch')
    embedded = json.loads((directory / bundle['name'] / 'Contents/Resources/PackageIdentity.json').read_text())
    if embedded != manifest['identity']:
        raise ValueError('Embedded identity differs from outer manifest')
    if embedded.get('consumer_distribution') is not False or any(manifest['qualification'].values()):
        raise ValueError('This fixture format cannot establish consumer/distribution qualification')


def verify(args):
    path = Path(args.manifest).resolve(strict=True)
    manifest = json.loads(path.read_text())
    verify_files(manifest, path.parent)
    if args.signatures:
        require_mac()
        verify_signatures(path.parent / manifest['bundle']['name'], FIXTURE_ENGINE)
    print('Fixture integrity verified; Developer ID/notary/Gatekeeper/runtime acceptance unavailable')



def relocate_check(args):
    require_mac()
    path = Path(args.manifest).resolve(strict=True)
    manifest = json.loads(path.read_text())
    verify_files(manifest, path.parent)
    output = new_directory(args.output)
    relocated = output / 'Relocated App With Spaces'
    relocated.mkdir()
    archive = path.parent / manifest['container']['name']
    run('/usr/bin/ditto', '-x', '-k', archive, relocated)
    app = relocated / manifest['bundle']['name']
    if inventory(app) != manifest['bundle']['files']:
        raise ValueError('Archive round trip changed the exact bundle inventory')
    signatures = verify_signatures(app, FIXTURE_ENGINE)
    verify_version(app / FIXTURE_ENGINE, manifest['identity']['source'])
    write_json(output / 'relocation.json', {
        'schema_version': 1, 'manifest_sha256': digest(path),
        'source_revision': manifest['identity']['source']['revision'],
        'container_sha256': digest(archive), 'bundle_sha256': manifest['bundle']['sha256'],
        'path_with_spaces': True, 'archive_round_trip': True, 'signatures': signatures,
        'bundled_engine_version': True, 'actual_app_runtime': False,
        'gatekeeper': False, 'app_translocation': False, 'toolchain': toolchain()})
    print(output / 'relocation.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    engine = commands.add_parser('prepare-engine', help='Run inside the Rust lease; make a private exact-source engine')
    engine.add_argument('--output', required=True)
    engine.add_argument('--track', choices=['dev', 'beta', 'stable'], default='dev')
    engine.set_defaults(action=prepare_engine)
    fixture = commands.add_parser('fixture', help='Ad-hoc package only; no consumer or signing qualification')
    fixture.add_argument('--engine-receipt', required=True)
    fixture.add_argument('--output', required=True)
    fixture.set_defaults(action=build_fixture)
    check = commands.add_parser('verify', help='Verify every file, executable mode and container digest')
    check.add_argument('manifest')
    check.add_argument('--signatures', action='store_true')
    check.set_defaults(action=verify)
    relocation = commands.add_parser('relocate-check', help='Extract and verify in an owned new path with spaces; never launch UI')
    relocation.add_argument('--manifest', required=True)
    relocation.add_argument('--output', required=True)
    relocation.set_defaults(action=relocate_check)
    args = parser.parse_args()
    args.action(args)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f'Package failed: {error}', file=sys.stderr)
        sys.exit(1)
