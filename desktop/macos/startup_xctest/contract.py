"""Pure admission checks for the proposed ordinary-app XCTest contract.

No filesystem, profile, process, UI, or permission access. ALL-354 owns those
observations and must bind this contract to actual generated runner evidence.
"""
import posixpath
import re
from urllib.parse import urlsplit

SCHEMA = 'nac342-startup-xctest-v1'
CASES = ('onboarding', 'configuredLocal', 'invalidConfig', 'futureStore')
BASELINE = 'ec4f3a9a8ab2e80d98ff76ca8c536e1e41b413c8'
TEST_ID = 'StartupJourneys/testOrdinaryStartup'
FUTURE_FAILURE_CODE = 'store_schema_incompatible'
FUTURE_FAILURE_STAGE = 'startup'
FUTURE_RECOVERY_MESSAGE = (
    'The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible newer NAC app. '
    'Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected.'
)
ENVIRONMENT = {'HOME', 'NAC_HOME', 'PATH', 'LANG', 'NAC_TELEMETRY',
               'NAC_ORCHESTRATION', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL',
               'BROWSER', 'MODELS_DEV_URL'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def require_future_recovery(failure, visible_message):
    """Assert356's nominated typed v1 record and unique shell-owned message.

    Caller must independently bind authentic producer/UI observations to the
    exact candidate. This never classifies logs, observes a process, or proves
    source inclusion, profile integrity, no activation, cleanup, or paint.
    """
    require(failure.get('kind') == 'failed' and type(failure.get('version')) is int
            and failure['version'] == 1 and failure.get('code') == FUTURE_FAILURE_CODE
            and failure.get('stage') == FUTURE_FAILURE_STAGE,
            'Missing nominated serving-startup typed future-schema failure')
    require(visible_message == FUTURE_RECOVERY_MESSAGE,
            'Missing exact unique future-schema recovery message')


def path(value):
    require(isinstance(value, str) and value.startswith('/') and len(value) <= 4096
            and not any(ord(c) < 32 or ord(c) == 127 for c in value)
            and posixpath.normpath(value) == value, 'Noncanonical absolute path')
    return value


def child(value, parent):
    value, parent = path(value), path(parent)
    require(value.startswith(parent + '/'), 'Path escapes owned fixture root')
    return value


def hexadecimal(value, width):
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{' + str(width) + '}', value),
            'Invalid immutable digest')


def validate(config, receipt):
    """Validate declarations only; returned scope never means runtime passed."""
    require(config.get('schema') == SCHEMA and config.get('scenario') in CASES,
            'Unexpected startup contract')
    require(config.get('contract_baseline') == BASELINE, 'Acceptance baseline changed')
    for key, width in [('source_sha', 40), ('native_sha256', 64), ('engine_sha256', 64),
                       ('info_plist_sha256', 64), ('build_receipt_sha256', 64),
                       ('startup_source_sha256', 64)]:
        hexadecimal(config.get(key), width)
    root = path(config['fixture_root'])
    require(posixpath.basename(root).startswith('nac342-xctest-'), 'Unowned fixture root')
    app = child(config['app_path'], root)
    require(app.endswith('/Moved app folder with spaces/NAC.app'), 'Unexpected ordinary bundle')
    home = child(config['home'], root)
    nac = child(config['nac_home'], home)
    child(config['workspace'], root)
    child(config['expected_store'], nac)
    environment = config['environment']
    require(isinstance(environment, dict) and set(environment) == ENVIRONMENT,
            'Launch environment must be the exact fixture allowlist')
    require(all(isinstance(value, str) and '\0' not in value and len(value) <= 4096
                for value in environment.values()), 'Invalid fixture environment')
    require(environment['HOME'] == home and environment['NAC_HOME'] == nac
            and environment['NAC_ORCHESTRATION'] == '0'
            and environment['NAC_TELEMETRY'] == 'disabled'
            and environment['GIT_CONFIG_NOSYSTEM'] == '1'
            and environment['GIT_CONFIG_GLOBAL'] == '/dev/null'
            and environment['BROWSER'] == 'none'
            and environment['PATH'] == '/usr/bin:/bin:/usr/sbin:/sbin'
            and environment['LANG'] == 'en_US.UTF-8', 'Fixture isolation differs')
    catalog = urlsplit(environment['MODELS_DEV_URL'])
    require(catalog.scheme == 'http' and catalog.hostname == '127.0.0.1'
            and catalog.port is not None and catalog.port > 0 and not catalog.username
            and not catalog.password and not catalog.query and not catalog.fragment
            and catalog.path == '/models-dev', 'Catalog must be the owned loopback fixture')
    require(receipt.get('source_head') == config['source_sha']
            and receipt.get('source_dirty') is False
            and receipt.get('engine_identity', {}).get('source_revision') == config['source_sha']
            and receipt.get('mode') == 'app-build'
            and receipt.get('normal_startup') is True
            and receipt.get('preview_definitions_excluded') is True
            and receipt.get('smoke_instrumentation') is False,
            'Candidate is not a clean ordinary LOCAL_APP build')
    flags = receipt.get('compiler_flags', [])
    definitions = [flags[index + 1] for index, flag in enumerate(flags[:-1]) if flag == '-D']
    require(definitions == ['LOCAL_APP'] and flags[-1:] != ['-D'], 'Unexpected compilation flags')
    require(config.get('bundle_id') in ('ai.arcee.nac.local-development', 'ai.arcee.nac.dev')
            and receipt.get('bundle_identifier', config.get('bundle_id')) == config.get('bundle_id'),
            'Unexpected development bundle identity')
    require(all(receipt.get(key) == config[key] for key in
                ('native_sha256', 'engine_sha256', 'info_plist_sha256')),
            'Declared bundle hashes differ')
    # Instance instrumentation is absent in ec4; successors must explicitly
    # remain ordinary if the additional field exists.
    require(receipt.get('instance_smoke_instrumentation', False) is False,
            'Instance smoke cannot qualify ordinary paint')
    return {'scope': 'declaration_admission_only', 'scenario': config['scenario'],
            'actual_ui_run': False, 'paint_qualified': False}
