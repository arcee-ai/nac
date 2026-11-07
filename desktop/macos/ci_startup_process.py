"""Startup preparation capture through the existing ci.run process-group owner.

The tiny exec adapter only separates stderr; it never forks, waits or signals.
No global subprocess replacement or alternative process supervisor lives here.
"""
import json
from pathlib import Path
import sys

from ci_paths_budget import check, time_limit

EXEC = ('import os,sys; fd=os.open(sys.argv[1],os.O_WRONLY|os.O_TRUNC); '
        'os.dup2(fd,2); os.close(fd); os.execv(sys.argv[2],sys.argv[2:])')
CONTRACT = ('import json,sys; sys.path.insert(0,sys.argv[1]); import contract; '
            'method,args,kwargs=json.loads(sys.argv[2]); '
            'print(json.dumps(getattr(contract,method)(*args,**kwargs)))')


def capture(argv, directory, name, cap, run, *, cwd, env=None, limit=32768):
    check()  # Refuse an expired/latching work bound before even the exec adapter.
    seconds = time_limit(cap)
    out, err = directory / (name + '.stdout.log'), directory / (name + '.stderr.log')
    with err.open('xb'):
        pass
    run([sys.executable, '-B', '-c', EXEC, str(err), *map(str, argv)], out, seconds, cwd=cwd, env=env)
    check()  # In particular, no next preparation launch after this phase expires.
    def read(path):
        with path.open('rb') as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise RuntimeError('Startup preparation capture exceeds its original bound')
        return data
    return read(out), read(err)


def package_contract(contract, method, args, kwargs, *, tests, directory, name, run=None):
    if method not in ('inspect_normal_package', 'validate_normal_package'):
        raise RuntimeError('Unknown startup package inspection')
    if run is None:
        return getattr(contract, method)(*args, **kwargs)
    data, errors = capture([sys.executable, '-B', '-c', CONTRACT,
        str(Path(tests) / 'desktop/macos/startup_xctest'), json.dumps([method, args, kwargs])],
        directory, name, 60, run, cwd=tests, limit=256 * 1024)
    if errors:
        raise RuntimeError('Startup package inspection stderr is unavailable/unclean')
    return json.loads(data)
