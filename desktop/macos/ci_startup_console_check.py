"""Required portable console controls with the exact nominated Q; never a native run."""
import argparse
import os
from pathlib import Path
import sys
import unittest

from ci_qualifications import select_target
from ci_startup_fixture import TEST_SOURCE, test_contract


def nominated_revision():
    revision = select_target('all-342-startup-macos26')['test_source_sha']
    if revision != TEST_SOURCE:
        raise RuntimeError('Console control Q nomination differs')
    return revision


def admit_source(root):
    # Existing source admission checks exact clean checkout and all four hashes.
    root = Path(root).resolve(strict=True)
    test_contract(root)
    return root / 'desktop/macos/startup_xctest/StartupJourneys.swift'


def require_complete(result):
    if not result.wasSuccessful() or result.skipped or result.testsRun != 4:
        raise RuntimeError('Required console controls must pass all four tests with zero skips')


def run_required(root, *, suite=None, stream=None):
    source = admit_source(root)
    previous = os.environ.get('NAC_STARTUP_TEST_SOURCE')
    os.environ['NAC_STARTUP_TEST_SOURCE'] = str(source)
    try:
        if suite is None:
            suite = unittest.defaultTestLoader.loadTestsFromName('test_ci_startup_console.StartupConsoleTests')
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
        require_complete(result)
        return result
    finally:
        if previous is None:
            os.environ.pop('NAC_STARTUP_TEST_SOURCE', None)
        else:
            os.environ['NAC_STARTUP_TEST_SOURCE'] = previous


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resolve', action='store_true')
    parser.add_argument('--source-root', type=Path)
    args = parser.parse_args()
    if args.resolve:
        if args.source_root is not None:
            parser.error('resolve takes no source root')
        print('revision=' + nominated_revision())
    else:
        if args.source_root is None:
            parser.error('required immutable Q source root missing')
        run_required(args.source_root)
