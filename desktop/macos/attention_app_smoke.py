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
import sys
import tempfile
import time
from urllib.parse import quote

sys.dont_write_bytecode = True

from instance_contract import digest
from instance_smoke import AppJourney, engine_settled, verify_embedded_assets, wait_for, remaining
from attention_reset_readout import ResetReadout
from attention_fixture_cleanup import cleanup_fixture, write_input
from quit_fixture import QuitProvider, TRANSCRIPT, request
from attention_fixture_control import AttentionControl, console_facts, require_console
from attention_feed_build import source_binding


def canonical_chat_route(session):
    # Match routes.session/encodeURIComponent at this reviewed revision. The
    # future cross-language characterization must compare the REAL route builder.
    assert isinstance(session, str) and session and len(session.encode('utf-8')) <= 512
    return '/session/' + quote(session, safe="-_.!~*'()") + '/insights'


class AttentionJourney(AppJourney):
    def __init__(self, *args):
        self.custody = AttentionControl()
        self.engine_pid = None
        require_console(console_facts())
        super().__init__(*args)

    def launch(self):
        self.custody.check(self, launch=True)
        super().launch()
        if self.identity is None:
            def bind_owner():
                try:
                    record = json.loads(self.output.read_text())
                except (FileNotFoundError, json.JSONDecodeError):
                    return False
                apps = self.observe()['apps']
                if len(apps) != 1 or record.get('app_pid') != apps[0]['pid']:
                    return False
                if type(record.get('window_number')) is not int or record['window_number'] <= 0:
                    return False
                self.identity = apps[0]
                self.custody.bind(self, record)
                self.engine_pid = record.get('engine_pid') or None
                return True
            wait_for('Exact launched attention owner', bind_owner, timeout=12)
        self.custody.check(self)

    def stage(self, stage, timeout=None, *, deadline=None):
        if timeout is None and deadline is None:
            result = super().stage(stage)
        else:
            result = super().stage(stage, timeout=50 if timeout is None else timeout, deadline=deadline)
        self.engine_pid = result.get('engine_pid') or self.engine_pid
        if deadline is None:
            self.custody.check(self)
        else:
            self.custody.check(self, deadline=deadline)
            remaining(deadline, 2)
        return result


