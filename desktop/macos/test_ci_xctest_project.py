"""Portable project-definition checks, never native build/runner evidence."""
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

from ci_xctest_project import (NATIVE, PERFORMANCE, PROJECT, PROJECT_HASH, SCHEME, SCHEME_HASH,
                               materialize_project)


class ProjectSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name).resolve()
        self.harness = self.directory / 'Harness with spaces'
        self.performance = self.directory / 'Performance with spaces'
        self.output = self.directory / 'private-selection'
        maintained = Path(__file__).resolve().parents[2]
        for relative in (PROJECT / 'project.pbxproj', PROJECT / SCHEME, NATIVE):
            destination = self.harness / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(maintained / relative, destination)
        source = self.performance / PERFORMANCE
        source.parent.mkdir(parents=True)
        source.write_text('// Portable source-path fixture; no app or XCTest launched.\n')
        self.source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        self.harness_sha = self.initialize(self.harness)
        self.performance_sha = self.initialize(self.performance)

    def git(self, root, *arguments):
        return subprocess.check_output(['git', *arguments], cwd=root, text=True).strip()

    def initialize(self, root):
        self.git(root, 'init', '-q')
        return self.commit(root)

    def commit(self, root):
        self.git(root, 'add', '.')
        self.git(root, '-c', 'user.name=NAC fixture', '-c', 'user.email=fixture@example.invalid',
                 '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Portable project fixture')
        return self.git(root, 'rev-parse', 'HEAD')

    def materialize(self, **changes):
        arguments = {'performance_root': self.performance, 'performance_sha': self.performance_sha,
                     'performance_source_sha256': self.source_hash, 'output': self.output}
        arguments.update(changes)
        return materialize_project(self.harness, self.harness_sha, **arguments)

    def test_no_optional_source_uses_byte_identical_ordinary_definition(self):
        result = materialize_project(self.harness, self.harness_sha)
        self.assertEqual(result['project'], str(self.harness / PROJECT))
        self.assertEqual(result['scheme'], 'NACNativeUITests')
        self.assertFalse(result['receipt']['generated'])
        self.assertEqual(result['receipt']['base_project_sha256'], PROJECT_HASH)
        self.assertEqual(result['receipt']['base_scheme_sha256'], SCHEME_HASH)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.git(self.harness, 'status', '--porcelain'), '')
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            materialize_project(self.harness, self.harness_sha, output=self.output)

    def test_private_variant_binds_all_inherited_inputs_without_copying_swift(self):
        result = self.materialize()
        project = Path(result['project'])
        text = (project / 'project.pbxproj').read_text()
        self.assertEqual(result['scheme'], 'NACPerformanceUITests')
        # Inspect the generated graph: exactly two Swift references, both actual
        # absolute source files; remaining file references are built products.
        objects = re.findall(r'^    ([AB][0-9]{23}) = \{\n(.*?)^    \};', text, re.M | re.S)
        self.assertEqual(len(objects), 21)
        self.assertEqual(len({identity for identity, _ in objects}), 21)
        references = [body for _, body in objects if 'isa = PBXFileReference;' in body]
        self.assertEqual(len(references), 4)
        swift = [body for body in references if 'sourcecode.swift' in body]
        self.assertEqual(len(swift), 2)
        for path in (self.harness / NATIVE, self.performance / PERFORMANCE):
            self.assertTrue(any('path = "' + str(path) + '";' in body and
                                'sourceTree = "<absolute>";' in body for body in swift))
        for body in references:
            if body not in swift:
                self.assertIn('sourceTree = BUILT_PRODUCTS_DIR;', body)
        self.assertFalse(list(self.output.rglob('*.swift')))
        scheme = ET.parse(project / SCHEME.parent / 'NACPerformanceUITests.xcscheme')
        tests = scheme.findall('.//TestableReference/BuildableReference')
        builds = scheme.findall('.//BuildActionEntry/BuildableReference')
        self.assertEqual(len(tests), 1)
        self.assertEqual(len(builds), 1)
        for node in tests + builds:
            self.assertEqual(node.attrib['BlueprintName'], 'NACPerformanceUITests')
            self.assertEqual(node.attrib['BlueprintIdentifier'], 'B10000000000000000000004')
            self.assertEqual(node.attrib['ReferencedContainer'], 'container:NACNativeUITests.xcodeproj')
        self.assertEqual((project / SCHEME).read_bytes(), (self.harness / PROJECT / SCHEME).read_bytes())
        receipt = result['receipt']
        self.assertEqual(receipt['performance_source_sha256'], self.source_hash)
        self.assertEqual(receipt['performance_source_path'], str(self.performance / PERFORMANCE))
        self.assertEqual(receipt['generated_project_sha256'], hashlib.sha256(text.encode()).hexdigest())
        self.assertEqual(self.git(self.harness, 'status', '--porcelain'), '')
        self.assertEqual(self.git(self.performance, 'status', '--porcelain'), '')

    def test_absent_wrong_dirty_or_hash_mismatched_sources_never_emit_project(self):
        for changes in ({'performance_root': self.directory / 'absent'}, {'performance_sha': '0' * 40},
                        {'performance_source_sha256': '0' * 64}, {'performance_source_sha256': None}):
            with self.subTest(changes=changes), self.assertRaises((RuntimeError, FileNotFoundError)):
                self.materialize(**changes)
            self.assertFalse(self.output.exists())
        for root in (self.harness, self.performance):
            dirty = root / 'dirty'
            dirty.write_text('unit fixture')
            with self.assertRaisesRegex(RuntimeError, 'dirty=True'):
                self.materialize()
            dirty.unlink()
        path = self.performance / PERFORMANCE
        path.unlink()
        self.performance_sha = self.commit(self.performance)
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            self.materialize()

    def test_symlink_sources_roots_and_destinations_are_rejected(self):
        link = self.directory / 'linked-root'
        link.symlink_to(self.performance, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'canonical'):
            self.materialize(performance_root=link)
        self.output.symlink_to(self.directory / 'absent')
        with self.assertRaisesRegex(RuntimeError, 'canonical'):
            self.materialize()
        self.output.unlink()
        path = self.performance / PERFORMANCE
        path.unlink()
        path.symlink_to(self.harness / NATIVE)
        self.performance_sha = self.commit(self.performance)
        with self.assertRaisesRegex(RuntimeError, 'symlinked'):
            self.materialize()
        self.assertFalse(self.output.exists())

    def test_unknown_inherited_file_or_configuration_is_rejected_by_definition_pin(self):
        path = self.harness / PROJECT / 'project.pbxproj'
        path.write_text(path.read_text().replace('SDKROOT = macosx;', 'baseConfigurationReference = UNKNOWN;'))
        self.harness_sha = self.commit(self.harness)
        with self.assertRaisesRegex(RuntimeError, 'all inherited references'):
            self.materialize()
        self.assertFalse(self.output.exists())

    def test_output_must_be_new_and_outside_both_checkouts(self):
        for output in (self.harness / 'generated', self.performance / 'generated', self.directory,
                       self.directory / 'absent-parent/generated'):
            with self.subTest(output=output), self.assertRaisesRegex(RuntimeError, 'destination'):
                self.materialize(output=output)


if __name__ == '__main__':
    unittest.main()
