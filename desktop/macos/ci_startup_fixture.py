"""Owned ordinary-startup fixtures and phase-aware immutable source admission."""
import hashlib
import os
import re
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile

from ci_qualifications import require_checkout
from ci_paths_budget import check as budget_check, time_limit
from ci_startup_process import capture, package_contract
from ci_startup_environment import resolve_environment
from ci_xctest_attachments import bounded_file

DEFAULT_PRODUCT = '1638a9f36b4978bfe790859d0d42ce3bea96a5cf'
PRODUCT = os.environ.get('NAC_STARTUP_PRODUCT_SHA') or DEFAULT_PRODUCT
if not re.fullmatch('[0-9a-f]{40}', PRODUCT):
    raise RuntimeError('Startup product must be an exact immutable commit SHA')
TEST_SOURCE = '6a7cafdeff6a73ae6c96365b03bc0a48b291bbc8'
BASELINE = 'ec4f3a9a8ab2e80d98ff76ca8c536e1e41b413c8'
SCHEMA = 'nac342-startup-xctest-v1'
CASES = ('onboarding', 'configuredLocal', 'invalidConfig', 'futureStore')
TEST_FILES = {
    'README.md': '23a181bf5ddff1dcce0a06b22e438026646d55b267f0b7205c5f58d9e22dfb54',
    'StartupJourneys.swift': 'ba30886fcde8e1245baff4bc3f372e3c51a07d1872725612c0d4a04b9484eaa1',
    'contract.py': 'e9e5b9e477ab975acedeecdef7a8ab58da2222377630644e0d5e649009c8192e',
    'test_contract.py': '99449dbae247c877b2a8960b4a1147c45d0c133e585cdbeec2cb4c6b57e53046',
    'StartupAXGuard.swift': '2fe55f60fa7331ab5a1842ea6f38108433ad0e4a6ad9d7e4589505a55fd7420a',
    'StartupAXReceipt.swift': 'cec1858eb9f28e20c5c2d91eed3e8f2531bb3a9d223686631b77b413744a7ef6',
    'AX-WITNESS-CONTRACT.md': '71e7052a425069226506ade5273a19d9a878d66ebc2c541da5079f41857a7fc5',
    'test_ax_witness.py': '6d57cfacff77a8e8a7c151dba3d6ed034f6eb946f26bf5ba39a710fc17d7816e',
    'AGENTS.md': '3e24e5b29e32356d08895b2c162407a1be5cf9d71c1740d1dcc50fc566bc89e6',
    'test_title_assertion.py': 'e4389c84259f0f8dbbd3b42eef153757b8f9da26d337010b8affd1719f415cef'
}
FUTURE_MESSAGE = ('The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible newer NAC app. '
                  'Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected.')


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def canonical(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve(strict=True) != path or path.is_symlink():
        raise RuntimeError('Startup fixture path is not canonical and owned')
    return path


def test_contract(root):
    root = canonical(root)
    require_checkout(root, TEST_SOURCE)
    directory = root / 'desktop/macos/startup_xctest'
    for name, expected in TEST_FILES.items():
        file = canonical(directory / name)
        if not file.is_file() or hashlib.sha256(bounded_file(file, 256 * 1024)).hexdigest() != expected:
            raise RuntimeError('Nominated startup source inventory differs')
    spec = importlib.util.spec_from_file_location('nac342_nominated_startup_contract', directory / 'contract.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def operations(config):
    if config['scenario'] != 'configuredLocal':
        return []
    return ['click:Get Started', 'click:Choose Working Folder: ' + config['home'], 'key:command-shift-g-native-folder',
            'key:command-a-native-go-to-folder', 'type:owned-workspace', 'key:return-native-go-to-folder',
            'click:native-folder-Select', 'click:session-model', 'click:Search models',
            'type:model-query', 'key:return-model-query', 'click:Create Project', 'click:Message',
            'type:FINDER_CONFIGURED_LOCAL_startup-home', 'click:Send']


def environment(root, catalog_url):
    home = root / 'home with spaces'
    return {'HOME': str(home), 'NAC_HOME': str(home / 'selected nac'),
            'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8',
            'NAC_TELEMETRY': 'disabled', 'GIT_CONFIG_NOSYSTEM': '1',
            'GIT_CONFIG_GLOBAL': '/dev/null', 'BROWSER': 'none', 'MODELS_DEV_URL': catalog_url}


def prepare_profile(parent, scenario, catalog_url, *, run=None, directory=None):
    budget_check()
    if scenario not in CASES:
        raise RuntimeError('Unknown ordinary startup case')
    parent = canonical(parent)
    root = Path(tempfile.mkdtemp(prefix='nac342-xctest-' + scenario + '-', dir=parent)).resolve()
    env = environment(root, catalog_url)
    home, nac, workspace = Path(env['HOME']), Path(env['NAC_HOME']), root / 'workspace with spaces'
    nac.mkdir(parents=True, mode=0o700)
    workspace.mkdir(mode=0o700)
    if run is not None:
        capture(['/usr/bin/git', 'init', '-q', str(workspace)], directory, 'profile-git', 15, run, cwd=root, env=env)
    else:
        subprocess.run(['/usr/bin/git', 'init', '-q', str(workspace)], env=env, check=True, timeout=time_limit(15))
        budget_check()
    config, store = nac / 'config.toml', nac / 'dev.db'
    if scenario == 'invalidConfig':
        config.write_text('[broken\n')
    elif scenario == 'futureStore':
        config.write_text('[storage]\nstore_path = ' + json.dumps(str(store)) + '\n')
        with closing(sqlite3.connect(store)) as connection, connection:
            connection.execute('PRAGMA user_version=999')
    return {'root': root, 'home': home, 'nac_home': nac, 'workspace': workspace,
            'store': store, 'config': config, 'environment': env, 'scenario': scenario}


def immutable_snapshot(profile):
    result = {}
    for name in ('config', 'store'):
        path = profile[name]
        if path.exists() or path.is_symlink():
            canonical(path)
            info = path.stat()
            if not path.is_file():
                raise RuntimeError('Startup protected member is nonregular')
            result[name] = {'sha256': digest(path), 'bytes': info.st_size, 'inode': info.st_ino,
                            'mode': info.st_mode, 'mtime_ns': info.st_mtime_ns}
        else:
            result[name] = None
    result['wal_shm'] = [suffix for suffix in ('-wal', '-shm') if Path(str(profile['store']) + suffix).exists()]
    return result


def require_integrity(profile, before):
    after = immutable_snapshot(profile)
    case = profile['scenario']
    if case in ('futureStore', 'invalidConfig') and after != before:
        raise RuntimeError('Startup changed protected config/store bytes or WAL/SHM state')
    databases = []
    for path in profile['home'].rglob('*'):
        if path.is_symlink():
            raise RuntimeError('Startup profile contains an unexpected symlink')
        if path.is_file():
            with path.open('rb') as stream:
                header = stream.read(16)
            if header == b'SQLite format 3\0':
                databases.append(path)
    if case == 'invalidConfig' and databases:
        raise RuntimeError('Invalid configuration opened an alternate database')
    if case != 'invalidConfig' and databases != [profile['store']]:
        raise RuntimeError('Startup selected store is missing or an alternate database exists')
    return {'protected_before': before, 'protected_after': after, 'no_alternate_database': True}


def prepare_configuration(profile, app, manifest, product_root, test_root, harness_sha, *, run=None, directory=None, ax_witness=None):
    """Host-side only; public XCTest reads the resulting frozen file and bundle."""
    product_root = canonical(product_root)
    require_checkout(product_root, PRODUCT)
    contract = test_contract(test_root)
    app, manifest = canonical(app), canonical(manifest)
    root = canonical(profile['root'])
    if not root.name.startswith('nac342-xctest-') or profile['scenario'] not in CASES:
        raise RuntimeError('Unowned startup profile')
    relocated = root / 'Moved app folder with spaces/NAC.app'
    relocated.parent.mkdir()
    shutil.copytree(app, relocated, symlinks=True)
    proof = package_contract(contract, 'inspect_normal_package', [str(manifest), str(relocated), str(product_root)],
        dict(product_sha=PRODUCT), tests=test_root, directory=directory, name='package-relocated', run=run)
    child_environment, environment_resolution = (resolve_environment(product_root, profile, run=run, directory=directory)
        if run is not None else resolve_environment(product_root, profile))
    environment_resolution.update(test_source_sha=TEST_SOURCE,
        startup_source_sha256=TEST_FILES['StartupJourneys.swift'],
        app_launch_arguments=['--directory', str(profile['home'])],
        configuration_helper_arguments=['__desktop-configuration', '--directory', str(profile['home'])])
    config = {'schema': SCHEMA, 'scenario': profile['scenario'], 'contract_baseline': BASELINE,
              'source_sha': PRODUCT, 'test_source_sha': TEST_SOURCE, 'harness_sha': harness_sha,
              'bundle_id': proof['bundle_id'], 'fixture_root': str(profile['root']), 'app_path': str(relocated),
              'home': str(profile['home']), 'nac_home': str(profile['nac_home']), 'workspace': str(profile['workspace']),
              'expected_store': str(profile['store']), 'environment': profile['environment'],
              'child_environment': child_environment, 'environment_resolution': environment_resolution,
              'startup_source_sha256': TEST_FILES['StartupJourneys.swift'], 'engine_identity': proof['engine_identity']}
    for key in ('manifest_sha256', 'package_identity_sha256', 'engine_identity_sha256', 'build_receipt_sha256'):
        config[key] = proof[key]
    for key in ('native_sha256', 'engine_sha256', 'info_plist_sha256'):
        config[key] = proof['post_sign_receipt'][key]
    if ax_witness is not None:
        config['ax_witness'] = ax_witness
    admission = package_contract(contract, 'validate_normal_package', [config, str(manifest), str(product_root)],
        dict(product_sha=PRODUCT, test_sha=TEST_SOURCE, harness_sha=harness_sha),
        tests=test_root, directory=directory, name='package-configuration', run=run)
    encoded = (json.dumps(config, indent=2) + '\n').encode()
    if len(encoded) > 32 * 1024:
        raise RuntimeError('Startup configuration exceeds its immutable bound')
    path = profile['root'] / 'startup-config.json'
    with path.open('xb') as stream:
        stream.write(encoded)
    path.chmod(0o400)
    return config, path, admission


def remove_profile(profile, proof):
    root = canonical(profile['root'])
    if (not root.name.startswith('nac342-xctest-') or proof.get('owned_processes_settled') is not True
            or proof.get('root') != str(root)):
        raise RuntimeError('Startup cleanup ownership is unproven; preserve fixture')
    shutil.rmtree(root)
