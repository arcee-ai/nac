"""One native managed fixture invocation; 90s phases, 600s whole-run watchdog."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time

binary = Path('/data/diagnostic/debug/nac-server-test')
worker = Path('/data/diagnostic/debug/nac-web')
env = dict(os.environ)
env.update(GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='safe.directory',
           GIT_CONFIG_VALUE_0='/home/runner/work/nac/nac', TMPDIR='/data/tmp',
           NAC_MANAGED_LOAD_WORKER=str(worker),
           NAC_MANAGED_LOAD_COPY_STORE_DIR='/data/extended-fixtures',
           NAC_MANAGED_LOAD_PHASE_TIMEOUT_SECONDS='90')
Path('/data/tmp').mkdir(exist_ok=True)
command = [str(binary), 'tests::managed_load::managed_load_scenario',
           '--ignored', '--exact', '--nocapture', '--test-threads=1']
started = time.monotonic()
timed_out = []
finished = threading.Event()
sample_count = []
with Path('/data/extended-control.log').open('w') as output:
    child = subprocess.Popen(command, env=env, stdout=output, stderr=output,
                             start_new_session=True)

    def terminate():
        timed_out.append(True)
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def sample():
        with Path('/data/extended-resource-samples.jsonl').open('w') as log:
            while not finished.is_set():
                fields = {'elapsed_ms': int((time.monotonic()-started)*1000),
                          'fixture_pid': child.pid}
                try:
                    lines = Path(f'/proc/{child.pid}/status').read_text().splitlines()
                    fields['status'] = dict(line.split(':', 1) for line in lines
                                            if line.split(':', 1)[0] in
                                            ['Name', 'State', 'Threads', 'VmRSS', 'VmHWM'])
                    descendants = set()
                    observed = 0
                    for task in Path(f'/proc/{child.pid}/task').glob('*'):
                        try:
                            descendants.update((task/'children').read_text().split())
                            observed += 1
                        except OSError:
                            pass
                    fields['children_observation_supported'] = observed > 0
                    fields['direct_children'] = []
                    for pid in sorted(descendants):
                        try:
                            lines = Path(f'/proc/{pid}/status').read_text().splitlines()
                            fields['direct_children'].append({'pid': pid, 'status':
                                dict(line.split(':', 1) for line in lines
                                     if line.split(':', 1)[0] in
                                     ['Name', 'State', 'PPid', 'Threads', 'VmRSS', 'VmHWM'])})
                        except OSError:
                            fields['direct_children'].append({'pid': pid, 'gone_during_sample': True})
                except OSError as error:
                    fields['proc_observation_error'] = type(error).__name__
                log.write(json.dumps(fields)+'\n')
                log.flush()
                sample_count.append(True)
                finished.wait(2)

    sampler = threading.Thread(target=sample)
    sampler.start()
    watchdog = threading.Timer(600, terminate)
    watchdog.start()
    _, status, usage = os.wait4(child.pid, 0)
    child.returncode = os.waitstatus_to_exitcode(status)
    watchdog.cancel()
    finished.set()
    sampler.join()
receipt = {'scope': 'one extended native SQLite application diagnostic; not healthy acceptance',
           'source_revision': '1786551cee45c34c0f1d571720e99c0e150fd4c4',
           'phase_timeout_seconds': 90, 'default_acceptance_seconds': 20,
           'whole_run_watchdog_seconds': 600, 'whole_run_watchdog_triggered': bool(timed_out),
           'command': command, 'fixture_pid': child.pid, 'exit': child.returncode,
           'elapsed_ms': int((time.monotonic()-started)*1000),
           'cpu_user_us': int(usage.ru_utime*1e6),
           'cpu_system_us': int(usage.ru_stime*1e6),
           'peak_rss_bytes': usage.ru_maxrss*1024,
           'resource_samples': len(sample_count),
           'accounting_limit': 'gVisor wait4/proc accounting is virtualized; includes whole fixture, not per-operation CPU',
           'test_binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
           'worker_binary_sha256': hashlib.sha256(worker.read_bytes()).hexdigest()}
Path('/data/extended-control-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
print(json.dumps(receipt))
raise SystemExit(child.returncode if child.returncode >= 0 else 1)
