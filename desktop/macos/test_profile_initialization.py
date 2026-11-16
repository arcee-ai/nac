"""Bounded semantic oracle from verbatim production owner methods.

Platform/storage I/O and product-view construction are doubles. This does not
prove actual WK persistence, file leases, window release, OS sleep or acceptance.
Run through the coordinator's browser/compiler gate. Evidence is never reused.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import tempfile

OWNER = Path(__file__).parent


def member(source, declaration):
    matches = list(re.finditer(r'^    ' + re.escape(declaration), source, re.M))
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one {declaration}')
    start = matches[0].start()
    first_end = source.index('\n', start)
    end = first_end if source[first_end - 1] == '}' else source.index('\n    }', first_end) + 6
    return source[start:end] + '\n'


def bounded(command, timeout):
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, start_new_session=True) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
            raise RuntimeError(f'Owned command timed out: {command!r}\n{stdout}\n{stderr}')
        pid = process.pid
        result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    groups = subprocess.check_output(['ps', '-axo', 'pid=,pgid='], text=True)
    remaining = [line.strip() for line in groups.splitlines()
                 if len(line.split()) == 2 and int(line.split()[1]) == pid]
    return result, {'pid': pid, 'remainingOwnedGroup': remaining}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-revision')
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=False)

    def read(name):
        if args.source_revision:
            return subprocess.check_output(
                ['git', 'show', f'{args.source_revision}:desktop/macos/{name}'], text=True)
        return (OWNER / name).read_text()

    app, recovery, storage = (read(name) for name in [
        'PreviewApp.swift', 'WorkspaceRecovery.swift', 'WorkspaceStorage.swift'])
    declarations = [
        'private func load(', 'func beginWorkspaceRetirement(', 'var canRecoverWorkspace:',
        'private func fail(', 'func beginShutdown(']
    for declaration in ['func prepareWorkspaceStorage(',
                        'private func currentWorkspaceStorageProfile(']:
        if declaration in app:
            declarations.append(declaration)
    app_methods = ''.join(member(app, item) for item in declarations)
    recovery_methods = ''.join(member(recovery, item) for item in [
        'private func next(', 'private func current(', 'private func sameEngine(',
        'private func reconnect(', 'private func willSleep(', 'private func didWake(',
        'private func unavailable(', 'private func showActions(', 'private func hideActions(',
        'private func rememberRoute(', 'func engineReady(', 'func seedRoute(', 'func close(',
        'func cancelPending('])
    fixture = (OWNER / 'ProfileInitializationFixture.swift').read_text()
    profile = storage[storage.index('struct WorkspaceStorageProfile {'):
                      storage.index('\n/// One desktop-selected')]
    config = read('DesktopStartup.swift').split('\n/// Native launch choices.')[0]
    fields = re.findall(r'^    private var workspaceStorageSelection:.*$', app, re.M)
    generation = (member(recovery, 'var documentGeneration:')
                  if 'var documentGeneration:' in recovery else '')
    for marker, value in [
        ('PROFILE_MODEL', profile), ('CONFIG_MODEL', config), ('APP_METHODS', app_methods),
        ('RECOVERY_METHODS', recovery_methods), ('SELECTION_FIELD', '\n'.join(fields)),
        ('GENERATION_PROPERTY', generation),
    ]:
        if fixture.count('// ' + marker) != 1:
            raise ValueError(f'Fixture marker must occur once: {marker}')
        fixture = fixture.replace('// ' + marker, value)
    (args.evidence / 'bound-fixture.swift').write_text(fixture)
    owners = ['PreviewApp.swift', 'WorkspaceRecovery.swift', 'WorkspaceStorage.swift',
              'DesktopStartup.swift', 'EngineProtocol.swift', 'EngineFailure.swift',
              'AppLifecycle.swift']
    bindings = {name: hashlib.sha256(read(name).encode()).hexdigest() for name in owners}
    oracle = {name: hashlib.sha256((OWNER / name).read_bytes()).hexdigest() for name in [
        'test_profile_initialization.py', 'ProfileInitializationFixture.swift']}
    (args.evidence / 'source-bindings.json').write_text(json.dumps({
        'revision': args.source_revision or 'working tree', 'sha256': bindings,
        'oracleSHA256': oracle, 'actualWK': False, 'actualDiskLease': False,
    }, indent=2) + '\n')
    with tempfile.TemporaryDirectory(prefix='nac-profile-owner-') as directory:
        path = Path(directory)
        for name in ['EngineProtocol.swift', 'EngineFailure.swift', 'AppLifecycle.swift']:
            (path / name).write_text(read(name))
        sdk = subprocess.check_output(
            ['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        binary = path / 'profile-owner'
        command = [
            'xcrun', 'swiftc', '-sdk', sdk, '-swift-version', '5', '-target',
            'arm64-apple-macosx14.0', '-warnings-as-errors', '-Onone', '-D', 'LOCAL_APP',
            '-D', 'PREVIEW_SMOKE', str(path / 'EngineProtocol.swift'),
            str(path / 'EngineFailure.swift'), str(path / 'AppLifecycle.swift'),
            str(args.evidence / 'bound-fixture.swift'), '-o', str(binary),
        ]
        compiled, compiler_process = bounded(command, 90)
        (args.evidence / 'compile.log').write_text(compiled.stdout + compiled.stderr)
        if compiled.returncode:
            print(compiled.stderr)
            raise SystemExit(compiled.returncode)
        executed, fixture_process = bounded([str(binary)], 20)
        (args.evidence / 'result.json').write_text(executed.stdout)
        (args.evidence / 'stderr.txt').write_text(executed.stderr)
        (args.evidence / 'execution.json').write_text(json.dumps({
            'compileExit': compiled.returncode, 'runExit': executed.returncode,
            'command': command, 'binarySHA256': hashlib.sha256(binary.read_bytes()).hexdigest(),
            'compilerProcess': compiler_process, 'fixtureProcess': fixture_process,
        }, indent=2) + '\n')
        print(executed.stdout)
        print(executed.stderr)
        if compiler_process['remainingOwnedGroup'] or fixture_process['remainingOwnedGroup']:
            raise RuntimeError('An owned child group remained after direct wait')
        raise SystemExit(executed.returncode)


if __name__ == '__main__':
    main()
