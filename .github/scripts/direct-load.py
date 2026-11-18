#!/usr/bin/env python3
"""Run the bounded direct-session PR cases and reject empty selections."""
import os
import subprocess
import sys

CASES = (
    'tests::managed_load::direct_acceptance::direct_load_replacement_scenario',
    'tests::managed_load::direct_acceptance::direct_load_concurrent_probe',
    'tests::managed_load::direct_acceptance::direct_load_busy_conflict',
    'tests::managed_load::direct_candidate::direct_candidate_load_scenario',
    'tests::managed_load::direct_faults::direct_native_cancellation_and_reconstruction',
    'tests::managed_load::direct_faults::direct_model_cancellation_and_reconstruction',
    'tests::managed_load::direct_faults::direct_child_append_failure_and_reconstruction',
)

for name in CASES:
    result = subprocess.run(
        [os.environ.get('CARGO', 'cargo'), 'test', '--locked', '-p', 'nac-server', '--lib',
         name, '--', '--ignored', '--exact', '--show-output', '--test-threads=1'],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    sys.stdout.write(result.stdout)
    sys.stdout.flush()
    if result.returncode or f'test {name} ... ok' not in result.stdout.splitlines():
        sys.exit(f'direct load case did not pass: {name}')
