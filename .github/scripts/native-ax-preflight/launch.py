#!/usr/bin/env python3
"""Reuse original artifact custody/extraction; no new transport or supervisor."""
import importlib.util
from pathlib import Path
import signal
import preflight

spec = importlib.util.spec_from_file_location('retained_package_launcher',
    Path(__file__).resolve().parent.parent / 'native342-startup/launch.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: preflight.STOP.append(number))
    launcher.main(case_module=preflight, pair_file=Path(__file__).with_name('pair.json'),
                  entrypoint=Path(__file__).resolve())
