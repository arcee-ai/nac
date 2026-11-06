#!/usr/bin/env python3
"""CLI-boundary archive controls; the container trial uses real signed packages."""
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.dont_write_bytecode=True
SPEC=importlib.util.spec_from_file_location('store',Path(__file__).with_name('apt-archive-store.py'))
store=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(store)


def deb():
    data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w:gz') as archive:
        control=b'Package: fixture-font\nVersion: 1:2.0\nArchitecture: all\n'
        entry=tarfile.TarInfo('./control');entry.size=len(control)
        archive.addfile(entry,io.BytesIO(control))
    result=b'!<arch>\n'
    for name,body in [('debian-binary',b'2.0\n'),('control.tar.gz',data.getvalue())]:
        result+=f'{name:<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(body):<10}`\n'.encode()+body
        if len(body)%2:result+=b'\n'
    return result


class CacheBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.input=self.root/'fixture.deb';raw=deb();self.input.write_bytes(raw)
        self.plan={'schema':1,'repository':'arcee-ai/nac','platform':'ubuntu26.04-amd64-amd64v3',
            'packages':[{'Package':'fixture-font','Version':'1:2.0','Architecture':'all',
                'Filename':'pool/main/f/fixture/fixture-font_2.0_all.deb','Size':str(len(raw)),
                'SHA256':hashlib.sha256(raw).hexdigest()}]}
        self.snapshot=self.root/'snapshot'

    def export(self):
        return store.export(self.plan,{'fixture-font':self.input},self.snapshot,
                            {'source':'0'*40,'origin':'owned-fixture'})

    def reject(self):
        with self.assertRaises((ValueError,OSError)):
            store.restore(self.plan,self.snapshot,self.root/'offer')
        self.assertFalse((self.root/'offer').exists())

    def test_actual_miss_export_hit_and_exact_offer_bytes(self):
        self.assertEqual(store.restore(self.plan,self.snapshot,self.root/'miss')['mode'],'miss')
        self.assertFalse((self.root/'miss').exists())
        self.export();result=store.restore(self.plan,self.snapshot,self.root/'offer')
        self.assertEqual(result['mode'],'verified-hit')
        self.assertEqual(result['copied_bytes'],self.input.stat().st_size)
        self.assertEqual((self.root/'offer/fixture-font_1%3a2.0_all.deb').read_bytes(),self.input.read_bytes())

    def test_corrupt_archive_never_exposed(self):
        self.export();payload=next(self.snapshot.glob('*.deb'));payload.write_bytes(b'corrupt')
        self.reject()

    def test_partial_prefetch_cannot_publish_cache_entry(self):
        self.input.write_bytes(self.input.read_bytes()[:20])
        with self.assertRaisesRegex(ValueError,'hash/size'):
            self.export()
        self.assertFalse(self.snapshot.exists())
        self.assertFalse(any(self.root.glob('.apt-stage-*')))

    def test_partial_and_extra_inventory_rejected(self):
        self.export();next(self.snapshot.glob('*.deb')).unlink();self.reject()
        (self.snapshot/'unexpected').write_text('extra');self.reject()

    def test_link_and_hardlink_payload_rejected(self):
        self.export();payload=next(self.snapshot.glob('*.deb'));payload.unlink();payload.symlink_to(self.input)
        self.reject();payload.unlink();os.link(self.input,payload);self.reject()

    def test_manifest_link_rejected(self):
        self.export();manifest=self.snapshot/'manifest.json';raw=manifest.read_bytes();manifest.unlink()
        other=self.root/'outside.json';other.write_bytes(raw);manifest.symlink_to(other);self.reject()

    def test_duplicate_manifest_fields_rejected(self):
        self.export();manifest=self.snapshot/'manifest.json';raw=manifest.read_bytes()
        manifest.write_bytes(b'{"schema":1,'+raw[1:]);self.reject()

    def test_malformed_producer_provenance_rejected(self):
        self.export();path=self.snapshot/'manifest.json';manifest=json.loads(path.read_bytes())
        manifest['producer']={'source':'unbound','origin':'owned-fixture'}
        path.write_text(json.dumps(manifest));self.reject()

    def test_self_consistent_snapshot_cannot_replace_fresh_authority(self):
        self.export();path=self.snapshot/'manifest.json';manifest=json.loads(path.read_bytes())
        manifest['plan']['packages'][0]['SHA256']='a'*64
        manifest['key']=store.key(manifest['plan'])
        path.write_text(json.dumps(manifest));self.reject()

    def test_foreign_stale_platform_rejected(self):
        self.export()
        for field,value in [('repository','foreign/repo'),('platform','ubuntu24-amd64')]:
            changed=json.loads(json.dumps(self.plan));changed[field]=value
            with self.assertRaises(ValueError):store.restore(changed,self.snapshot,self.root/'offer')
        changed=json.loads(json.dumps(self.plan));changed['packages'][0]['Version']='3'
        with self.assertRaises(ValueError):store.restore(changed,self.snapshot,self.root/'offer')

    def test_corrupt_unused_snapshot_is_safe_controlled_cold(self):
        self.export();next(self.snapshot.glob('*.deb')).write_bytes(b'bad')
        result=store.restore(self.plan,self.snapshot,self.root/'offer',cold=True)
        self.assertEqual(result['mode'],'controlled-cold');self.assertFalse((self.root/'offer').exists())

    def test_existing_offer_leaf_preserved(self):
        self.export();offer=self.root/'offer';offer.mkdir();(offer/'owned').write_text('keep')
        with self.assertRaisesRegex(ValueError,'fresh leaf'):
            store.restore(self.plan,self.snapshot,offer)
        self.assertEqual((offer/'owned').read_text(),'keep')

    def test_signed_hash_is_not_enough_for_wrong_control_identity(self):
        self.plan['packages'][0]['Version']='9'
        with self.assertRaisesRegex(ValueError,'control identity'):
            self.export()
        self.assertFalse(self.snapshot.exists())

    def test_input_symlink_and_invalid_plan_rejected(self):
        original=self.root/'real';self.input.rename(original);self.input.symlink_to(original)
        with self.assertRaises(OSError):self.export()
        self.plan['packages'].append(dict(self.plan['packages'][0]))
        with self.assertRaisesRegex(ValueError,'duplicate'):store.key(self.plan)


if __name__=='__main__':unittest.main()
