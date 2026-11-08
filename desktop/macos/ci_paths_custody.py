"""Transport ROOT's exact allocation bytes to the existing hosted path selector.

This creates no approval/eligibility/clock facts and consumes no native attempt.
ci.py independently validates and consumes the resulting known file.
"""
import argparse
import os
from pathlib import Path
import stat

from ci_paths import validate_allocation
from ci_paths_protocol import decode, require


def materialize(data, parent, harness_sha, *, now=None):
    require(type(data) is bytes and len(data) <= 8192, 'external custody JSON bound')
    validate_allocation(decode(data), harness_sha, now=now)
    parent = Path(parent)
    require(parent.is_absolute() and parent.resolve() == parent and parent.is_dir()
            and parent.stat().st_uid == os.getuid()
            and not any(ord(c) < 32 or ord(c) == 127 for c in str(parent)), 'canonical owned runner temporary parent')
    folder = parent / 'nac347-path-custody'
    folder.mkdir(mode=0o700)  # No replacement/reuse of a previous job's handoff.
    require(stat.S_IMODE(folder.stat().st_mode) == 0o700, 'private custody handoff directory')
    destination = folder / 'root-allocation.json'
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)  # Exact externally supplied bytes, including original epochs.
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness-sha', required=True)
    parser.add_argument('--output-parent', required=True, type=Path)
    args = parser.parse_args()
    destination = materialize(os.environ.get('NAC_PATHS_CUSTODY_JSON', '').encode(), args.output_parent, args.harness_sha)
    print('NAC_PATHS_CUSTODY=' + str(destination))


if __name__ == '__main__':
    main()
