"""NEVER MERGE: transparent unittest timing; no fixture selection changes."""
import sys
import time
import unittest
from pathlib import Path


def mark(event, identity):
    print(f'{event} monotonic={time.monotonic():.9f} id={identity}', file=sys.stderr, flush=True)


class TimingSuite(unittest.TestSuite):
    def _handleClassSetUp(self, test, result):
        changed = test.__class__ != getattr(result, '_previousTestClass', None)
        identity = test.__class__.__module__ + '.' + test.__class__.__qualname__
        if changed:
            mark('CLASS_SETUP_BEGIN', identity)
        try:
            return super()._handleClassSetUp(test, result)
        finally:
            if changed:
                mark('CLASS_SETUP_END', identity)


class TimingLoader(unittest.TestLoader):
    suiteClass = TimingSuite


class TimingResult(unittest.TextTestResult):
    def startTest(self, test):
        mark('TEST_BEGIN', test.id())
        return super().startTest(test)

    def stopTest(self, test):
        try:
            return super().stopTest(test)
        finally:
            mark('TEST_END', test.id())


class TimingRunner(unittest.TextTestRunner):
    resultclass = TimingResult

    def run(self, test):
        print(f'DISCOVERED_COUNT={test.countTestCases()}', file=sys.stderr, flush=True)
        return super().run(test)


def main():
    # Restore the original `python -m unittest` initial project search path.
    root = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(root))
    unittest.main(module=None, argv=['unittest', 'discover', '-s', 'desktop/macos',
                  '-p', 'test_*.py', '-v'], testLoader=TimingLoader(), testRunner=TimingRunner)


if __name__ == '__main__':
    main()
