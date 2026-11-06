"""Boundary controls for the pinned data writer; real reproducibility is separate."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('timezone_writer', Path(__file__).with_name('generate.py'))
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)


class WriterBoundaries(unittest.TestCase):
    def archive(self, path, entries):
        with tarfile.open(path, 'w:gz') as out:
            for name, value, kind in entries:
                member = tarfile.TarInfo(name)
                member.type = kind
                if kind == tarfile.SYMTYPE:
                    member.linkname = '../escaped'
                    out.addfile(member)
                else:
                    member.size = len(value)
                    out.addfile(member, io.BytesIO(value))

    def pins(self, paths):
        return ({x.name: hashlib.sha256(x.read_bytes()).hexdigest() for x in paths},
                {x.name: hashlib.sha512(x.read_bytes()).hexdigest() for x in paths})

    def test_wrong_hash_fails_before_compiler_or_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'tzcode2026f.tar.gz').write_bytes(b'not the admitted archive')
            source = root / 'source'
            source.mkdir()
            with patch.object(writer.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                    writer.unpack(root, source)
                run.assert_not_called()
            self.assertEqual(list(source.iterdir()), [])

    def test_pinned_archive_still_rejects_paths_and_symlinks(self):
        for name, kind in [('../escaped', tarfile.REGTYPE),
                           ('nested/file', tarfile.REGTYPE),
                           ('link', tarfile.SYMTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                archive = root / 'fixture.tar.gz'
                self.archive(archive, [(name, b'value', kind)])
                sha256, sha512 = self.pins([archive])
                source = root / 'source'
                source.mkdir()
                with patch.object(writer, 'INPUTS', sha256), patch.object(writer, 'SHA512', sha512):
                    with self.assertRaisesRegex(ValueError, 'Non-flat or non-regular'):
                        writer.unpack(root, source)
                self.assertEqual(list(source.iterdir()), [])
                self.assertFalse((root.parent / 'escaped').exists())

    def test_conflicting_duplicate_archive_member_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            a, b = root / 'a.tar.gz', root / 'b.tar.gz'
            self.archive(a, [('version', b'2026f\n', tarfile.REGTYPE), ('LICENSE', b'original', tarfile.REGTYPE)])
            self.archive(b, [('LICENSE', b'changed', tarfile.REGTYPE)])
            sha256, sha512 = self.pins([a, b])
            source = root / 'source'
            source.mkdir()
            with patch.object(writer, 'INPUTS', sha256), patch.object(writer, 'SHA512', sha512):
                with self.assertRaisesRegex(ValueError, 'Inconsistent official input'):
                    writer.unpack(root, source)
            self.assertEqual((source / 'LICENSE').read_bytes(), b'original')

    def test_check_mode_does_not_rewrite_drift_or_export_extra_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            expected = {name: b'expected' for name in writer.OUTPUT_NAMES}
            for name in writer.OUTPUT_NAMES:
                (root / name).write_bytes(b'existing original')
            (root / 'unexpected').write_bytes(b'keep')
            args = ['generate.py', '--archives', temp, '--output', temp, '--check']
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            with patch.object(sys, 'argv', args), patch.object(writer, 'generate', return_value=expected):
                with self.assertRaisesRegex(SystemExit, 'assets drift'):
                    writer.main()
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})


    def test_output_symlink_is_rejected_before_compilation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            destination = root / 'real'
            destination.mkdir()
            (root / 'output').symlink_to(destination, target_is_directory=True)
            args = ['generate.py', '--archives', temp, '--output', str(root / 'output')]
            with patch.object(sys, 'argv', args), patch.object(writer, 'generate') as generate:
                with self.assertRaisesRegex(SystemExit, 'symlink timezone output'):
                    writer.main()
                generate.assert_not_called()
            self.assertEqual(list(destination.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
