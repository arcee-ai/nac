#!/usr/bin/env python3
"""Original-clock setup gates and exact producer metadata, before download."""
import json
import math
import os
from pathlib import Path
import signal
import sys
import time
import urllib.request

import consumer as c

CAPS = {'rust': 3, 'node': 2, 'checkout-H': 2, 'checkout-P': 2, 'metadata': 2, 'download': 2}


def minutes(value, phase, now=None):
    now = time.time() if now is None else now
    c.admit(value, os.environ, now=now)
    if phase == 'episode':
        deadline, cap = value['clock']['CLEANUP_DEADLINE'], 58
    else:
        c.require(phase in CAPS, 'fixed private lifecycle launcher phase')
        deadline, cap = value['clock']['WORK_DEADLINE'], CAPS[phase]
    result = min(cap, math.floor((deadline - now - 60) / 60))
    c.require(result >= 1, 'original launcher allowance exhausted')
    return result


def main():
    action = sys.argv[1]
    value = c.declaration(os.environ['ROOT_LIFECYCLE_ADMISSION'])
    c.admit(value, os.environ)
    c.require(os.environ.get('ImageVersion') == '20261102.0473.1', 'fixed host image before bootstrap')
    gate = Path(os.environ['RUNNER_TEMP']).resolve() / 'native344-lifecycle-gate'
    if action == '--gate':
        phase = sys.argv[2]
        n = minutes(value, phase)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('minutes=' + str(n) + '\n')
        c.common.write(gate / ('clock-' + phase + '.json'), dict(phase=phase, minutes=n, clock=value['clock']))
        return
    if action == '--metadata-child':
        def read(suffix):
            c.admit(value, os.environ)
            remaining = value['clock']['WORK_DEADLINE'] - time.time() - 15
            c.require(remaining > 0, 'original metadata clock')
            request = urllib.request.Request('https://api.github.com/repos/arcee-ai/nac' + suffix,
                headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json',
                         'X-GitHub-Api-Version': '2022-11-28'})
            with urllib.request.urlopen(request, timeout=min(30, remaining)) as response:
                data = response.read(1024 * 1024 + 1)
            c.require(len(data) <= 1024 * 1024, 'bounded original producer metadata')
            return json.loads(data)
        run = read('/actions/runs/' + str(c.common.PRODUCER_RUN))
        artifact = read('/actions/artifacts/' + str(c.common.PRODUCER_ARTIFACT))
        c.launch.artifact_identity(value, run, artifact)
        (gate / 'producer-run.json').write_text(json.dumps(run))
        (gate / 'producer-artifact.json').write_text(json.dumps(artifact))
        return
    c.require(action == '--metadata', 'fixed launcher action')
    h = Path(os.environ['H_ROOT'])
    c.owners(h)
    from ci_qualifications import require_checkout
    from ci_paths_budget import Bound, using
    import ci
    require_checkout(h, c.H)
    require_checkout(c.HERE.parents[2], value['controller_sha'])
    clock = c.common.make_clock(c.admit(value, os.environ), Bound)
    ci.RUN_DEADLINE = clock.work.deadline
    log = gate / 'producer-metadata.log'
    with using(clock.work):
        ci.run([sys.executable, '-B', str(Path(__file__).resolve()), '--metadata-child'], log, 60,
               cwd=h, abort=lambda: bool(c.common.STOP))
        proof = json.loads(log.with_name(log.name + '.ownership.json').read_bytes())
        c.require(proof['accepted'] and proof['reaped'] and proof['drain_settled']
            and not proof['unknown'] and proof['teardown_error'] is None, 'positive metadata child ownership')


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: c.common.STOP.append(number))
    main()
