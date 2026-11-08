#!/usr/bin/env python3
"""Closed configured-refusal diagnostic; separate Root actual admission required."""
import importlib.util
from pathlib import Path
import signal

spec = importlib.util.spec_from_file_location('configured_refusal_owner', Path(__file__).with_name('launch.py'))
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)
if __name__ == '__main__':
    stop = owner.STOP if hasattr(owner, 'STOP') else owner.case.STOP
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: stop.append(number))
    owner.main(configured_refusal=True)
