"""Read-only console preflight for the owned ALL-343 actual-app fixture only."""
import json
import os
import plistlib
import subprocess


def blocked_surface(value):
    normalized = ''.join(value.casefold().split()) if isinstance(value, str) else ''
    return any(name in normalized for name in ('loginwindow', 'screensaver', 'lockscreen'))


def console_refusals(state):
    """Missing optional lock bits stay unknown; independent critical facts must agree."""
    reasons = []
    if state.get('errors'):
        reasons.append('Console observation failed')
    uid = state.get('runner_uid')
    if type(uid) is not int or uid <= 0 or any(
            type(state.get(key)) is not int or state[key] != uid
            for key in ('runner_euid', 'console_uid', 'frontmost_uid')):
        reasons.append('Runner, console and frontmost ownership must be known and equal')
    root = state.get('root')
    rows = state.get('sessions')
    quartz = state.get('quartz')
    if not isinstance(root, dict) or root.get('IOConsoleLocked') is not False:
        reasons.append('Root console lock must be explicitly false')
    if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) for row in rows):
        reasons.append('IOKit sessions unavailable')
        rows = []
    if any(type(row.get('kCGSSessionOnConsoleKey')) is not bool for row in rows):
        reasons.append('IOKit console membership unknown')
    active = [row for row in rows if row.get('kCGSSessionOnConsoleKey') is True]
    if len(active) != 1 or active[0].get('kCGSessionLoginDoneKey') is not True or (
            type(active[0].get('kCGSSessionUserIDKey')) is not int or active[0]['kCGSSessionUserIDKey'] != uid):
        reasons.append('Exactly one same-user logged-in IOKit console required')
    if not isinstance(quartz, dict):
        quartz = {}
    session = quartz.get('session')
    if not isinstance(session, dict):
        session = {}
    if quartz.get('session_available') is not True or session.get('on_console') is not True or (
            session.get('login_done') is not True or type(session.get('uid')) is not int or session['uid'] != uid):
        reasons.append('Same-user logged-in Quartz console required')
    if type(quartz.get('screen_count')) is not int or quartz['screen_count'] < 1:
        reasons.append('Quartz display unavailable')
    locks = [root.get('CGSSessionScreenIsLocked')] if isinstance(root, dict) else []
    locks += [row.get('CGSSessionScreenIsLocked') for row in rows] + [session.get('screen_is_locked')]
    if any(value is not None and value is not False for value in locks):
        reasons.append('Explicit or malformed session lock signal')
    front = quartz.get('frontmost')
    if not isinstance(front, dict) or any(not isinstance(front.get(key), str) or not front[key]
            or blocked_surface(front[key]) for key in ('bundle', 'name')) or (
            type(front.get('pid')) is not int or front['pid'] <= 0):
        reasons.append('Known non-lockscreen frontmost application required')
    windows = quartz.get('windows')
    if quartz.get('window_list_available') is not True or not isinstance(windows, list) or not windows:
        reasons.append('On-screen Quartz window metadata unavailable')
    elif any(not isinstance(window, dict) or not isinstance(window.get('owner'), str)
             or not window['owner'] or blocked_surface(window['owner'])
             or type(window.get('pid')) is not int or window['pid'] <= 0
             or window.get('on_screen') is not True or type(window.get('layer')) is not int for window in windows):
        reasons.append('Unknown window metadata or lockscreen/screensaver window')
    return reasons


def console_state(observer):
    state = dict(runner_uid=os.getuid(), runner_euid=os.geteuid(), errors=[])
    try:
        tree = plistlib.loads(subprocess.check_output(
            ['/usr/sbin/ioreg', '-n', 'Root', '-d1', '-a'], timeout=4))
        roots = tree if isinstance(tree, list) else [tree]
        assert len(roots) == 1 and isinstance(roots[0], dict) and roots[0].get('IORegistryEntryName') == 'Root'
        root = roots[0]
        state['root'] = {key: root.get(key) for key in ('IOConsoleLocked', 'CGSSessionScreenIsLocked')}
        rows = root.get('IOConsoleUsers')
        assert isinstance(rows, list) and all(isinstance(row, dict) for row in rows)
        state['sessions'] = [{key: row.get(key) for key in (
            'kCGSSessionOnConsoleKey', 'kCGSessionLoginDoneKey', 'kCGSSessionUserIDKey',
            'CGSSessionScreenIsLocked')} for row in rows]
        state['console_uid'] = os.stat('/dev/console').st_uid
    except (OSError, ValueError, AssertionError, subprocess.SubprocessError, plistlib.InvalidFileException):
        state['errors'].append('IOKit or console owner unavailable')
    try:
        state['quartz'] = json.loads(subprocess.check_output([str(observer), 'console'], timeout=4))
        front = state['quartz']['frontmost']
        pid = front['pid']
        assert type(pid) is int and pid > 0
        owner = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'uid='], text=True, timeout=3).strip()
        assert owner.isdecimal()
        state['frontmost_uid'] = int(owner)
    except (OSError, ValueError, TypeError, KeyError, AssertionError, subprocess.SubprocessError):
        state['errors'].append('Quartz or frontmost owner unavailable')
    state['refusals'] = console_refusals(state)
    state['unlocked'] = not state['refusals']
    return state


def record_console(observer, observations, boundary):
    state = console_state(observer)
    observations.append(dict(boundary=boundary, state=state))
    return state


def require_console(observer, observations, boundary):
    state = record_console(observer, observations, boundary)
    assert state['unlocked'], 'Actual-app console preflight refused at ' + boundary + ': ' + '; '.join(state['refusals'])
    return state
