#!/usr/bin/env python3
"""Cancel the actual focused browser runner after its native shell starts."""
import argparse
import importlib.util
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import sys
import time

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('terminal_browser', Path(__file__).with_name('terminal-browser.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error('--output must be new or empty')
    output.mkdir(parents=True, exist_ok=True)
    evidence = output / 'cancelled-run'
    receipt = {'result': 'failed', 'candidate': args.expected_sha}
    process = None
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, runner.portability.interrupt)
    try:
        with (output / 'runner.log').open('w') as log:
            process = subprocess.Popen([sys.executable, str(Path(runner.__file__)),
                                        '--expected-sha', args.expected_sha, '--output', str(evidence)],
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            # A shell-written file proves the detached server and real PTY shell exist.
            deadline = time.monotonic() + 2400
            while process.poll() is None:
                files = list(evidence.glob('journey/**/shell-before.pid'))
                shell_pid_text = files[0].read_text().strip() if files else ''
                if re.fullmatch(r'[1-9][0-9]*', shell_pid_text):
                    shell_pid = int(shell_pid_text)
                    os.kill(shell_pid, 0)
                    receipt['live_shell_pid'] = shell_pid
                    receipt['live_server_pid'] = json.loads((files[0].parents[1] / 'process.json').read_text())['pid']
                    os.kill(receipt['live_server_pid'], 0)
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('real shell readiness barrier did not arrive')
                time.sleep(.025)
            else:
                raise RuntimeError('runner exited before real shell readiness')
            process.send_signal(signal.SIGTERM)
            receipt['returncode'] = process.wait(timeout=20)
        report = json.loads((evidence / 'report.json').read_text())
        receipt['runner_report'] = report
        if receipt['returncode'] != 1 or 'cancelled by signal 15' not in report.get('error', ''):
            raise RuntimeError('cancellation was not reported as failure')
        if report.get('cleanup_error') or report.get('owned_pids_remaining') != []:
            raise RuntimeError('detached fixture cleanup failed')
        if runner.owned_processes(report['cleanup_marker']):
            raise RuntimeError('cancelled invocation still owns live processes')
        for pid in (receipt['live_shell_pid'], receipt['live_server_pid']):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                continue
            raise RuntimeError(f'observed fixture process survived: {pid}')
        receipt['result'] = 'passed (actual detached server and shell cancelled and settled)'
    except Exception as error:
        receipt['error'] = str(error)
    finally:
        if process is not None and process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        if (evidence / 'report.json').exists():
            report = json.loads((evidence / 'report.json').read_text())
            runner.settle_owned(report['cleanup_marker'])
        (output / 'cancellation.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))
    return 0 if receipt['result'].startswith('passed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
