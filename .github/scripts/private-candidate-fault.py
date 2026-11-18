#!/usr/bin/env python3
"""Run the private candidate fault case and reject an empty selection."""
import os
import subprocess
import sys

name = 'tests::managed_load::direct_candidate_fault::private_candidate_child_read_fault_reconciles_once'
result = subprocess.run(
    [os.environ.get('CARGO', 'cargo'), 'test', '--locked', '-p', 'nac-server',
     '--features', 'managed-fault-fixture', '--lib', name, '--', '--ignored',
     '--exact', '--show-output', '--test-threads=1'],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
sys.stdout.write(result.stdout)
sys.stdout.flush()
if result.returncode or f'test {name} ... ok' not in result.stdout.splitlines():
    sys.exit(f'private candidate fault case did not pass: {name}')
