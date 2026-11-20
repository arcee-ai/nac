"""Inert byte/role/archive controls; no Swift, Rust, signing, app or helper runs."""
import copy
import json
import os
from pathlib import Path
import plistlib
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import lifecycle_package as m
from lifecycle_receipt import (BUILD_SUPPORT, ENGINE, ENGINE_IDENTITY, LIFECYCLE_FLAGS,
                               LIFECYCLE_SOURCES, OBSERVER_FLAGS, OBSERVER_SOURCE,
                               RECEIPT, SHELL, validate_lifecycle_receipt)
from native_receipt import NORMAL_FLAGS, NORMAL_SOURCES, validate_native_receipt
from provenance import digest, inventory, object_digest, write_json


class LifecycleFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lifecycle inert ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.output = self.root / 'fixture'; self.output.mkdir()
        self.app = self.output / m.APP
        self.source = dict(revision='a'*40, product_version='1.2.3', assets={'sha256':'b'*64}, store_schema=50)
        self.build = dict(track='dev', id='dev-'+'a'*40)
        self.identity = dict(product_version='1.2.3', source_revision='a'*40, track='dev', build_id=self.build['id'])
        for name in LIFECYCLE_SOURCES | BUILD_SUPPORT | m.JOURNEY_SOURCES | {OBSERVER_SOURCE, 'desktop/macos/Info.plist'}:
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('synthetic source\n')
        for name in m.UNSIGNED_FILES:
            path = self.app / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'inert compiler output')
        self.info = dict(CFBundleIdentifier='ai.arcee.nac.dev.instance-smoke.lifecycle',
                         CFBundleName='NAC Development Instance Smoke', LSMinimumSystemVersion='14.0')
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps(self.info))
        write_json(self.app / ENGINE_IDENTITY, self.identity)
        for name in (ENGINE, SHELL): (self.app / name).chmod(0o755)
        self.observer = self.output / m.OBSERVER; self.observer.write_bytes(b'inert observer'); self.observer.chmod(0o755)
        self.receipt = dict(version=1, phase='unsigned-build', mode='lifecycle-build', normal_startup=True,
            smoke_instrumentation=True, instance_smoke_instrumentation=False, lifecycle_smoke_instrumentation=True,
            attention_smoke_instrumentation=False, source_dirty=False, preview_definitions_excluded=True,
            source_head=self.source['revision'], compiler_flags=LIFECYCLE_FLAGS.copy(),
            native_source_files={n:digest(self.root/n) for n in LIFECYCLE_SOURCES},
            build_support_files={n:digest(self.root/n) for n in BUILD_SUPPORT}, engine_identity=self.identity,
            bundle_identifier=self.info['CFBundleIdentifier'], bundle_name=self.info['CFBundleName'],
            engine_sha256=digest(self.app/ENGINE), native_sha256=digest(self.app/SHELL),
            info_plist_sha256=digest(self.app/'Contents/Info.plist'), sdk_version='synthetic')
        write_json(self.app / RECEIPT, self.receipt)
        self.engine_receipt = dict(source=self.source, build=self.build,
                                  engine=dict(sha256=digest(self.app/ENGINE), size=(self.app/ENGINE).stat().st_size))
        self.factory = patch('lifecycle_receipt.run', return_value='ai.arcee.nac.dev.instance-smoke\nNAC Development Instance Smoke').start()
        self.addCleanup(patch.stopall)
        rows = m.fixture_rows(self.app, self.observer)
        self.manifest = dict(schema_version=1, role=m.ROLE, consumer_distribution=False,
            source=self.source, build=self.build, engine_identity=self.identity, engine_input=self.engine_receipt['engine'],
            journey_sources={n:digest(self.root/n) for n in m.JOURNEY_SOURCES},
            info_plist_source_sha256=digest(self.root/'desktop/macos/Info.plist'),
            native_build_receipt=self.receipt, signature_role=m.SIGNATURE_ROLE, qualification=m.QUALIFICATION.copy(),
            minimum_os=dict(declared='14.0', qualified=None), bundle=dict(name=m.APP, files=inventory(self.app), sha256=object_digest(inventory(self.app))),
            observer=dict(name=m.OBSERVER, role='canonical-lifecycle-observer', source_revision=self.source['revision'],
                source_files={OBSERVER_SOURCE:digest(self.root/OBSERVER_SOURCE)}, compiler_flags=OBSERVER_FLAGS.copy(),
                builder_sha256=self.receipt['build_support_files']['desktop/macos/preview.sh'], **rows[m.OBSERVER]),
            files=rows, inventory_sha256=object_digest(rows))
        self.archive = self.output / m.CONTAINER
        self.zip_rows(rows)
        self.manifest['container'] = dict(name=m.CONTAINER, sha256=digest(self.archive), size=self.archive.stat().st_size)
        write_json(self.output/'manifest.json', self.manifest)

    def zip_rows(self, rows, mutate=None):
        with zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for name in sorted(rows):
                data = (self.output / name).read_bytes()
                item = zipfile.ZipInfo(name); item.external_attr=(stat.S_IFREG | rows[name]['mode']) << 16
                if mutate: item, data = mutate(item, data)
                z.writestr(item, data)

    def verify(self, manifest=None):
        return m.verify_lifecycle_files(manifest or self.manifest, self.output)

    def test_exact_canonical_unsigned_fixture_and_source_are_admitted(self):
        self.assertEqual(validate_lifecycle_receipt(self.app, self.source, self.engine_receipt, self.identity, self.root), self.receipt)
        self.assertFalse(self.verify()['signature_qualified'])
        with patch('lifecycle_package.clean_source', return_value=self.source):
            m.verify_lifecycle_files(self.manifest, self.output, self.root)
        self.assertEqual(self.factory.call_args.args[3], 'instance-smoke')

    def test_normal_receipt_cannot_be_relabelled_as_lifecycle_or_inverse(self):
        for field, value in [('mode','app-build'),('smoke_instrumentation',False),('lifecycle_smoke_instrumentation',False),
                             ('source_dirty',True),('compiler_flags',NORMAL_FLAGS),('version',2),('normal_startup',1)]:
            receipt={**self.receipt,field:value}; write_json(self.app/RECEIPT,receipt)
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_lifecycle_receipt(self.app,self.source,self.engine_receipt,self.identity,self.root)
        write_json(self.app/RECEIPT,self.receipt)
        with self.assertRaises(ValueError):
            validate_native_receipt(self.app,self.source,self.engine_receipt,self.identity,self.root)
        for field,value in [('role','normal-app-preparation'),('signature_role','ad-hoc'),('consumer_distribution',True),
                            ('qualification',{}),('minimum_os',dict(declared='14.0',qualified=True))]:
            with self.subTest(field=field),self.assertRaises(ValueError):self.verify({**self.manifest,field:value})

    def test_exact_fixture_sources_flags_support_and_digests_fail_closed(self):
        for field in ['native_source_files','build_support_files']:
            for variant in [{}, {**self.receipt[field],'desktop/macos/Other.swift':'b'*64}]:
                write_json(self.app/RECEIPT,{**self.receipt,field:variant})
                with self.assertRaises(ValueError):validate_lifecycle_receipt(self.app,self.source,self.engine_receipt,self.identity,self.root)
        write_json(self.app/RECEIPT,self.receipt)
        for name in ['desktop/macos/LifecycleSmoke.swift','desktop/macos/preview.sh']:
            original=(self.root/name).read_bytes(); (self.root/name).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'hash'):validate_lifecycle_receipt(self.app,self.source,self.engine_receipt,self.identity,self.root)
            (self.root/name).write_bytes(original)
        for field,value in [('source_head','b'*40),('engine_sha256','c'*64),('native_sha256','d'*64),('info_plist_sha256','e'*64)]:
            write_json(self.app/RECEIPT,{**self.receipt,field:value})
            with self.assertRaises(ValueError):validate_lifecycle_receipt(self.app,self.source,self.engine_receipt,self.identity,self.root)

    def test_original_unsigned_receipt_and_compiler_bytes_cannot_be_resigned_or_rewritten(self):
        for name in [ENGINE,SHELL,'Contents/Info.plist',RECEIPT]:
            path=self.app/name; original=path.read_bytes();path.write_bytes(b'changed signed or instrumented output')
            with self.subTest(name=name),self.assertRaises(ValueError):self.verify()
            path.write_bytes(original)
        extra=self.app/'Contents/Resources/PackageIdentity.json';extra.write_text('{}')
        with self.assertRaisesRegex(ValueError,'layout'):self.verify()

    def test_observer_identity_mode_hash_and_source_are_bound(self):
        for field,value in [('name','../InstanceObservation'),('role','app'),('source_revision','b'*40),
                            ('source_files',{}),('compiler_flags',[]),('builder_sha256','c'*64),('sha256','d'*64),('mode',0o644)]:
            changed=copy.deepcopy(self.manifest);changed['observer'][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):self.verify(changed)
        self.observer.write_bytes(b'changed observer')
        with self.assertRaises(ValueError):self.verify()

    def test_hardlinks_symlinks_and_role_aliases_are_rejected(self):
        other=self.root/'alias'; os.link(self.observer,other)
        with self.assertRaisesRegex(ValueError,'hardlinks'):self.verify()
        other.unlink(); original=self.observer.read_bytes();self.observer.unlink();self.observer.symlink_to(self.app/ENGINE)
        with self.assertRaises(ValueError):self.verify()
        self.observer.unlink();self.observer.write_bytes(original);self.observer.chmod(0o755)
        with self.assertRaisesRegex(ValueError,'alias'):m.private_files([self.observer,self.observer])

    def test_archive_corruption_paths_types_modes_and_expansion_bounds(self):
        rows=self.manifest['files']
        for kind in ['escape','case','duplicate','symlink','mode','bytes']:
            def mutate(item,data):
                if item.filename==m.OBSERVER:
                    if kind=='escape':item.filename='../'+item.filename
                    if kind=='case':item.filename=item.filename.lower()
                    if kind=='duplicate':item.filename=sorted(rows)[-1]
                    if kind=='symlink':item.external_attr=(stat.S_IFLNK|0o777)<<16
                    if kind=='mode':item.external_attr=(stat.S_IFREG|0o644)<<16
                    if kind=='bytes':data=b'changed archive bytes'
                return item,data
            self.zip_rows(rows,mutate)
            changed=copy.deepcopy(self.manifest);changed['container'].update(sha256=digest(self.archive),size=self.archive.stat().st_size)
            with self.subTest(kind=kind),self.assertRaises(ValueError):self.verify(changed)
        self.zip_rows(rows)
        with patch.object(m,'MAX_ZIP',8),self.assertRaises(ValueError):m.archive_inventory(self.archive)
        with patch.object(m,'MAX_EXPANDED',8),self.assertRaises(ValueError):m.archive_inventory(self.archive)
        with self.archive.open('r+b') as f:f.seek(60);f.write(b'CORRUPTION')
        with self.assertRaises((ValueError,zipfile.BadZipFile)):self.verify()

    def test_manifest_duplicate_keys_and_oversized_metadata_fail(self):
        path=self.output/'metadata.json';path.write_text('{"role":1,"role":2}')
        with self.assertRaisesRegex(ValueError,'Duplicate'):m.load_manifest(path)
        path.write_bytes(b' '* (256*1024+1))
        with self.assertRaisesRegex(ValueError,'size bound'):m.load_manifest(path)

    def test_schema_uses_literal_booleans_integers_and_typed_inventory(self):
        changed=copy.deepcopy(self.manifest);changed['schema_version']=True
        with self.assertRaisesRegex(ValueError,'Typed'):self.verify(changed)
        changed=copy.deepcopy(self.manifest);changed['qualification']['consumer_ready']=0
        with self.assertRaisesRegex(ValueError,'qualification'):self.verify(changed)
        changed=copy.deepcopy(self.manifest);changed['container']['size']=float(changed['container']['size'])
        with self.assertRaisesRegex(ValueError,'size'):self.verify(changed)
        changed=copy.deepcopy(self.manifest);changed['files'][m.OBSERVER]['size']=float(changed['files'][m.OBSERVER]['size'])
        with self.assertRaisesRegex(ValueError,'row types'):self.verify(changed)

    def make_normal(self):
        import package
        root=self.root/'normal';app=root/'NAC.app'
        names=m.UNSIGNED_FILES | {'Contents/Resources/PackageIdentity.json','Contents/Resources/LICENSE',
            'Contents/_CodeSignature/CodeResources', *{'Contents/Resources/licenses/'+n+'.txt'
                for n in ('xterm','lucide','shadcn-ui','radix-ui','floating-ui')}}
        for name in names:
            path=app/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'inert normal bytes')
            path.chmod(0o755 if name in (ENGINE,SHELL) else 0o644)
        info=dict(CFBundleIdentifier='ai.arcee.nac.dev',CFBundleName='NAC Development',CFBundleVersion='1.2.3',CFBundleShortVersionString='1.2.3')
        (app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        receipt={**self.receipt,'mode':'app-build','compiler_flags':NORMAL_FLAGS.copy(),
            'native_source_files':{n:digest(self.root/n) for n in NORMAL_SOURCES},
            'smoke_instrumentation':False,'lifecycle_smoke_instrumentation':False,
            'bundle_identifier':info['CFBundleIdentifier'],'bundle_name':info['CFBundleName']}
        identity=dict(source=self.source,build=self.build,engine_input=self.engine_receipt['engine'],engine_identity=self.identity,
            consumer_distribution=False,purpose='normal-app-preparation',native_build_receipt=receipt)
        write_json(app/ENGINE_IDENTITY,self.identity);write_json(app/RECEIPT,receipt)
        write_json(app/'Contents/Resources/PackageIdentity.json',identity)
        archive=root/'NAC-normal-app-preparation-arm64.zip';archive.write_bytes(b'inert normal container')
        files=inventory(app);signatures={k:dict(kind='ad-hoc',hardened_runtime=True,entitlements={}) for k in ('app','engine')}
        manifest=dict(schema_version=1,identity=identity,bundle=dict(name='NAC.app',files=files,sha256=object_digest(files)),
            container=dict(name=archive.name,sha256=digest(archive),size=archive.stat().st_size),signatures=signatures,
            post_sign_receipt=package.post_sign_record(identity,info,files,signatures,self.identity),
            qualification={k:False for k in m.QUALIFICATION if k not in ('minimum_os','signature_qualified')})
        write_json(root/'manifest.json',manifest)
        return root

    def test_two_roles_share_one_source_engine_but_never_file_inodes(self):
        normal=self.make_normal();before=m.normal_snapshot(normal)
        proof=m.verify_role_pair(normal,self.output,self.engine_receipt,before=before)
        self.assertTrue(proof['sealed_normal_unchanged']);self.assertTrue(proof['distinct_role_inodes'])
        with self.assertRaisesRegex(ValueError,'snapshot'):
            m.verify_role_pair(normal,self.output,self.engine_receipt,before=None)
        different=copy.deepcopy(self.engine_receipt);different['source']['revision']='b'*40
        with self.assertRaisesRegex(ValueError,'one exact-source'):
            m.verify_role_pair(normal,self.output,different,before=before)
        target=normal/'NAC.app'/ENGINE;target.unlink();os.link(self.app/ENGINE,target)
        with self.assertRaises(ValueError):m.verify_role_pair(normal,self.output,self.engine_receipt,before=before)

    def test_sealed_normal_changes_stop_before_fixture_handoff(self):
        normal=self.make_normal();before=m.normal_snapshot(normal)
        (normal/'manifest.json').write_text((normal/'manifest.json').read_text()+' ')
        with self.assertRaisesRegex(ValueError,'changed'):
            m.verify_role_pair(normal,self.output,self.engine_receipt,before=before)

    def test_canonical_build_uses_exact_existing_mode_once_without_package_signing(self):
        import package
        engine_dir=self.root/'engine';engine_dir.mkdir();engine=engine_dir/'nac-web';engine.write_bytes((self.app/ENGINE).read_bytes())
        receipt={**self.engine_receipt,'schema_version':1,'target':'aarch64-apple-darwin'}
        write_json(engine_dir/'engine-build.json',receipt)
        (self.output/'build-inputs-lifecycle-build.json').write_text('{}')
        self.archive.unlink();(self.output/'manifest.json').unlink()
        with patch('package.require_mac'),patch('package.verify_version'),patch('package.executable_evidence',return_value={'architecture':'arm64'}), \
             patch('package.toolchain',return_value={'synthetic':True}),patch.object(m,'ROOT',self.root), \
             patch.object(m,'clean_source',return_value=self.source),patch.object(m,'new_directory',return_value=self.output), \
             patch.object(m,'run',return_value=json.dumps(self.identity)),patch.object(m.subprocess,'run') as builder, \
             patch('package.sign_adhoc') as sign:
            m.build_lifecycle(SimpleNamespace(engine_receipt=str(engine_dir/'engine-build.json'),output=str(self.output)))
        builder.assert_called_once();self.assertEqual(builder.call_args.args[0],[str(self.root/'desktop/macos/preview.sh'),'lifecycle-build'])
        self.assertEqual(builder.call_args.kwargs['env']['NAC_MAC_SKIP_ENGINE_BUILD'],'1');sign.assert_not_called()
        self.assertEqual((self.app/ENGINE).read_bytes(),engine.read_bytes())
        self.assertFalse(json.loads((self.output/'manifest.json').read_text())['qualification']['signature_qualified'])

    def test_normal_snapshot_is_required_and_role_roots_must_be_disjoint(self):
        with self.assertRaises(ValueError):m.verify_role_pair(self.output,self.output,self.engine_receipt,before={})
        with self.assertRaises(ValueError):m.normal_snapshot(self.output)


if __name__=='__main__':unittest.main()
