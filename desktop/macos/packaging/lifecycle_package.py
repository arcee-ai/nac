"""Canonical lifecycle compiler-output fixture, kept separate from signed normal.

The maintained lifecycle runner compares its original unsigned receipt with the
actual executable bytes. Never sign, rewrite its plist/receipt, or insert normal
PackageIdentity into this bundle. This format is test-only, not distribution.
"""
import hashlib
import json
import plistlib
import re
from pathlib import Path, PurePosixPath
import stat
import subprocess
import zipfile

from lifecycle_receipt import (BUILD_SUPPORT, ENGINE, ENGINE_IDENTITY, LIFECYCLE_FLAGS,
                               LIFECYCLE_SOURCES, OBSERVER_FLAGS, OBSERVER_SOURCE, RECEIPT,
                               SHELL, UNSIGNED_FILES, validate_lifecycle_receipt)
from native_receipt import expected_identity
from provenance import (ROOT, clean_source, digest, inventory, new_directory,
                        object_digest, run, validate_receipt, write_json)

ROLE = 'canonical-lifecycle-fixture-v1'
APP = 'NAC Lifecycle Smoke.app'
OBSERVER = 'InstanceObservation'
CONTAINER = 'NAC-lifecycle-fixture-arm64.zip'
JOURNEY_SOURCES = {'desktop/macos/LifecycleSmoke.swift', 'desktop/macos/lifecycle_smoke.py',
                   'desktop/macos/test_lifecycle_composition.py'}
SIGNATURE_ROLE = 'original canonical compiler output; no packaging signing or signature qualification'
MAX_ZIP = 128 * 1024**2
MAX_EXPANDED = 256 * 1024**2
QUALIFICATION = {name: False for name in ('developer_id', 'notarized', 'stapled', 'gatekeeper',
    'quarantined_download', 'applications_install', 'app_translocation', 'actual_app_runtime',
    'track_bundle_identity', 'consumer_ready', 'minimum_os', 'signature_qualified')}


def require(value, reason):
    if not value:
        raise ValueError(reason)


def private_files(paths):
    """No symlink, hardlink or inode alias, including across the two build roles."""
    seen = set()
    for path in paths:
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                'Role outputs require private regular files without hardlinks')
        key = (info.st_dev, info.st_ino)
        require(key not in seen, 'Role files alias another role or canonical engine')
        seen.add(key)


def fixture_rows(app, observer):
    rows = {APP+'/'+name: row for name, row in inventory(app).items()}
    require(set(rows) == {APP+'/'+name for name in UNSIGNED_FILES}, 'Closed canonical lifecycle layout')
    private_files([observer, *[app / name for name in UNSIGNED_FILES]])
    require(observer.stat().st_size <= 16*1024**2, 'Observer size bound')
    rows[OBSERVER] = dict(sha256=digest(observer), size=observer.stat().st_size,
                          mode=stat.S_IMODE(observer.stat().st_mode))
    for name, row in rows.items():
        require(row['mode'] == (0o755 if name in (OBSERVER, APP+'/'+ENGINE, APP+'/'+SHELL) else 0o644),
                'Canonical lifecycle file mode')
    return rows


def archive_inventory(archive):
    """Bounded CRC/hash audit without extraction; only six canonical regular files."""
    require(archive.stat().st_size <= MAX_ZIP, 'Lifecycle compressed size bound')
    files, seen, total = {}, set(), 0
    expected = {APP+'/'+name for name in UNSIGNED_FILES} | {OBSERVER}
    with zipfile.ZipFile(archive) as z:
        require(len(z.infolist()) == 6, 'Lifecycle archive must have exactly six regular entries')
        for item in z.infolist():
            path = PurePosixPath(item.filename)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in item.filename
                    and str(path) == item.filename and item.filename in expected,
                    'Noncanonical lifecycle ZIP path/layout')
            key = item.filename.casefold()
            require(key not in seen and not item.flag_bits & 1, 'Duplicate/encrypted lifecycle ZIP member')
            seen.add(key)
            mode = item.external_attr >> 16
            require(stat.S_ISREG(mode), 'Unsupported lifecycle ZIP type')
            total += item.file_size
            require(item.file_size <= MAX_ZIP and total <= MAX_EXPANDED, 'Lifecycle expanded size bound')
            data = z.read(item)
            files[item.filename] = dict(sha256=hashlib.sha256(data).hexdigest(), size=len(data),
                                        mode=stat.S_IMODE(mode))
    require(set(files) == expected, 'Missing lifecycle ZIP member')
    return files


