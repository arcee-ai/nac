#!/usr/bin/env python3
"""One separately admitted actual-app offline local-provider episode.

No host network setting, real credential, browser handoff or whole-machine
isolation claim. Imports are inert; only main acquires app/console resources.
"""
import json
from pathlib import Path
import subprocess
import time
import uuid

from external_auth_smoke import (auth_arguments, close_launch, digest,
                                 relocated_app, require_isolated_host, require_terminal)


def controls():
    return {f'{phase}-{kind}-{scheme}' for phase in ('before', 'after')
            for kind in ('native', 'wk-fetch', 'wk-navigation', 'rust-provider')
            for scheme in ('http', 'https')}


def require_offline(record):
    def need(value):
        if not value:
            raise AssertionError('Offline qualification receipt incomplete or outside scope')

    result = record.get('offline_provider')
    need(isinstance(result, dict))
    need(set(result) == {'scope', 'offline_supported_local_provider', 'whole_machine_offline',
        'physical_input_qualified', 'real_vendor_qualified', 'setup_saved_read_back', 'streamed_response',
        'persisted_transcript', 'no_managed_login', 'external_open_attempts', 'store_bound_through_reload', 'binding', 'network'})
    need(result['scope'] == 'ordinary-production-engine-local-API-key; DOM-driven; HTTP(S)-outage-only')
    for key in ('offline_supported_local_provider', 'setup_saved_read_back', 'streamed_response',
                'persisted_transcript', 'no_managed_login', 'store_bound_through_reload'):
        need(result.get(key) is True)
    for key in ('whole_machine_offline', 'physical_input_qualified', 'real_vendor_qualified'):
        need(result.get(key) is False)
    need(type(result.get('external_open_attempts')) is int and result['external_open_attempts'] == 0)
    binding = result.get('binding', {})
    need(set(binding) == {'launch', 'view', 'document', 'initial_document', 'engine_pid'})
    need(binding.get('launch') == record.get('launch_incarnation'))
    need(binding.get('engine_pid') == record.get('engine_pid'))
    for key in ('launch', 'view', 'document', 'initial_document'):
        need(isinstance(binding.get(key), str))
        need(uuid.UUID(binding[key]).int != 0)
    need(binding['initial_document'] != binding['document'])
    boundary = result.get('network', {})
    need(set(boundary) == {'scope', 'whole_machine_offline', 'failover_allowed', 'literal_loopback_bypass', 'baseline_local_reachable', 'phases', 'observations'})
    need(boundary.get('scope') == 'declared-app-engine-HTTP(S)-only')
    need(boundary.get('whole_machine_offline') is False)
    need(boundary.get('failover_allowed') is False and boundary.get('literal_loopback_bypass') is True)
    need(boundary.get('baseline_local_reachable') is True and boundary.get('phases') == ['after', 'before'])
    facts = boundary.get('observations', {})
    need(set(facts) == {'controls', 'key_accepted', 'key_rejected', 'authenticated_responses', 'unlabelled_proxy_rejections'})
    rows = facts.get('controls')
    need(isinstance(rows, list) and len(rows) == len(controls()))
    seen = set()
    for row in rows:
        need(isinstance(row, dict) and set(row) == {'control', 'proxy_rejections', 'direct_success'})
        label = row.get('control')
        need(isinstance(label, str) and label in controls() and label not in seen)
        seen.add(label)
        need(type(row.get('proxy_rejections')) is int and 1 <= row['proxy_rejections'] <= 8)
        need(row.get('direct_success') is False)
    need(seen == controls())
    for key in ('key_accepted', 'key_rejected', 'authenticated_responses', 'unlabelled_proxy_rejections'):
        need(type(facts.get(key)) is int and facts[key] >= 0)
    need(facts['key_rejected'] >= 2 and facts['key_accepted'] >= 1)
    need(facts['authenticated_responses'] >= 1)
    need(type(record.get('provider_responses')) is int and record['provider_responses'] == facts['authenticated_responses'])
    # Offline failures/success do not retain arbitrary transport/credential dumps.
    need(not any(key in record for key in ('engine_log', 'engine_log_after_shutdown', 'dom')))


def require_build(app):
    receipt = json.loads((app / 'Contents/Resources/build-receipt.json').read_text())
    engine = app / 'Contents/Resources/nac-web'
    build = json.loads(subprocess.check_output([str(engine), '__desktop-identity'], text=True, timeout=5))
    assert set(build) == {'product_version', 'build_id', 'source_revision', 'track'}
    assert not build['build_id'].startswith('native-auth-fixture-v1-')
    assert receipt['engine_identity'] == build and receipt['source_head'] == build['source_revision']
    assert receipt['mode'] == 'smoke-build' and receipt['source_dirty'] is False
    assert receipt['smoke_instrumentation'] is True and receipt['normal_startup'] is False
    assert 'PREVIEW_SMOKE' in receipt['compiler_flags'] and 'NATIVE_AUTH_FIXTURE' not in receipt['compiler_flags']
    assert {'OfflineProviderPolicy.swift', 'OfflineNetworkFence.swift', 'OfflineWebProbe.swift',
            'OfflineProviderSmoke.swift'} <= {Path(p).name for p in receipt['native_source_files']}
    assert digest(engine) == receipt['engine_sha256']
    assert digest(app / 'Contents/MacOS/NACPreview') == receipt['native_sha256']
    return build, receipt


def main(arguments=None):
    import sys
    app, output, observer = auth_arguments(sys.argv[1:] if arguments is None else arguments)
    console = require_isolated_host(observer)
    build, receipt = require_build(app)
    output.mkdir(parents=True, exist_ok=False)
    evidence = output / 'offline-provider.json'
    (output / 'metadata.json').write_text(json.dumps({'session': console, 'build_receipt': receipt,
        'scope': 'ordinary-engine/local-provider; DOM-driven; declared HTTP(S) outage only',
        'whole_machine_offline': False, 'physical_input_qualified': False,
        'real_vendor_qualified': False}, indent=2) + '\n')
    with relocated_app(app, evidence, 'nac-offline-provider-app-') as (relocated, custody):
        log = (output / 'launch.log').open('wb')
        launch = None
        primary = None
        try:
            custody.update(launched=True, settled=False)
            launch = subprocess.Popen(['/usr/bin/open', '-n', '-W', str(relocated), '--args',
                '--smoke-output', str(evidence), '--smoke-scenario', 'offline-api-key'],
                stdout=log, stderr=subprocess.STDOUT)
            end = time.monotonic() + 300
            while launch.poll() is None and time.monotonic() < end:
                time.sleep(.1)
            if launch.poll() is None:
                raise TimeoutError('Offline app original deadline expired; no retry')
            if launch.wait(timeout=0) != 0 or time.monotonic() > end:
                raise AssertionError('Offline app did not complete under its original clock')
            record = json.loads(evidence.read_text())
            require_terminal(record, 'offline-api-key', build)
            require_offline(record)
        except BaseException as error:
            primary = error
            raise
        finally:
            close_launch(launch, log, primary)
        custody['settled'] = True
    print('Scoped offline local-provider episode completed; no whole-machine/vendor claim')


if __name__ == '__main__':
    main()
