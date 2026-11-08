"""NEVER MERGE: one Root-admitted exact-source fixture60 diagnostic only."""
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import time

BASE = '9bcec861fdcf56c380919211b9d6bbd16a44142a'
BASE_TREE = '187f6a70d916e028eb65cbcfaa453092df79e4c9'
BRANCH = 'refs/heads/codex/private-native544-fixture60-timing02'
TRACE_LIMIT = 2 * 1024 * 1024
UPLOAD_LIMIT = 4 * 1024 * 1024

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'desktop/macos'))
from ci_paths_budget import Bound, using


def capsule(value, now, *, retention=False):
    keys = {'scope', 'source_sha', 'source_tree', 'started', 'work', 'cleanup', 'hard', 'attempt', 'retry', 'actors_sha256'}
    if type(value) is not dict or set(value) != keys:
        raise ValueError('Exact Root allocation required')
    if (value['scope'] != 'native544-fixture60-timing02' or type(value['attempt']) is not int
            or value['attempt'] != 1 or type(value['retry']) is not int or value['retry'] != 0):
        raise ValueError('Wrong single-attempt scope')
    if type(value['actors_sha256']) is not str or re.fullmatch('[0-9a-f]{64}', value['actors_sha256']) is None:
        raise ValueError('Exact admitted actor roster required')
    if any(type(value[k]) is not str or re.fullmatch('[0-9a-f]{40}', value[k]) is None
           for k in ('source_sha', 'source_tree')):
        raise ValueError('Exact frozen identities required')
    if any(type(value[k]) not in (int, float) or not math.isfinite(value[k]) for k in ('started', 'work', 'cleanup', 'hard')):
        raise ValueError('Literal finite original clocks required')
    if not (value['started'] < value['work'] < value['cleanup'] < value['hard']
            and value['started'] <= now < value['hard' if retention else 'work']):
        raise ValueError('Original queue-inclusive allocation expired or unordered')
    if value['cleanup'] - value['work'] < 30 or value['hard'] - value['cleanup'] < 30:
        raise ValueError('Insufficient fixed cleanup and retention reserve')
    if value['hard'] - value['started'] > 30 * 60:
        raise ValueError('Allocation exceeds private job ceiling')
    return value


def make_clock(c):
    class Clock:
        # Same maintained Bound/ci.run adapter pattern as the configured controller.
        monotonic = staticmethod(time.monotonic)

        def __init__(self):
            self.mono, self.epoch = time.monotonic(), time.time()
            self.failed = []
            self.work = Bound(self, self.mono + c['work'] - self.epoch, 'work')
            self.cleanup = Bound(self, self.mono + c['cleanup'] - self.epoch, 'cleanup')
            self.retention = Bound(self, self.mono + c['hard'] - self.epoch, 'retention')

        def fail(self, reason):
            if reason not in self.failed:
                self.failed.append(reason)

        def observe(self):
            before, epoch, after = time.monotonic(), time.time(), time.monotonic()
            if (not all(math.isfinite(v) for v in (before, epoch, after)) or after < before
                    or not self.epoch + before - self.mono - 1 <= epoch <= self.epoch + after - self.mono + 1):
                self.fail('clock discontinuity/unknown')
    return Clock()


def require_dispatch(c):
    if (os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'
            or os.environ.get('GITHUB_REF') != BRANCH
            or os.environ.get('GITHUB_RUN_ATTEMPT') != '1'
            or os.environ.get('GITHUB_SHA') != c['source_sha']):
        raise ValueError('Wrong dispatch, branch, source or attempt')


def upload_minutes(value, now):
    c = capsule(value, now, retention=True)
    return max(0, min(2, math.floor((c['hard'] - now - 15) / 60)))


def upload_gate():
    minutes = 0
    try:
        value = json.loads(os.environ['NAC544_ROOT_CUSTODY'])
        c = capsule(value, time.time(), retention=True)
        require_dispatch(c)
        minutes = upload_minutes(c, time.time())
    except (KeyError, TypeError, ValueError, OverflowError):
        pass
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write('minutes=' + str(minutes) + '\n')


def retain(raw, output, report, replacements, hard, now=time.time):
    if now() >= hard:
        raise RuntimeError('Hard cutoff reached; retention not admitted')
    report['finished_epoch'] = now()
    report['nested_fixture_cleanup'] = 'not inferred from outer process receipt; assess timed trace and finite actor roster'
    total = 0
    exported = []
    for source in sorted(raw.iterdir()):
        if source.is_symlink() or not source.is_file() or source.stat().st_size > TRACE_LIMIT:
            raise RuntimeError('Invalid timing evidence')
        data = source.read_bytes()
        text = data.decode('utf-8', errors='replace')
        for value, replacement in replacements:
            if value:
                text = text.replace(value, replacement)
        encoded = text.encode()
        if len(encoded) > TRACE_LIMIT:
            raise RuntimeError('Redacted trace exceeds timing evidence bound')
        total += len(encoded)
        if total > UPLOAD_LIMIT - 65536 or now() >= hard:
            raise RuntimeError('Timing upload bound exceeded')
        (output / source.name).write_bytes(encoded)
        exported.append(dict(path=source.name, bytes=len(encoded),
            raw_sha256=hashlib.sha256(data).hexdigest(), sha256=hashlib.sha256(encoded).hexdigest()))
    report['files'] = exported
    encoded = (json.dumps(report, indent=2) + '\n').encode()
    if total + len(encoded) > UPLOAD_LIMIT:
        raise RuntimeError('Timing report bound exceeded')
    if now() >= hard:
        raise RuntimeError('Hard cutoff reached before final report')
    (output / 'report.json').write_bytes(encoded)