def load_manifest(path):
    path = Path(path)
    private_files([path])
    require(path.stat().st_size <= 256*1024, 'Lifecycle manifest size bound')
    def unique(rows):
        result = {}
        for key, value in rows:
            require(key not in result, 'Duplicate lifecycle JSON key')
            result[key] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=unique)


def build_lifecycle(args):
    from package import executable_evidence, require_mac, toolchain, verify_version
    require_mac()
    source = clean_source()
    receipt_path = Path(args.engine_receipt).resolve(strict=True)
    engine = receipt_path.parent / 'nac-web'
    receipt = json.loads(receipt_path.read_text())
    validate_receipt(receipt, source, engine)
    verify_version(engine, source)
    identity = json.loads(run(engine, '__desktop-identity'))
    require(identity == expected_identity(source, receipt['build']), 'Exact canonical engine required')
    output = new_directory(args.output)
    import os
    env = dict(os.environ, NAC_MAC_OUTPUT=str(output), NAC_MAC_ENGINE=str(engine), NAC_MAC_SKIP_ENGINE_BUILD='1')
    subprocess.run([str(ROOT / 'desktop/macos/preview.sh'), 'lifecycle-build'], cwd=ROOT, env=env, check=True)
    require({x.name for x in output.iterdir()} == {APP, OBSERVER, 'build-inputs-lifecycle-build.json'},
            'Unexpected canonical lifecycle builder outputs')
    app, observer = output / APP, output / OBSERVER
    native = validate_lifecycle_receipt(app, source, receipt, identity, ROOT)
    rows = fixture_rows(app, observer)
    private_files([engine, observer, *[app / name for name in UNSIGNED_FILES]])
    require(clean_source() == source, 'Source changed during canonical lifecycle compilation')
    container = output / CONTAINER
    with zipfile.ZipFile(container, 'x', compression=zipfile.ZIP_DEFLATED) as z:
        for name in sorted(rows):
            z.write(output / name, name)
    require(archive_inventory(container) == rows, 'Canonical fixture ZIP differs from compiler bytes')
    manifest = dict(schema_version=1, role=ROLE, consumer_distribution=False, source=source,
        build=receipt['build'], engine_identity=identity, engine_input=receipt['engine'],
        native_build_receipt=native, signature_role=SIGNATURE_ROLE,
        journey_sources={name: digest(ROOT / name) for name in sorted(JOURNEY_SOURCES)},
        info_plist_source_sha256=digest(ROOT / 'desktop/macos/Info.plist'),
        bundle=dict(name=APP, files=inventory(app), sha256=object_digest(inventory(app))),
        observer=dict(name=OBSERVER, role='canonical-lifecycle-observer', source_revision=source['revision'],
            source_files={OBSERVER_SOURCE: digest(ROOT / OBSERVER_SOURCE)}, compiler_flags=OBSERVER_FLAGS,
            builder_sha256=digest(ROOT / 'desktop/macos/preview.sh'), **rows[OBSERVER]),
        files=rows, inventory_sha256=object_digest(rows),
        container=dict(name=CONTAINER, sha256=digest(container), size=container.stat().st_size),
        executables={name: executable_evidence(output / name) for name in (APP+'/'+ENGINE, APP+'/'+SHELL, OBSERVER)},
        qualification=QUALIFICATION.copy(), minimum_os=dict(declared='14.0', qualified=None), toolchain=toolchain())
    write_json(output / 'manifest.json', manifest)
    verify_lifecycle_files(manifest, output, ROOT)
    require(clean_source() == source, 'Source changed while sealing lifecycle fixture')
    print(output / 'manifest.json')


