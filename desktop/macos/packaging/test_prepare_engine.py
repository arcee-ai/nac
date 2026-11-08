"""Exercise actual private copying with mocked compiler and engine execution."""
import json
import os
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import package
from provenance import digest


class PrepareEngineTargetContract(unittest.TestCase):
    def exercise_target(self, target_value, caller_is_root=False):
        with tempfile.TemporaryDirectory(prefix='nac target paths ') as temporary:
            root = Path(temporary).resolve()
            repository = root / 'repository'
            repository.mkdir()
            caller = repository if caller_is_root else root / 'other caller'
            caller.mkdir(exist_ok=True)
            if target_value == 'relative':
                target = repository / 'leased target'
                environment = {'CARGO_TARGET_DIR': 'leased target'}
            elif target_value == 'absolute':
                target = root / 'absolute leased target'
                environment = {'CARGO_TARGET_DIR': str(target)}
            else:
                target = repository / 'target'
                environment = {}
            suffix = 'aarch64-apple-darwin/release/nac-web'
            compiled = target / suffix
            compiled.parent.mkdir(parents=True)
            compiled.write_bytes(b'synthetic compiler output, not executable code')
            if target_value == 'relative' and not caller_is_root:
                decoy = caller / 'leased target' / suffix
                decoy.parent.mkdir(parents=True)
                decoy.write_bytes(b'wrong caller-relative output')
            source = {'revision': 'a' * 40, 'product_version': '1.2.3'}
            identity = {'source_revision': source['revision'], 'product_version': '1.2.3',
                        'track': 'dev', 'build_id': 'dev-' + source['revision']}
            output = root / 'private output'
            args = SimpleNamespace(output=str(output), track='dev')

            def engine_execution(*command):
                if command[-1] == '--version':
                    return 'nac-web 1.2.3 (aaaaaaaaaaaa)'
                if command[-1] == '__desktop-identity':
                    return json.dumps(identity)
                self.assertEqual(command, ('rustc', '-Vv'))
                return 'synthetic toolchain'

            previous = Path.cwd()
            try:
                os.chdir(caller)
                with patch.dict(os.environ, environment, clear=True), patch('package.ROOT', repository), \
                        patch('package.require_mac'), patch('package.clean_source', return_value=source), \
                        patch('package.toolchain', return_value={'fixture': True}), \
                        patch('package.run', side_effect=engine_execution), \
                        patch('package.subprocess.run') as compiler, \
                        patch('package.shutil.copy2', wraps=shutil.copy2) as copier:
                    package.prepare_engine(args)
                compiler.assert_called_once()
                self.assertEqual(compiler.call_args.kwargs['cwd'], repository)
                self.assertEqual(compiler.call_args.args[0], [
                    'cargo', 'build', '--release', '--locked', '-p', 'nac-server', '--bin',
                    'nac-web', '--target', 'aarch64-apple-darwin'])
                self.assertEqual((output / 'nac-web').read_bytes(), compiled.read_bytes())
                copier.assert_called_once()
                self.assertEqual(Path(copier.call_args.args[0]).resolve(), compiled)
                self.assertEqual(copier.call_args.args[1], output / 'nac-web')
                receipt = json.loads((output / 'engine-build.json').read_text())
                self.assertEqual(receipt['engine']['sha256'], digest(compiled))
                self.assertEqual(receipt['engine_identity'], identity)
            finally:
                os.chdir(previous)

    def test_relative_target_from_other_caller_copies_cargo_output_instead_of_decoy(self):
        self.exercise_target('relative')

    def test_relative_target_from_repository_caller_remains_compatible(self):
        self.exercise_target('relative', caller_is_root=True)

    def test_absolute_target_is_preserved_from_other_caller(self):
        self.exercise_target('absolute')

    def test_unset_target_uses_repository_default_from_other_caller(self):
        self.exercise_target(None)


if __name__ == '__main__':
    unittest.main()
