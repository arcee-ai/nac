"""Controls an already separately admitted LOCAL_APP recovery-smoke episode.

This does not build or launch an app, admit Aqua, create a profile, or establish
real OS sleep/trusted input. The external owner must launch the exact qualified
binary on its disposable profile, retain custody, and always stop/reap/clean it.
"""
from pathlib import Path
import argparse
import json
import os
import stat
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['arm', 'observe'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--case', choices=[
        'wake-before-release', 'release-while-suspended', 'sleep-before-base',
        'common-failure', 'stop-pending'], required=True)
    args = parser.parse_args()
    root = args.root
    mode = root.lstat()
    if (not root.name.startswith('nac-all349-profile-') or root.is_symlink()
            or mode.st_uid != os.getuid() or not stat.S_ISDIR(mode.st_mode)
            or mode.st_mode & 0o077):
        raise SystemExit('Expected externally owned private disposable fixture root')
    control, evidence = root / 'control', root / 'recovery.json'
    control_mode = control.lstat()
    if (control.is_symlink() or not stat.S_ISDIR(control_mode.st_mode)
            or control_mode.st_uid != os.getuid() or control_mode.st_mode & 0o077):
        raise SystemExit('Expected private control directory')

    def signal(name):
        with (control / name).open('x'):
            pass

    def read():
        try:
            return json.loads(evidence.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def wait(predicate, seconds=3):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            row = read()
            if row.get('profile_open_timeout'):
                raise RuntimeError('Profile fixture barrier timed out; no retry authorized')
            if predicate(row):
                return row
            time.sleep(0.02)
        raise RuntimeError('Bounded profile observation expired; external owner retains cleanup')

    if args.phase == 'arm':
        signal('profile-open-hold')
        if args.case == 'sleep-before-base':
            signal('sleep-notification')
        return
    row = wait(lambda value: value.get('profile_open_pending') is True)
    if row.get('profile_storage', {}).get('selected'):
        raise RuntimeError('Product profile installed before delayed open completed')
    if args.case == 'common-failure':
        signal('profile-open-common-failure')
        wait(lambda value: value.get('profile_storage', {}).get('retired') is True)
        signal('profile-open-release')
        row = wait(lambda value: value.get('profile_open_completed_calls') == 1)
        sequence = row['publication_sequence']
        row = wait(lambda value: value.get('publication_sequence', 0) >= sequence + 2)
    elif args.case == 'stop-pending':
        signal('stop')
        row = wait(lambda value: value.get('engine_reaped') is True)
        if not row.get('profile_storage', {}).get('retired'):
            raise RuntimeError('Stop did not retire pending initialization')
    else:
        if args.case != 'sleep-before-base':
            signal('sleep-notification')
        row = wait(lambda value: value.get('recovery', {}).get('sleeping') is True)
        if args.case == 'sleep-before-base' and not row.get('sleep_before_base_url'):
            raise RuntimeError('Did not exercise sleep before baseURL; cannot claim that case')
        if args.case == 'release-while-suspended':
            signal('profile-open-release')
            row = wait(lambda value: value.get('profile_open_completed_calls') == 1)
            if row.get('bridge', {}).get('ready'):
                raise RuntimeError('A document bridge activated while suspended')
            signal('wake-notification')
        else:
            signal('wake-notification')
            row = wait(lambda value: value.get('recovery', {}).get('sleeping') is False
                       and value.get('profile_open_pending') is True)
            if row.get('bridge', {}).get('ready'):
                raise RuntimeError('A product bridge activated before profile completion')
            signal('profile-open-release')
        row = wait(lambda value: value.get('bridge', {}).get('ready') is True)
        storage = row.get('profile_storage', {})
        if (not storage.get('selected') or not storage.get('available')
                or not storage.get('persistent') or row.get('profile_open_calls') != 1
                or storage.get('profile') != row.get('expected_profile')
                or storage.get('website_store') != row.get('expected_website_store')):
            raise RuntimeError('Current document did not join the one selected persistent profile')
        signal('capture')
        row = wait(lambda value: value.get('document', {}).get('storage_capability') is True)
        requests = row.get('document', {}).get('requests')
        if not isinstance(requests, list):
            raise RuntimeError('Current document request evidence is unavailable')
        if any(request.get('method') not in ['GET', 'HEAD']
               and not (request.get('method') == 'POST'
                        and request.get('path') == '/providers/models')
               for request in requests):
            raise RuntimeError('Restoration caused an unexpected backend mutation')
    if args.case in ['common-failure', 'stop-pending']:
        storage = row.get('profile_storage', {})
        if storage.get('selected') or row.get('bridge', {}).get('ready'):
            raise RuntimeError('Late storage/bridge installed after retirement')
    (root / 'profile-controller-result.json').write_text(json.dumps({
        'case': args.case, 'callbackInjectedSleepWake': True, 'observation': row,
        'fullAcceptance': False, 'externalCleanupStillRequired': True,
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
