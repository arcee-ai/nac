#!/usr/bin/env python3
"""Static/executable shell controls for the manifest-only managed dependency layer.

These controls need no Rust compiler or network, so the image contract job can
run them before hosted compilation. Full dependency-graph equality and actual
image cache/timing qualification remain separate experiments.
"""
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILD = 'cargo build --release --locked -p nac-server --bin nac-web'
CLEAN = 'cargo clean --release --locked --offline --workspace'


def instructions():
    logical = []
    pending = ''
    for raw in (ROOT / 'docker/managed/Dockerfile').read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        pending += line[:-1] + ' ' if line.endswith('\\') else line
        if not line.endswith('\\'):
            logical.append(pending)
            pending = ''
    start = next(i for i, line in enumerate(logical) if line.endswith(' AS build'))
    end = next(i for i in range(start + 1, len(logical)) if logical[i].startswith('FROM '))
    return logical[start:end]


class DependencyLayer(unittest.TestCase):
    def test_exact_manifests_and_production_targets_survive_shell_preparation(self):
        stage = instructions()
        copy = stage.index('COPY . .')
        dependencies = stage[:copy]
        root_manifest = tomllib.loads((ROOT / 'Cargo.toml').read_text())
        members = root_manifest['workspace']['members']
        manifests = {'Cargo.toml', 'Cargo.lock', *(f'{member}/Cargo.toml' for member in members)}
        copied = set()
        with tempfile.TemporaryDirectory(prefix='nac-dependency-layer-') as directory:
            fixture = Path(directory)
            for line in dependencies:
                if not line.startswith('COPY '):
                    continue
                *sources, destination = shlex.split(line[5:])
                for source in sources:
                    self.assertIn(source, manifests, 'only manifests/lock may precede dependency compilation')
                    target = fixture / destination
                    if destination.endswith('/'):
                        target /= Path(source).name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT / source, target)
                    copied.add(source)
            self.assertEqual(copied, manifests, 'every workspace member manifest must reach dependency resolution')
            build = next(line[4:] for line in dependencies if line.startswith('RUN ') and BUILD in line)
            self.assertTrue(build.endswith('&& ' + BUILD))
            prepare = build.rsplit('&&', 1)[0]
            subprocess.run(['sh', '-eu', '-c', prepare], cwd=fixture, check=True)
            expected = set()
            for member in members:
                package = tomllib.loads((ROOT / member / 'Cargo.toml').read_text())
                library = package.get('lib', {}).get('path', 'src/lib.rs')
                if (ROOT / member / library).is_file():
                    expected.add(f'{member}/{library}')
                main = f'{member}/src/main.rs'
                if (ROOT / main).is_file():
                    expected.add(main)
                for binary in package.get('bin', []):
                    expected.add(f"{member}/{binary.get('path', 'src/main.rs')}")
                script = package['package'].get('build', 'build.rs')
                if script and (ROOT / member / script).is_file():
                    expected.add(f'{member}/{script}')
            actual = {str(path.relative_to(fixture)) for path in fixture.rglob('*') if path.is_file()} - manifests
            self.assertEqual(actual, expected, 'placeholder source paths must exactly match existing production targets')
            for path in manifests:
                self.assertEqual((fixture / path).read_bytes(), (ROOT / path).read_bytes(),
                                 'do not rewrite manifests/lock to create a different dependency graph')

    def test_real_source_clears_every_local_output_before_exact_product_compilation(self):
        stage = instructions()
        copy = stage.index('COPY . .')
        self.assertEqual(stage.count('COPY . .'), 1)
        actual = [line[4:] for line in stage[copy + 1:] if line.startswith('RUN ')]
        self.assertEqual(len(actual), 1)
        self.assertTrue(actual[0].startswith(CLEAN + ' '), 'clear all local workspace outputs after source COPY')
        self.assertIn('&& NAC_BUILD_TRACK="${NAC_BUILD_TRACK}"', actual[0])
        self.assertTrue(actual[0].endswith(BUILD), 'real source uses the same release/profile/feature build')
        for name in ['NAC_BUILD_TRACK', 'NAC_BUILD_ID', 'NAC_SOURCE_REVISION']:
            self.assertFalse(any(line.startswith('ARG ' + name) for line in stage[:copy]))
            self.assertIn(f'{name}="${{{name}}}"', actual[0])
        self.assertNotIn('||', actual[0], 'failed cleanup or compilation cannot fall through')


if __name__ == '__main__':
    unittest.main()
