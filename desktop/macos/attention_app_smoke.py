#!/usr/bin/env python3
"""Actual LOCAL_APP/system WK with a mock notification center, never OS banners.

Only execute under a separately admitted Aqua/browser allocation. This driver
owns an isolated profile, exact bundle, bounded controls and cleanup. It cannot
qualify signed delivery, trusted IME input or hidden-renderer CPU performance.
"""
import json
import os
import plistlib
from pathlib import Path
import shutil
import subprocess
import tempfile

from instance_contract import digest
from instance_smoke import AppJourney, engine_settled, verify_embedded_assets, wait_for
from quit_fixture import QuitProvider, TRANSCRIPT, request


def run_contract(bundle, destination, observer):
    bundle, destination, observer = (Path(value).resolve() for value in (bundle, destination, observer))
    destination.mkdir(parents=True, exist_ok=True)
    build = json.loads((bundle / 'Contents/Resources/build-receipt.json').read_text())
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    assert build['source_head'] == head == build['engine_identity']['source_revision']
    assert build['attention_smoke_instrumentation'] and build['normal_startup']
    assert build['native_sha256'] == digest(bundle / 'Contents/MacOS/NACPreview')
    assert build['engine_sha256'] == digest(bundle / 'Contents/Resources/nac-web')
    for source, expected in build['native_source_files'].items():
        assert digest(source) == expected, source
    root = Path(tempfile.mkdtemp(prefix='nac-attention-app-', dir=destination)).resolve()
    profile = root / 'profile'
    profile.mkdir(mode=0o700)
    moved = root / 'Relocated app with spaces' / bundle.name
    shutil.copytree(bundle, moved)
    provider = QuitProvider(profile)
    environment = dict(HOME=str(profile), NAC_HOME=str(profile / 'nac-home'),
        PATH='/usr/bin:/bin:/usr/sbin:/sbin', LANG='en_US.UTF-8', BROWSER='none',
        NAC_TELEMETRY='disabled', NAC_ORCHESTRATION='0', GIT_CONFIG_NOSYSTEM='1',
        GIT_CONFIG_GLOBAL='/dev/null', MODELS_DEV_URL=provider.endpoint + '/models-dev',
        OPENAI_API_KEY='attention-fixture-dummy-only')
    subprocess.run(['/usr/bin/git', 'init', '--quiet', '--initial-branch=main', str(profile)],
                   env=environment, check=True, timeout=5)
    store = profile / 'selected store.db'
    journeys = []
    evidence = dict(build_receipt=build, actual_local_app=True, system_wk=True,
        native_os_delivery=False, trusted_input=False, hidden_cpu_qualified=False, cases=[])
    evidence['os_version'] = subprocess.check_output(['/usr/bin/sw_vers', '-productVersion'], text=True).strip()
    with Path('/System/Library/Frameworks/WebKit.framework/Resources/Info.plist').open('rb') as stream:
        evidence['system_webkit_version'] = plistlib.load(stream)['CFBundleVersion']
    evidence['fixture_sources'] = {str(Path(__file__).resolve()): digest(__file__),
        'desktop/macos/AttentionFixtureCleanup.swift': digest('desktop/macos/AttentionFixtureCleanup.swift')}
    evidence['cleanup_helper_sha256'] = digest(observer.parent / 'AttentionFixtureCleanup')
    sequence = 0
    def command(journey, action, **payload):
        nonlocal sequence
        sequence += 1
        name = f'attention-{sequence:04d}'
        (journey.control / (name + '.json')).write_text(json.dumps(dict(action=action, **payload)))
        return journey.stage(name)
    def native(journey, predicate, label):
        return wait_for(label, lambda: (state if predicate(state := journey.read()) else None), timeout=20)
    def finish(journey):
        prior = journey.read()['engine_pid']
        command(journey, 'finish')
        stopped = wait_for('Native notification shutdown', lambda: (state if (state := journey.read()).get('stopped') else None), timeout=28)
        assert stopped['passed'] and stopped['center']['retired']
        assert stopped['attention']['observer_connections'] == stopped['attention']['observer_draining'] == 0
        wait_for('App exited', lambda: not journey.observe()['apps'], timeout=10)
        wait_for('Exact engine stopped', lambda: engine_settled(moved, prior), timeout=25)
        journey.restore_prior()
        return stopped
    try:
        (destination / 'first').mkdir(exist_ok=True)
        (destination / 'second').mkdir(exist_ok=True)
        first = AppJourney(moved, destination / 'first/native.json', profile, environment, store, observer)
        journeys.append(first); first.launch(); ready = first.stage('ready')
        (root / 'cleanup-input.json').write_text(json.dumps(dict(receipt=ready['ready_receipt'], home=str(profile))))
        assert not ready['attention']['enabled'] and ready['attention']['observer_connections'] == 0
        assert ready['center']['permission_requests'] == 0
        evidence['embedded_assets'] = verify_embedded_assets(ready['base_url'])
        command(first, 'enable')
        enabled = native(first, lambda s: s['attention']['enabled'] and not s['attention']['saving'], 'Durable opt-in and cutoff')
        assert enabled['attention']['cutoff'] and enabled['center']['permission_requests'] == 1
        command(first, 'close')
        assert not first.read()['window_visible']
        endpoint = ready['base_url'].rstrip('/')
        project = request(endpoint, '/projects', dict(name='Native completion fixture', cwd=str(profile)))
        session = request(endpoint, '/sessions', dict(behavior='direct', project_id=project['project_id'],
            model='gpt-5.6-sol', backend='openai-responses', base_url=provider.endpoint,
            api_key_env='OPENAI_API_KEY'))['metadata']['session_id']
        request(endpoint, '/sessions/' + session + '/runs', dict(prompt=TRANSCRIPT))
        accounted = native(first, lambda s: s['attention']['unread'] == 1 and s['attention']['receipts'] == 0 and s['center']['adds'] == 1,
                           'Hidden committed completion accounted once')
        assert accounted['center']['titles'] == ['Request completed'] and accounted['dock'] in ('1', '?')
        assert accounted['center']['foreground_delivery_allowed']
        first.guard_focus()
        command(first, 'click')
        opened = native(first, lambda s: s.get('route') == '/session/' + session, 'Click opens canonical shared chat')
        assert opened['same_view'] and opened['same_engine'] and opened['window_visible']
        native(first, lambda s: not s['center']['foreground_delivery_allowed'], 'Visible focused workspace suppresses foreground delivery')
        command(first, 'draft', text='retained native response draft')
        command(first, 'close'); first.launch()
        native(first, lambda s: s['window_visible'], 'Existing window reopened')
        command(first, 'assert-draft', text='retained native response draft')
        command(first, 'quit')
        native(first, lambda s: s['quit_confirming'], 'Owned native Quit confirmation')
        command(first, 'cancel')
        cancelled = native(first, lambda s: not s['quit_confirming'], 'Cancel retains owners')
        assert cancelled['same_engine'] and cancelled['same_view'] and cancelled['attention']['enabled']
        evidence['cases'].append(dict(name='close-click-shared-chat-draft-cancel', state=cancelled))
        saved_frontier = cancelled['attention']['frontier']
        evidence['cases'].append(dict(name='first-stop', state=finish(first)))
        second = AppJourney(moved, destination / 'second/native.json', profile, environment, store, observer)
        journeys.append(second); second.launch(); second.stage('ready')
        restored = native(second, lambda s: s['attention']['enabled'] and not s['attention']['saving'], 'Cold saved opt-in')
        assert restored['center']['permission_requests'] == 0 and restored['center']['adds'] == 0
        assert restored['attention']['frontier'] == saved_frontier and restored['attention']['unread'] == 1
        command(second, 'reset')
        reset = native(second, lambda s: not s['attention']['enabled'] and not s['attention']['saving'], 'Native-only durable reset')
        assert reset['attention']['observer_connections'] == 0 and reset['dock'] == ''
        evidence['cases'].append(dict(name='cold-restore-no-prompt-replay-and-reset', state=reset))
        evidence['cases'].append(dict(name='second-stop', state=finish(second)))
        assert provider.requests == ['transcript'] and not provider.errors, provider.requests
        evidence['passed'] = True
    except Exception as error:
        evidence.update(passed=False, error=str(error), fixture_retained=str(root))
        raise
    finally:
        errors = []
        for journey in reversed(journeys):
            try:
                if journey.observe()['apps']:
                    command(journey, 'finish')
                    wait_for('Failure cleanup app exit', lambda: not journey.observe()['apps'], timeout=28)
                journey.log.close()
            except Exception as error:
                errors.append(str(error))
        provider.close()
        evidence['cleanup_errors'] = errors
        if not errors and (root / 'cleanup-input.json').exists():
            try:
                cleanup = observer.parent / 'AttentionFixtureCleanup'
                subprocess.run([str(cleanup), str(root)], check=True, timeout=15)
                evidence['website_cleanup'] = json.loads((root / 'cleanup-result.json').read_text())
                assert evidence['website_cleanup']['root'] == str(root)
                shutil.rmtree(root)
                evidence['private_root_removed'] = not root.exists()
            except Exception as error:
                errors.append('Owned website/profile cleanup: ' + str(error))
        if errors:
            evidence['passed'] = False
        (destination / 'summary.json').write_text(json.dumps(evidence, indent=2) + '\n')
        assert not errors, errors


if __name__ == '__main__':
    import sys
    assert len(sys.argv) == 4, 'attention_app_smoke.py APP OUTPUT INSTANCE_OBSERVER'
    run_contract(*sys.argv[1:])
