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

from signing import (SignaturePolicy, inspection_commands, notarization_plan, signature_evidence,
                     signing_commands, verification_commands)
from native_receipt import (ENGINE as ENGINE_PATH, SHELL as SHELL_PATH,
                            expected_identity, validate_native_receipt)
from provenance import (ROOT, clean_source, digest, inventory, new_directory,
                        object_digest, run, validate_receipt, write_json)


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
               'identity_evidence': 'exact bundled __desktop-identity plus --version; not runtime launch qualification'}
    identity = json.loads(run(engine, '__desktop-identity'))
    if identity != expected_identity(source, build):
        raise ValueError('Compiled engine identity differs from the exact source/build')
    receipt['engine_identity'] = identity
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
    # This execution path remains ad-hoc only; Developer ID requires its separate gate.
    for command in signing_commands(app, [engine], SignaturePolicy('ad-hoc')):
        run(*command)
    return verify_signatures(app, engine)


def verify_signatures(app, engine, policy=None):
    policy = policy or SignaturePolicy('ad-hoc')
    for command in verification_commands(app, [engine], policy):
        run(*command)
    results = {}
    for label, inspection in zip(['engine', 'app'], inspection_commands(app, [engine])):
        result = subprocess.run(inspection['entitlements_argv'],
                                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        entitlements = plistlib.loads(result.stdout) if result.stdout.strip() else {}
        details = subprocess.run(inspection['details_argv'],
                                 check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        results[label] = signature_evidence(details.stderr, entitlements, policy)
    return results


def post_sign_record(identity, info, files, signatures, observed_engine):
    """Outer preparation receipt; never change the already sealed identity marker."""
    if observed_engine != identity['engine_identity']:
        raise ValueError('Post-sign engine identity differs from the compiled source/build')
    version = identity['source']['product_version']
    if info.get('CFBundleShortVersionString') != version or info.get('CFBundleVersion') != version:
        raise ValueError('Post-sign bundle version differs from root product version')
    native = identity.get('native_build_receipt')
    if native is not None and (info.get('CFBundleIdentifier') != native['bundle_identifier']
                               or info.get('CFBundleName') != native['bundle_name']):
        raise ValueError('Post-sign bundle metadata differs from the track factory receipt')
    if set(signatures) != {'app', 'engine'} or any(
            value != {'kind': 'ad-hoc', 'hardened_runtime': True, 'entitlements': {}}
            for value in signatures.values()):
        raise ValueError('Post-sign preparation requires verified ad-hoc signatures')
    return {'schema_version': 1, 'phase': 'ad-hoc-preparation',
            'source_revision': identity['source']['revision'], 'engine_identity': observed_engine,
            'bundle_identifier': info['CFBundleIdentifier'], 'bundle_name': info['CFBundleName'],
            'product_version': version, 'bundle_version': info['CFBundleVersion'],
            'engine_sha256': files[ENGINE_PATH]['sha256'], 'native_sha256': files[SHELL_PATH]['sha256'],
            'info_plist_sha256': files['Contents/Info.plist']['sha256'],
            'signatures': signatures, 'qualified_consumer': False}


def build_package(args):
    require_mac()
    source = clean_source()
    receipt_path = Path(args.engine_receipt).resolve(strict=True)
    receipt = json.loads(receipt_path.read_text())
    engine = receipt_path.parent / 'nac-web'
    validate_receipt(receipt, source, engine)
    verify_version(engine, source)
    observed_identity = json.loads(run(engine, '__desktop-identity'))
    if observed_identity != expected_identity(source, receipt['build']):
        raise ValueError('Private engine identity differs from the exact source/build')
    output = new_directory(args.output)
    env = dict(os.environ, NAC_MAC_OUTPUT=str(output), NAC_MAC_ENGINE=str(engine),
               NAC_MAC_SKIP_ENGINE_BUILD='1')
    # Existing single native writer; build never launches the fixture or user stores.
    mode = 'app-build' if args.normal else 'build'
    subprocess.run([str(ROOT / 'desktop/macos/preview.sh'), mode], cwd=ROOT, env=env, check=True)
    apps = list(output.glob('*.app'))
    if len(apps) != 1:
        raise ValueError('Native builder must produce exactly one app bundle')
    app = apps[0]
    native_receipt = (validate_native_receipt(app, source, receipt, observed_identity, ROOT)
                      if args.normal else None)
    if digest(app / ENGINE_PATH) != receipt['engine']['sha256']:
        raise ValueError('Native builder consumed a different engine')
    executables = {name: executable_evidence(app / name)
                   for name in (SHELL_PATH, ENGINE_PATH)}
    plist_path = app / 'Contents/Info.plist'
    info = plistlib.loads(plist_path.read_bytes())
    if not args.normal and info['CFBundleIdentifier'] != 'ai.arcee.nac.development-preview':
        raise ValueError('Unexpected fixture bundle identity')
    if args.normal and info['CFBundleIdentifier'] == 'ai.arcee.nac.development-preview':
        raise ValueError('Normal app cannot use the preview bundle identity')
    info['CFBundleShortVersionString'] = source['product_version']
    info['CFBundleVersion'] = source['product_version']
    plist_path.write_bytes(plistlib.dumps(info, sort_keys=True))
    resources = app / 'Contents/Resources'
    shutil.copy2(ROOT / 'LICENSE', resources / 'LICENSE')
    shutil.copytree(ROOT / 'crates/nac-server/assets/dist/licenses', resources / 'licenses')
    purpose = 'normal-app-preparation' if args.normal else 'development-preview-fixture'
    identity = {'schema_version': 1, 'purpose': purpose,
                'consumer_distribution': False, 'source': source, 'build': receipt['build'],
                'engine_identity': observed_identity,
                'engine_input': receipt['engine'], 'native_builder': 'desktop/macos/preview.sh',
                'native_builder_sha256': digest(ROOT / 'desktop/macos/preview.sh'),
                'instrumentation': ('LOCAL_APP; no preview definitions or smoke instrumentation'
                                    if args.normal else 'disposable preview profile/provider; PREVIEW_SMOKE absent'),
                'minimum_os': {'declared': info['LSMinimumSystemVersion'], 'qualified': None},
                'toolchain': toolchain()}
    if native_receipt is not None:
        identity['native_build_receipt'] = native_receipt
    write_json(resources / 'PackageIdentity.json', identity)
    signatures = sign_adhoc(app, ENGINE_PATH)
    if clean_source() != source:
        raise ValueError('Source changed during native build/package')
    container = output / f'NAC-{purpose}-arm64.zip'
    run('/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, container)
    files = inventory(app)
    post_sign = post_sign_record(identity, plistlib.loads(plist_path.read_bytes()), files, signatures,
                                json.loads(run(app / ENGINE_PATH, '__desktop-identity')))
    manifest = {'schema_version': 1, 'identity': identity, 'bundle': {
        'name': app.name, 'identifier': info['CFBundleIdentifier'], 'files': files,
        'sha256': object_digest(files), 'executables': executables},
        'container': {'name': container.name, 'sha256': digest(container), 'size': container.stat().st_size},
        'signatures': signatures, 'post_sign_receipt': post_sign,
        'qualification': {'developer_id': False, 'notarized': False,
        'stapled': False, 'gatekeeper': False, 'quarantined_download': False,
        'applications_install': False, 'app_translocation': False, 'actual_app_runtime': False}}
    if args.normal:
        manifest['qualification']['track_bundle_identity'] = False
        manifest['qualification']['consumer_ready'] = False
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
    # Older preparation manifests remain readable. New manifests bind their own
    # post-sign metadata to the exact bytes without asserting runtime qualification.
    if 'post_sign_receipt' in manifest:
        app = directory / bundle['name']
        expected = post_sign_record(embedded, plistlib.loads((app / 'Contents/Info.plist').read_bytes()),
                                   files, manifest['signatures'],
                                   json.loads((app / 'Contents/Resources/engine-identity.json').read_text()))
        if manifest['post_sign_receipt'] != expected:
            raise ValueError('Post-sign preparation receipt differs from sealed bundle facts')
    if embedded.get('consumer_distribution') is not False or any(manifest['qualification'].values()):
        raise ValueError('Preparation format cannot establish consumer/distribution qualification')


def verify(args):
    path = Path(args.manifest).resolve(strict=True)
    manifest = json.loads(path.read_text())
    verify_files(manifest, path.parent)
    if args.signatures:
        require_mac()
        verify_signatures(path.parent / manifest['bundle']['name'], ENGINE_PATH)
    print('Preparation integrity verified; Developer ID/notary/Gatekeeper/runtime acceptance unavailable')



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
    signatures = verify_signatures(app, ENGINE_PATH)
    verify_version(app / ENGINE_PATH, manifest['identity']['source'])
    if 'engine_identity' in manifest['identity']:
        if json.loads(run(app / ENGINE_PATH, '__desktop-identity')) != manifest['identity']['engine_identity']:
            raise ValueError('Relocated bundled engine identity changed')
    write_json(output / 'relocation.json', {
        'schema_version': 1, 'manifest_sha256': digest(path),
        'source_revision': manifest['identity']['source']['revision'],
        'container_sha256': digest(archive), 'bundle_sha256': manifest['bundle']['sha256'],
        'path_with_spaces': True, 'archive_round_trip': True, 'signatures': signatures,
        'bundled_engine_version': True, 'actual_app_runtime': False,
        'gatekeeper': False, 'app_translocation': False, 'toolchain': toolchain()})
    print(output / 'relocation.json')


def distribution_plan(args):
    path = Path(args.manifest).resolve(strict=True)
    manifest = json.loads(path.read_text())
    verify_files(manifest, path.parent)
    identity = manifest['identity']
    if identity.get('purpose') != 'normal-app-preparation' or 'native_build_receipt' not in identity:
        raise ValueError('A validated normal-app preparation is required; preview fixtures cannot be signed for distribution')
    policy = SignaturePolicy('developer-id', args.certificate, args.team)
    output = new_directory(args.output)
    app = path.parent / manifest['bundle']['name']
    candidate = output / 'developer-id-candidate' / app.name
    notary = notarization_plan(candidate, output / 'submission.zip', args.notary_profile)
    notary['stages'].insert(0, {
        'name': 'verify-developer-id-policy',
        'argv': [sys.executable, '-B', str(Path(__file__).resolve()), 'verify-developer-id',
                 '--app', str(candidate), '--certificate', args.certificate, '--team', args.team,
                 '--output', str(output / 'signature-verification')],
        'postconditions': {'kind': 'developer-id', 'team_id': args.team, 'hardened_runtime': True,
                           'secure_timestamp': True, 'entitlements': {}},
        'gate': 'Require a successful verification and signature-evidence.json from signature_evidence '
                'for BOTH engine and app before creating or submitting the notary archive; stop on failure'})
    plan = {'schema_version': 1, 'execution_authorized': False,
            'source_revision': identity['source']['revision'], 'input_manifest_sha256': digest(path),
            'input_bundle_sha256': manifest['bundle']['sha256'],
            'staging_commands': [['/bin/mkdir', '-p', str(candidate.parent)],
                                 ['/usr/bin/ditto', str(app), str(candidate)]],
            'signing_commands': signing_commands(candidate, [ENGINE_PATH], policy),
            'verification_commands': verification_commands(candidate, [ENGINE_PATH], policy),
            'signature_inspections': inspection_commands(candidate, [ENGINE_PATH]),
            'notarization': notary,
            'required_gate': 'Qualified track identifiers and required normal-app native evidence, then explicit authorization for the designated NAC identity/profile and this exact artifact; '
                             'no commands executed, no distribution qualification inferred'}
    write_json(output / 'distribution-plan.json', plan)
    print(output / 'distribution-plan.json')


def verify_developer_id(args):
    """Read-only verification; does not sign, select credentials, submit or staple."""
    require_mac()
    app = Path(args.app).resolve(strict=True)
    before = inventory(app)
    policy = SignaturePolicy('developer-id', args.certificate, args.team)
    signatures = verify_signatures(app, ENGINE_PATH, policy)
    if inventory(app) != before:
        raise ValueError('Candidate changed while verifying Developer ID signature policy')
    output = new_directory(args.output)
    write_json(output / 'signature-evidence.json', {
        'schema_version': 1, 'kind': 'developer-id-signature-policy',
        'bundle_inventory_sha256': object_digest(before), 'signatures': signatures,
        'notary_submission_performed': False, 'consumer_qualification': False})
    print(output / 'signature-evidence.json')


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
    fixture.set_defaults(action=build_package, normal=False)
    normal = commands.add_parser('normal', help='Consume the sole normal-app builder; ad-hoc preparation only')
    normal.add_argument('--engine-receipt', required=True)
    normal.add_argument('--output', required=True)
    normal.set_defaults(action=build_package, normal=True)
    check = commands.add_parser('verify', help='Verify every file, executable mode and container digest')
    check.add_argument('manifest')
    check.add_argument('--signatures', action='store_true')
    check.set_defaults(action=verify)
    relocation = commands.add_parser('relocate-check', help='Extract and verify in an owned new path with spaces; never launch UI')
    relocation.add_argument('--manifest', required=True)
    relocation.add_argument('--output', required=True)
    relocation.set_defaults(action=relocate_check)
    plan = commands.add_parser('distribution-plan', help='Write reviewable commands only; never sign or submit')
    plan.add_argument('--manifest', required=True)
    plan.add_argument('--certificate', required=True, help='Explicitly designated Developer ID Application SHA-1')
    plan.add_argument('--team', required=True)
    plan.add_argument('--notary-profile', required=True)
    plan.add_argument('--output', required=True)
    plan.set_defaults(action=distribution_plan)
    developer = commands.add_parser('verify-developer-id', help='Read-only signature/entitlement policy gate; no signing or submission')
    developer.add_argument('--app', required=True)
    developer.add_argument('--certificate', required=True)
    developer.add_argument('--team', required=True)
    developer.add_argument('--output', required=True)
    developer.set_defaults(action=verify_developer_id)
    args = parser.parse_args()
    args.action(args)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f'Package failed: {error}', file=sys.stderr)
        sys.exit(1)