def main():
    root = Path(__file__).resolve().parents[3]
    c = capsule(json.loads(os.environ['NAC544_ROOT_CUSTODY']), time.time())
    require_dispatch(c)
    clock = make_clock(c)
    def git(*args):
        seconds = clock.work.timeout(15)
        result = subprocess.check_output(['git', *args], cwd=root, text=True, timeout=seconds).strip()
        clock.work.check()
        return result
    if (git('rev-parse', 'HEAD') != c['source_sha'] or git('rev-parse', 'HEAD^{tree}') != c['source_tree']
            or git('rev-parse', 'HEAD^') != BASE or git('rev-parse', BASE + '^{tree}') != BASE_TREE
            or git('status', '--porcelain')):
        raise ValueError('Exact clean reproduction source required')
    allowed = {'.github/workflows/stable-release.yml',
               '.github/scripts/native544-fixture60/timing.py',
               '.github/scripts/native544-fixture60/driver.py',
               '.github/scripts/native544-fixture60/controls.py',
               '.github/scripts/native544-fixture60/README.md',
               '.github/scripts/native544-fixture60/ROSTER.json'}
    if set(git('diff', '--name-only', BASE, 'HEAD').splitlines()) != allowed:
        raise ValueError('Unexpected reproduction source changes')
    roster = root / '.github/scripts/native544-fixture60/ROSTER.json'
    if hashlib.sha256(roster.read_bytes()).hexdigest() != c['actors_sha256']:
        raise ValueError('Actor roster is not the Root-admitted inventory')
    if (platform.system(), platform.machine(), os.environ.get('ImageVersion'), os.environ.get('DEVELOPER_DIR')) != (
            'Darwin', 'arm64', '20261102.0473.1', '/Applications/Xcode_26.6.app/Contents/Developer'):
        raise ValueError('Exact original image and host required')
    if sys.argv[1:] == ['--admit-only']:
        return
    if sys.argv[1:]:
        raise ValueError('No alternate execution modes')
    sys.path.insert(0, str(root / 'desktop/macos'))
    import ci
    ci.RUN_DEADLINE = clock.work.deadline
    output = Path(os.environ['RUNNER_TEMP']) / 'native544-fixture60-upload'
    raw = Path(os.environ['RUNNER_TEMP']) / 'native544-fixture60-private'
    output.mkdir(mode=0o700)
    raw.mkdir(mode=0o700)
    report = dict(scope=c['scope'], acceptance=False, status='failed', source_sha=c['source_sha'],
        source_tree=c['source_tree'], base=BASE, base_tree=BASE_TREE, allocation=c,
        discovered_expected=545, fixture_seconds=60, retry=0, actual_native_acceptance=False)
    def interrupt(signum, frame):
        raise RuntimeError('Timing diagnostic interrupted')
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    primary = None
    try:
        with using(clock.work):
            # Original ci.run owns every accepted command, complete drainer and group cleanup.
            for args, name in [(['xcodebuild', '-version'], 'xcode.log'),
                               (['xcrun', '--sdk', 'macosx', '--show-sdk-version'], 'sdk.log')]:
                ci.run(args, raw / name, 15, retain_ownership=True, complete_output_limit=65536)
            if (raw / 'xcode.log').read_text().strip() != 'Xcode 26.6\nBuild version 17F113':
                raise RuntimeError('Xcode drift')
            if (raw / 'sdk.log').read_text().strip() != '26.5':
                raise RuntimeError('SDK drift')
            ci.run(['make', 'setup'], raw / 'setup.log', 600,
                   retain_ownership=True, complete_output_limit=512 * 1024)
            if git('status', '--porcelain'):
                raise RuntimeError('Locked setup changed source')
            ci.run(['python3', '-B', '.github/scripts/native544-fixture60/timing.py'],
                   raw / 'fixture-controls.log', 60, retain_ownership=True,
                   complete_output_limit=TRACE_LIMIT)
            report['status'] = 'fixture-suite-passed'
    except BaseException as error:
        primary = error
        report['error_type'] = type(error).__name__
        raise
    finally:
        try:
            with using(clock.retention):
                retain(raw, output, report, ci.redact_values(), c['hard'])
        except BaseException as retention_error:
            if primary is None:
                raise
            try:
                print('Timing retention failed: ' + type(retention_error).__name__, file=sys.stderr, flush=True)
            except BaseException:
                pass  # A broken fallback sink never replaces the original suite error.


if __name__ == '__main__':
    if sys.argv[1:] == ['--upload-gate']:
        upload_gate()
    else:
        main()
