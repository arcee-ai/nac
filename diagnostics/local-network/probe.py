"""Non-qualifying probes. Never print an endpoint, provider record, or exception."""
import json
import sys
import time
from pathlib import Path
from urllib.error import HTTPError


def exercise(cell, provider_factory, request, pause=time.sleep):
    result = {'diagnostic_only': True, 'cell': cell, 'operation': 'not_started',
              'owned_provider_settlement': 'not_applicable', 'modal': 'unknown'}
    if cell == 'idle':
        pause(10)
        result['operation'] = 'completed'
        return result
    if cell not in ('provider', 'loopback'):
        raise ValueError('Unknown fixed diagnostic cell')
    provider = provider_factory()
    try:
        base = provider.start()
        if cell == 'loopback':
            try:
                request(base, '/')
            except HTTPError:
                # The fixture need not offer a GET endpoint; receipt of an HTTP
                # status still means the numeric-loopback request was made.
                pass
        pause(10)
        result['operation'] = 'completed'
    except Exception:
        result['operation'] = 'unavailable'
    finally:
        try:
            provider.stop(require_complete=False)
            result['owned_provider_settlement'] = 'settled' if provider.settled else 'unknown'
        except Exception:
            result['owned_provider_settlement'] = 'unknown'
    return result


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Expected fixed cell and H source root')
    cell, root = sys.argv[1], Path(sys.argv[2]).resolve(strict=True)
    sys.path.insert(0, str(root / 'desktop/macos'))
    from ci_startup_api import Provider, request
    print(json.dumps(exercise(cell, Provider, request), sort_keys=True))


if __name__ == '__main__':
    main()