def verify_lifecycle_files(manifest, directory, source_root=None):
    require(type(manifest.get('schema_version')) is int and manifest['schema_version'] == 1
            and manifest.get('role') == ROLE,
            'Typed canonical lifecycle manifest required')
    require(manifest.get('consumer_distribution') is False and manifest.get('signature_role') == SIGNATURE_ROLE
            and set(manifest.get('qualification', {})) == set(QUALIFICATION)
            and all(value is False for value in manifest['qualification'].values()),
            'Fixture cannot claim signing/runtime/distribution qualification')
    source, receipt = manifest['source'], manifest['native_build_receipt']
    require(type(receipt.get('version')) is int and receipt['version'] == 1 and receipt.get('phase') == 'unsigned-build'
            and receipt.get('mode') == 'lifecycle-build' and receipt.get('source_head') == source['revision']
            and receipt.get('compiler_flags') == LIFECYCLE_FLAGS
            and set(receipt.get('native_source_files', {})) == LIFECYCLE_SOURCES
            and set(receipt.get('build_support_files', {})) == BUILD_SUPPORT,
            'Lifecycle receipt source/mode/flags mismatch')
    for key, value in dict(normal_startup=True, smoke_instrumentation=True,
                           lifecycle_smoke_instrumentation=True, instance_smoke_instrumentation=False,
                           attention_smoke_instrumentation=False, source_dirty=False,
                           preview_definitions_excluded=True).items():
        require(receipt.get(key) is value, 'Lifecycle instrumentation booleans mismatch')
    require('fixture_markers_absent' not in receipt, 'Instrumented fixture cannot claim normal exclusion')
    require(set(manifest.get('journey_sources', {})) == JOURNEY_SOURCES, 'Current maintained journey source roster required')
    directory = Path(directory)
    bundle, observer, container = manifest['bundle'], manifest['observer'], manifest['container']
    require(bundle['name'] == APP and observer.get('name') == OBSERVER and container['name'] == CONTAINER,
            'Lifecycle role names mismatch')
    app = directory / APP
    rows = fixture_rows(app, directory / OBSERVER)
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    require(info.get('CFBundleIdentifier') == receipt['bundle_identifier']
            and info['CFBundleIdentifier'].endswith('.instance-smoke.lifecycle')
            and info.get('CFBundleName') == receipt['bundle_name']
            and info.get('LSMinimumSystemVersion') == '14.0', 'Canonical lifecycle plist/receipt role mismatch')
    for row in [*manifest['files'].values(), *bundle['files'].values(),
                {k: observer.get(k) for k in ('sha256', 'size', 'mode')}]:
        require(set(row) == {'sha256', 'size', 'mode'} and type(row['size']) is int
                and 0 <= row['size'] <= MAX_ZIP and type(row['mode']) is int
                and type(row['sha256']) is str and re.fullmatch('[0-9a-f]{64}', row['sha256']),
                'Strict lifecycle inventory row types/digests required')
    require(type(container['size']) is int and 0 < container['size'] <= MAX_ZIP,
            'Strict lifecycle container size required')
    require(rows == manifest['files'] and object_digest(rows) == manifest['inventory_sha256']
            and inventory(app) == bundle['files'] and object_digest(bundle['files']) == bundle['sha256'],
            'Lifecycle file inventory/digest mismatch')
    require(json.loads((app / RECEIPT).read_text()) == receipt, 'Original lifecycle receipt mismatch')
    identity = expected_identity(source, manifest['build'])
    require(identity == manifest['engine_identity'] == receipt['engine_identity']
            == json.loads((app / ENGINE_IDENTITY).read_text()), 'Lifecycle exact engine/source identity')
    require(manifest['build']['track'] in ('dev', 'beta', 'stable') and
            manifest['build']['id'] == manifest['build']['track']+'-'+source['revision'], 'Lifecycle build/source')
    require(manifest['engine_input']['sha256'] == receipt['engine_sha256'], 'Lifecycle unsigned engine input')
    for key, name in [('engine_sha256', ENGINE), ('native_sha256', SHELL), ('info_plist_sha256', 'Contents/Info.plist')]:
        require(receipt[key] == rows[APP+'/'+name]['sha256'], 'Original unsigned lifecycle bytes changed')
    require(manifest['minimum_os'] == dict(declared='14.0', qualified=None), 'Lifecycle minimum OS unqualified')
    require(observer.get('role') == 'canonical-lifecycle-observer' and observer.get('source_revision') == source['revision']
            and observer.get('compiler_flags') == OBSERVER_FLAGS and set(observer.get('source_files', {})) == {OBSERVER_SOURCE}
            and observer.get('builder_sha256') == receipt['build_support_files']['desktop/macos/preview.sh']
            and all(observer[k] == rows[OBSERVER][k] for k in ('sha256', 'size', 'mode')),
            'Lifecycle observer provenance mismatch')
    archive = directory / CONTAINER
    private_files([archive, directory / 'manifest.json', directory / OBSERVER,
                   *[app / name for name in UNSIGNED_FILES]])
    require(container['size'] == archive.stat().st_size and container['sha256'] == digest(archive)
            and archive_inventory(archive) == rows, 'Lifecycle ZIP inventory/hash mismatch')
    if source_root is not None:
        require(clean_source(source_root) == source, 'Lifecycle current clean source differs')
        engine_receipt = dict(build=manifest['build'], engine=manifest['engine_input'])
        validate_lifecycle_receipt(app, source, engine_receipt, identity, source_root)
        require(all(digest(source_root / name) == expected for name, expected in manifest['journey_sources'].items())
                and digest(source_root / 'desktop/macos/Info.plist') == manifest['info_plist_source_sha256'],
                'Current maintained journey/plist source mismatch')
        require(digest(source_root / OBSERVER_SOURCE) == observer['source_files'][OBSERVER_SOURCE],
                'Lifecycle current observer source hash mismatch')
    return dict(role=ROLE, source_revision=source['revision'], bundle_sha256=bundle['sha256'],
                observer_sha256=observer['sha256'], inventory_sha256=manifest['inventory_sha256'],
                consumer_distribution=False, actual_app_runtime=False, signature_qualified=False)