def run_contract(bundle, destination, observer, source_ref):
    binding = source_binding(Path(__file__).resolve().parents[2], source_ref)
    require_console(console_facts())
    bundle, destination, observer = (Path(value).resolve() for value in (bundle, destination, observer))
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    build = json.loads((bundle / 'Contents/Resources/build-receipt.json').read_text())
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    assert build['source_head'] == head == source_ref == build['engine_identity']['source_revision']
    assert build['attention_smoke_instrumentation'] and build['normal_startup']
    assert build['native_sha256'] == digest(bundle / 'Contents/MacOS/NACPreview')
    assert build['engine_sha256'] == digest(bundle / 'Contents/Resources/nac-web')
    for source, expected in build['native_source_files'].items():
        assert digest(source) == expected, source
    root = Path(tempfile.mkdtemp(prefix='nac-attention-app-', dir=destination)).resolve()
    owned = ResetReadout(root)
    try:
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
        evidence = dict(build_receipt=build, source_binding=binding, actual_local_app=True, system_wk=True,
            native_os_delivery=False, trusted_input=False, hidden_cpu_qualified=False, cases=[])
        evidence['os_version'] = subprocess.check_output(['/usr/bin/sw_vers', '-productVersion'], text=True).strip()
        with Path('/System/Library/Frameworks/WebKit.framework/Resources/Info.plist').open('rb') as stream:
            evidence['system_webkit_version'] = plistlib.load(stream)['CFBundleVersion']
        evidence['fixture_sources'] = {str(Path(__file__).resolve()): digest(__file__),
            **{str(Path('desktop/macos') / name): digest(Path('desktop/macos') / name) for name in
               ('AttentionFixtureCleanup.swift', 'AttentionFixtureRoot.swift', 'attention_fixture_cleanup.py',
                'attention_reset_readout.py', 'attention_fixture_control.py', 'attention_feed_build.py')}}
        evidence['cleanup_helper_sha256'] = digest(observer.parent / 'AttentionFixtureCleanup')
        sequence = 0
    except BaseException:
        owned.close()
        raise
    def command(journey, action, deadline=None, **payload):
        nonlocal sequence
        sequence += 1
        name = f'attention-{sequence:04d}'
        command_deadline = None if deadline is None else min(deadline, time.monotonic() + 2)
        remaining(command_deadline, 2)
        if action == 'inspect-chat': payload['sample'] = name
        if command_deadline is None:
            journey.custody.publish(journey, name, action, **payload)
        else:
            journey.custody.publish(journey, name, action, deadline=command_deadline, **payload)
            remaining(command_deadline, 2)
        if action == 'finish':
            return  # Stop can retire the window before a stage/focus readback.
        if command_deadline is None:
            return journey.stage(name)
        result = journey.stage(name, timeout=remaining(command_deadline, 2), deadline=command_deadline)
        remaining(command_deadline, 2)
        return result
    def native(journey, predicate, label):
        def poll():
            journey.custody.check(journey)
            state = journey.read()
            return state if predicate(state) else None
        return wait_for(label, poll, timeout=20)
    def chat_ready(journey, session, deadline):
        route = canonical_chat_route(session)
        last = None
        while time.monotonic() < deadline:
            sampled = command(journey, 'inspect-chat', deadline=deadline,
                session=session, route=route, user=TRANSCRIPT, assistant=TRANSCRIPT)
            last = sampled.get('chat_readiness', {})
            assert last.get('sample') == sampled['stage'], 'Stale chat sample'
            assert not last.get('error'), 'Shared chat reports an error'
            assert last.get('document') == sampled.get('document_binding'), 'Chat document changed'
            assert last.get('generation') == sampled['attention']['generation'], 'Chat generation changed'
            remaining(deadline, 2)
            if last.get('ready') is True:
                assert last.get('route') == route and last.get('session') == session
                assert sampled['same_view'] and sampled['same_engine'] and sampled['window_visible']
                return sampled
            time.sleep(min(0.05, max(0, deadline - time.monotonic())))
        raise TimeoutError('Canonical chat did not render within original20s window: ' + json.dumps(last))

    def finish(journey):
        prior = journey.read()['engine_pid']
        command(journey, 'finish')
        stopped = wait_for('Native notification shutdown', lambda: (state if (state := journey.read()).get('stopped') else None), timeout=28)
        assert stopped['passed'] and stopped['center']['retired']
        assert stopped['attention']['observer_connections'] == stopped['attention']['observer_draining'] == 0
        wait_for('App exited', lambda: not journey.observe()['apps'], timeout=10)
        wait_for('Exact engine stopped', lambda: engine_settled(moved, prior), timeout=25)
        return stopped
    try:
        (destination / 'first').mkdir(exist_ok=True)
        (destination / 'second').mkdir(exist_ok=True)
        first = AttentionJourney(moved, destination / 'first/native.json', profile, environment, store, observer)
        journeys.append(first); first.launch(); ready = first.stage('ready')
        write_input(owned, dict(receipt=ready['ready_receipt'], home=str(profile)))
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
        first.chat_deadline = time.monotonic() + 20
        first.guard_focus(deadline=first.chat_deadline)
        command(first, 'click', deadline=first.chat_deadline)
        opened = chat_ready(first, session, first.chat_deadline)
        evidence['rendered_chat'] = opened['chat_readiness']
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
        second = AttentionJourney(moved, destination / 'second/native.json', profile, environment, store, observer)
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
        try:
            errors = []
            for journey in reversed(journeys):
                try:
                    if journey.observe()['apps']:
                        sequence += 1
                        journey.custody.cleanup(journey, f'attention-{sequence:04d}')
                        wait_for('Failure cleanup app exit', lambda: not journey.observe()['apps'], timeout=28)
                    assert journey.engine_pid is not None, 'No exact engine cleanup observation'
                    wait_for('Failure cleanup exact engine exit', lambda: engine_settled(moved, journey.engine_pid), timeout=25)
                    journey.log.close()
                except Exception as error:
                    errors.append(str(error))
                finally:
                    journey.custody.close()
                    journey.log.close()
            provider.close()
            evidence['cleanup_errors'] = errors
            if not errors:
                try:
                    cleanup = observer.parent / 'AttentionFixtureCleanup'
                    evidence['website_cleanup'] = cleanup_fixture(owned, cleanup, environment)
                    evidence['private_root_removed'] = True
                except Exception as error:
                    errors.append('Owned website/profile cleanup: ' + str(error))
            if errors:
                evidence['passed'] = False
            try:
                assert source_binding(Path(__file__).resolve().parents[2], source_ref) == binding
            except Exception as error:
                evidence['passed'] = False
                errors.append('Final source binding: ' + str(error))
            (destination / 'summary.json').write_text(json.dumps(evidence, indent=2) + '\n')
            assert not errors, errors
        finally:
            owned.close()



if __name__ == '__main__':
    assert len(sys.argv) == 5, 'attention_app_smoke.py APP OUTPUT INSTANCE_OBSERVER FULL_SOURCE_REF'
    run_contract(*sys.argv[1:])
