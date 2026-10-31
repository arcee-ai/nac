"""Exact, secret-free build inputs and closed bundle inventory for Mac packages."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[3]
ASSETS = Path('crates/nac-server/assets/dist')


def run(*args, cwd=ROOT, env=None):
    return subprocess.run([str(x) for x in args], cwd=cwd, env=env, check=True,
                          text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip()


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def inventory(root):
    """No symlinks or special files; every executable and resource is sealed."""
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Inventory root must be a real directory')
    rows = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError(f'Symlink is not supported in the initial bundle: {path}')
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(f'Unsupported bundle entry: {path}')
        rows[path.relative_to(root).as_posix()] = {
            'sha256': digest(path), 'size': path.stat().st_size,
            'mode': stat.S_IMODE(path.stat().st_mode),
        }
    if not rows:
        raise ValueError('Empty file inventory')
    return rows


def object_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def clean_source(root=ROOT):
    if run('git', 'status', '--porcelain', '--untracked-files=all', cwd=root):
        raise ValueError('Packaging requires a clean committed source, including untracked files')
    revision = run('git', 'rev-parse', 'HEAD', cwd=root)
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Expected a full Git source revision')
    assets = inventory(root / ASSETS)
    schema = (root / 'crates/nac-core/src/store/schema.rs').read_text()
    versions = re.findall(r'^const STORE_SCHEMA_VERSION: i64 = (\d+);$', schema, re.M)
    if len(versions) != 1:
        raise ValueError('Cannot bind the current schema source; inspect its owner')
    version = (root / 'version.txt').read_text().strip()
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Invalid root product version')
    return {'revision': revision, 'tree': run('git', 'rev-parse', 'HEAD^{tree}', cwd=root),
            'product_version': version, 'store_schema': int(versions[0]),
            'assets': {'path': ASSETS.as_posix(), 'sha256': object_digest(assets), 'files': assets}}


def new_directory(path):
    path = Path(path).absolute()
    # Refuse overwrite, including dangling symlinks. Never remove another artifact.
    if os.path.lexists(path):
        raise ValueError(f'Output must be a new directory: {path}')
    path.mkdir(parents=True)
    return path.resolve()


def validate_receipt(receipt, source, engine):
    if engine.is_symlink() or not engine.is_file():
        raise ValueError('Engine must be a private regular file')
    if receipt.get('schema_version') != 1 or receipt.get('source') != source:
        raise ValueError('Engine receipt does not match the exact clean source/assets/schema')
    if receipt.get('engine') != {'sha256': digest(engine), 'size': engine.stat().st_size}:
        raise ValueError('Engine digest does not match its build receipt')
    build = receipt.get('build', {})
    if build.get('track') not in ('dev', 'beta', 'stable'):
        raise ValueError('Invalid engine build track')
    if build.get('id') != f"{build['track']}-{source['revision']}":
        raise ValueError('Invalid engine build identity')
    if receipt.get('target') != 'aarch64-apple-darwin':
        raise ValueError('Initial package supports only Apple Silicon')