def verify_lifecycle(args):
    path = Path(args.manifest).absolute()
    require(path.resolve(strict=True) == path, 'Canonical lifecycle manifest path required')
    verify_lifecycle_files(load_manifest(path), path.parent)
    print('Canonical lifecycle compiler-output fixture integrity verified; no signature/runtime qualification')


def normal_snapshot(normal):
    from package import verify_files
    normal = Path(normal); path = normal / 'manifest.json'
    m = json.loads(path.read_text())
    require(m.get('identity', {}).get('purpose') == 'normal-app-preparation' and 'role' not in m,
            'Separate original normal package required')
    from native_receipt import NORMAL_FLAGS, NORMAL_SOURCES
    receipt = m['identity'].get('native_build_receipt', {})
    require(receipt.get('mode') == 'app-build' and receipt.get('compiler_flags') == NORMAL_FLAGS
            and set(receipt.get('native_source_files', {})) == NORMAL_SOURCES
            and set(receipt.get('build_support_files', {})) == BUILD_SUPPORT
            and all(receipt.get(k) is False for k in ('smoke_instrumentation',
                'instance_smoke_instrumentation', 'lifecycle_smoke_instrumentation', 'attention_smoke_instrumentation'))
            and receipt.get('normal_startup') is True and receipt.get('source_dirty') is False
            and 'post_sign_receipt' in m, 'Original ordinary normal receipt required')
    expected_files = UNSIGNED_FILES | {'Contents/Resources/PackageIdentity.json',
        'Contents/Resources/LICENSE', 'Contents/_CodeSignature/CodeResources',
        *{'Contents/Resources/licenses/'+name+'.txt' for name in
          ('xterm', 'lucide', 'shadcn-ui', 'radix-ui', 'floating-ui')}}
    require(set(m['bundle']['files']) == expected_files, 'Closed normal thirteen-file bundle required')
    verify_files(m, normal)
    paths = [path, normal / m['container']['name'],
             *[normal / m['bundle']['name'] / name for name in m['bundle']['files']]]
    private_files(paths)
    file_ids = {str(item.relative_to(normal)): [item.stat().st_dev, item.stat().st_ino, item.stat().st_nlink]
                for item in paths}
    return dict(file_identities=file_ids, manifest_sha256=digest(path), container_sha256=m['container']['sha256'],
                bundle_files=inventory(normal / m['bundle']['name']))


def verify_role_pair(normal, lifecycle, engine_receipt, source_root=None, before=None):
    normal, lifecycle = Path(normal), Path(lifecycle)
    require(normal.resolve() == normal and lifecycle.resolve() == lifecycle and normal != lifecycle
            and not normal.is_relative_to(lifecycle) and not lifecycle.is_relative_to(normal),
            'Role roots must be disjoint canonical directories')
    snapshot = normal_snapshot(normal)
    require(before is not None and snapshot == before, 'Sealed normal package changed or lacks original snapshot')
    n = json.loads((normal / 'manifest.json').read_text())
    f = load_manifest(lifecycle / 'manifest.json')
    proof = verify_lifecycle_files(f, lifecycle, source_root)
    require(n['identity']['source'] == f['source'] == engine_receipt['source']
            and n['identity']['engine_input'] == f['engine_input'] == engine_receipt['engine']
            and n['identity']['engine_identity'] == f['engine_identity']
            and n['identity']['build'] == f['build'] == engine_receipt['build'],
            'Both roles must consume one exact-source canonical engine receipt')
    paths = [normal / n['bundle']['name'] / name for name in n['bundle']['files']]
    paths += [normal / 'manifest.json', normal / n['container']['name'], lifecycle / 'manifest.json',
              lifecycle / CONTAINER, lifecycle / OBSERVER, *[lifecycle / APP / name for name in UNSIGNED_FILES]]
    private_files(paths)
    proof.update(normal_snapshot=snapshot, lifecycle_manifest_sha256=digest(lifecycle / 'manifest.json'),
                 sealed_normal_unchanged=True, distinct_role_inodes=True)
    return proof
