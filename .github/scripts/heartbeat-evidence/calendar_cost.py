"""Fixed T3 Calendar cost contract; shares the established Linux custody owner."""
import json
import math
import os
from pathlib import Path
import re
import threading
import time

from contract import require, sha256, write_json, measurement_inventory
from owned_process import clean_environment, run_owned, reap_namespace

MODE = 'calendar-cost'
HEAD = 'cb1f76f29302f4eafa768e6913d257b75e3ab247'
TREE = '8681d950d2fb6c09e1e8fa488d0c9609a38b6f1a'
BRANCH = 'refs/heads/codex/all-481-linux-cost-evidence'
TESTS = (
    'application::heartbeat_scheduler::tests::heartbeat_scheduler_measure_1_10_100_with_two_owners_and_bounded_chat_contention',
    'application::heartbeat_scheduler::tests::heartbeat_calendar_measure_1_10_100_with_two_owners_and_seven_day_downtime',
)
VALUES = {'cold_scan_ms', 'warm_p50_ms', 'warm_p95_ms', 'warm_max_ms',
          'maximum_admission_lateness_ms', 'database_bytes', 'calculation_ms'}
RSS = {'resident_before_kib', 'resident_active_kib'}
DIMENSIONS = {'schedules', 'runnable_chats', 'owners', 'admitted', 'pending',
              'catchup_points_per_schedule', 'retained_occurrence_rows'}
GIB = 1024**3
FLOOR = GIB
FAILURE_RESERVE = 256*1024**2
BUILD_FORECAST = 5*GIB
EXPORT_BOUND = 1536*1024**2
ENTRY_REQUIRED = FLOOR+FAILURE_RESERVE+BUILD_FORECAST+EXPORT_BOUND
MIN_MEMORY_KIB = 4*1024**2
BUILDERS = {'cargo', 'rustc', 'rust-lld', 'ld', 'clang', 'clang++', 'swift', 'swiftc',
            'node', 'nodejs', 'npm', 'npx', 'esbuild', 'vite', 'chromium', 'chrome',
            'ninja', 'cc', 'c++', 'gcc', 'g++', 'cc1', 'collect2', 'lld', 'ld.lld'}


def verify_product(product, git):
    require(git(product, 'rev-parse', 'HEAD') == HEAD, 'CALENDAR_PRODUCT_HEAD')
    require(git(product, 'rev-parse', 'HEAD^{tree}') == TREE, 'CALENDAR_PRODUCT_TREE')
    require(git(product, 'status', '--porcelain') == '', 'PRODUCT_DIRTY')


def inventory(stdout):
    result = measurement_inventory(stdout)
    require(all(result['registered_tests'].count(test) == 1 for test in TESTS),
            'CALENDAR_INVENTORY_SELECTION')
    return result


def rows(stdout, listed, index):
    require(index in (0, 1), 'CALENDAR_SELECTOR_INDEX')
    names = listed['registered_tests']
    require(listed['total'] == len(names) == len(set(names)) and
            all(names.count(test) == 1 for test in TESTS), 'CALENDAR_INVENTORY_BINDING')
    require(re.findall(r'^running (\d+) tests?$', stdout, re.M) == ['1'], 'EXACT_ONE_MEASUREMENT_TEST')
    require(re.findall(r'^test (\S+) \.\.\.', stdout, re.M) == [TESTS[index]], 'MEASUREMENT_TEST_NAME')
    summary = re.findall(r'^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; '
                         r'(\d+) measured; (\d+) filtered out; finished in [^\n]+$', stdout, re.M)
    require(len(summary) == 1 and summary[0][:5] == ('ok', '1', '0', '0', '0') and
            int(summary[0][5]) == len(names)-1, 'EXACT_ONE_MEASUREMENT_TEST')
    prefix = 'HEARTBEAT_MEASUREMENT' if index == 0 else 'HEARTBEAT_CALENDAR_MEASUREMENT'
    result = [json.loads(value) for value in re.findall(
        r'(?:^|\s)'+prefix+r' (\{[^\n]*\})', stdout, re.M)]
    require(len(result) == 3, 'THREE_MEASUREMENT_ROWS')
    for row, n, active in zip(result, (1, 10, 100), (1, 4, 4)):
        require(type(row) is dict and set(row) == VALUES | RSS | DIMENSIONS | {'cadence'}, 'CALENDAR_SCHEMA')
        expected = {'schedules': n, 'runnable_chats': active, 'owners': 2, 'admitted': active,
                    'pending': n-active, 'retained_occurrence_rows': n,
                    'catchup_points_per_schedule': 1 if index == 0 else 8}
        require(all(type(row[k]) is int and row[k] == v for k, v in expected.items()), 'MEASUREMENT_CARDINALITY')
        require(row['cadence'] == ('interval' if index == 0 else 'calendar_daily_utc'), 'CALENDAR_CADENCE')
        require(all(type(row[k]) in (int, float) and math.isfinite(row[k]) and row[k] >= 0 for k in VALUES),
                'MEASUREMENT_VALUE')
        require(all(row[k] is None or (type(row[k]) is int and row[k] >= 0) for k in RSS), 'MEASUREMENT_RSS')
        require(row['database_bytes'] > 0 and (index != 0 or row['calculation_ms'] == 0), 'CALENDAR_METRIC_SCOPE')
        require(row['warm_p50_ms'] <= row['warm_p95_ms'] <= row['warm_max_ms'], 'MEASUREMENT_ORDER')
    return result


def compiler_artifact(stdout):
    records = [json.loads(line) for line in stdout.splitlines() if line]
    matches = [r for r in records if r.get('reason') == 'compiler-artifact' and
               r.get('target', {}).get('name') == 'nac_server' and r.get('executable') and
               r.get('profile', {}).get('test')]
    require(len(matches) == 1, 'EXACT_TEST_EXECUTABLE')
    artifact = matches[0]
    profile = artifact['profile']
    require(artifact['target'].get('kind') == ['lib'] and artifact['features'] == []
            and profile['opt_level'] == '0' and profile['debuginfo'] == 2
            and profile['debug_assertions'] and profile['overflow_checks'], 'CALENDAR_DEFAULT_PROFILE')
    for name in ('nac_core', 'nac_managed'):
        dependencies = [r for r in records if r.get('reason') == 'compiler-artifact' and
                        r.get('target', {}).get('name') == name]
        require(dependencies and all(sorted(r['features']) == ['default', 'openapi', 'test-support']
                                    and not r['profile']['test'] for r in dependencies), 'CALENDAR_DEPENDENCY_PROFILE')
    return artifact


def free_bytes(path):
    value = os.statvfs(path)
    return value.f_bavail*value.f_frsize


def process_sample():
    """Only this private PID namespace; names/start ticks, never argv/environment."""
    result = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            raw = (entry/'stat').read_text()
        except FileNotFoundError:
            # A directory can vanish between enumeration and opening. Record it,
            # never turn a malformed/read-denied record into a quiet observation.
            result.append({'pid': int(entry.name), 'vanished_before_read': True})
            continue
        start, end = raw.index('('), raw.rindex(')')
        fields = raw[end+2:].split()
        require(len(fields) >= 20, 'CALENDAR_PROCESS_METADATA')
        result.append({'pid': int(entry.name), 'name': raw[start+1:end],
                       'birth_ticks': int(fields[19]), 'cpu_ticks': int(fields[11])+int(fields[12])})
    return result


def check_sample(sample):
    require(not any(row.get('vanished_before_read') for row in sample), 'CALENDAR_PROCESS_OBSERVATION_UNKNOWN')
    require(not any(row['name'] in BUILDERS for row in sample), 'CALENDAR_COMPETING_HEAVY_PROCESS')


class QuietMonitor:
    """One sampled quiet interval and monitor, no rebaseline or retry."""
    def __init__(self, output):
        self.output, self.samples, self.error = output, [], None
        self.stop = threading.Event()
        self.thread = None
        self.closed = False

    def observe(self):
        sample = process_sample()
        self.samples.append({'monotonic': time.monotonic(), 'processes': sample})
        check_sample(sample)
        require(free_bytes(self.output) > FLOOR+FAILURE_RESERVE, 'CALENDAR_GUEST_FLOOR')

    def watch(self):
        try:
            while not self.stop.wait(1):
                self.observe()
        except BaseException as error:
            self.error = error

    def ensure(self):
        if self.error:
            raise self.error

    def start(self, deadline):
        require(deadline-time.monotonic() > 60+435+120, 'CALENDAR_CASE_RESERVATION')
        self.observe()
        anchor = time.monotonic()  # All builds/copies/hashes/inventory have finished.
        self.thread = threading.Thread(target=self.watch, daemon=True)
        self.thread.start()
        while time.monotonic()-anchor < 60:
            self.ensure()
            require(time.monotonic() < deadline-435-120, 'CALENDAR_CASE_RESERVATION')
            time.sleep(.2)
        self.observe()
        self.ensure()
        write_json(self.output/'quiet-window.json', {'anchor': anchor, 'completed': time.monotonic(),
                   'seconds': 60, 'scope': 'private namespace; serial fresh guest job, physical-host background unknown'})

    def close(self):
        if self.closed:
            self.ensure()
            return
        self.stop.set()
        if self.thread:
            self.thread.join(5)
            require(not self.thread.is_alive(), 'CALENDAR_MONITOR_UNRESOLVED')
        write_json(self.output/'quiet-observations.json', {'samples': self.samples,
                   'error': str(self.error) if self.error else None, 'sampling_seconds': 1})
        self.closed = True
        self.ensure()


def workload(context, output, namespace, retain_executable, final_checks, git, resource_sample):
    """Cost-only mode. Existing owner still controls every actual child/namespace."""
    os.environ.clear()
    os.environ.update(context['tool_environment'])
    product = Path(context['product'])
    deadline = time.monotonic()+1200
    first_error, attempted = None, False
    result = {'state': 'FAIL', 'control': context['control'], 'head': HEAD, 'tree': TREE,
              'baseline': '', 'namespace': namespace, 'runtime_attempts': 1, 'mode': MODE,
              'live_vendor': False, 'profile': 'default server libtest opt0/debug2'}
    monitor = QuietMonitor(output)
    for name in ('home', 'tmp', 'bin', 'perf-tmp'):
        (output/name).mkdir(mode=0o700)
    build = output.parent/(output.name+'-build')
    build.mkdir(mode=0o700)
    environment = clean_environment(output/'home', output/'tmp', {'CARGO_TARGET_DIR': str(build)})

    def phase(label, argv, bound, env=None):
        monitor.ensure()
        require(free_bytes(output) > FLOOR+FAILURE_RESERVE, 'CALENDAR_GUEST_FLOOR')
        remaining = min(bound, deadline-time.monotonic()-120)
        require(remaining > 0, 'ACTIVE_DEADLINE')
        receipt = run_owned(argv, product, env or environment, output, label, remaining)
        require(free_bytes(output) > FLOOR+FAILURE_RESERVE, 'CALENDAR_GUEST_FLOOR')
        return receipt

    try:
        available = free_bytes(output)
        require(available > ENTRY_REQUIRED, 'CALENDAR_GUEST_BUILD_ADMISSION')
        resources = resource_sample()
        memory = resources['memory']['MemAvailable'].split()
        require(len(memory) == 2 and memory[1] == 'kB' and int(memory[0]) >= MIN_MEMORY_KIB,
                'CALENDAR_GUEST_MEMORY_ADMISSION')
        write_json(output/'guest-admission.json', {'free_bytes': available, 'required': ENTRY_REQUIRED,
                   'build_forecast': BUILD_FORECAST, 'export_bound': EXPORT_BOUND,
                   'floor': FLOOR, 'failure_reserve': FAILURE_RESERVE,
                   'memory_minimum_kib': MIN_MEMORY_KIB, 'resources': resources, 'not_laptop_policy': True})
        verify_product(product, git)
        phase('toolchain', ['rustc', '-Vv'], 10)
        phase('cargo-version', ['cargo', '-V'], 10)
        phase('resolved-graph', ['cargo', 'metadata', '--locked', '--offline', '--format-version=1'], 30)
        phase('build-measurement', ['cargo', 'test', '--locked', '--offline', '-p', 'nac-server', '--lib',
                                  '--no-run', '--message-format=json'], 720)
        artifact = compiler_artifact((output/'build-measurement.stdout').read_text())
        executable = Path(artifact['executable'])
        require(executable == executable.resolve() and executable.is_relative_to(build)
                and executable.stat().st_size <= GIB, 'CALENDAR_EXECUTABLE_BOUND')
        measurement = output/'bin/heartbeat-measurement'
        result['measurement_binary'] = retain_executable(executable, measurement)
        host = os.uname()  # No platform.platform()/processor helper subprocess.
        write_json(output/'compiler-identity.json', {'artifact': artifact,
                   'host': {'system': host.sysname, 'release': host.release, 'machine': host.machine},
                   'source': HEAD, 'tree': TREE,
                   'lock_sha256': sha256(product/'Cargo.lock'), 'environment': environment,
                   'manifest_sha256': {name: sha256(product/name) for name in (
                       'Cargo.toml', 'crates/nac-server/Cargo.toml', 'crates/nac-core/Cargo.toml',
                       'crates/nac-managed/Cargo.toml')},
                   'measurement_source_sha256': sha256(product/'crates/nac-server/src/application/heartbeat_scheduler/tests.rs')})
        verify_product(product, git)
        require(not reap_namespace()['remaining'], 'CALENDAR_PREMEASUREMENT_CHILDREN')
        phase('measurement-inventory', [measurement, '--list'], 20)
        listed = inventory((output/'measurement-inventory.stdout').read_text())
        require(sha256(measurement) == result['measurement_binary']['sha256'], 'MEASUREMENT_BINARY_CHANGED')
        write_json(output/'measurement-inventory.json', {**listed, 'binary_sha256': result['measurement_binary']['sha256']})
        result['measurement_inventory'] = listed
        monitor.start(deadline)
        result['resources_before_measurement'] = resource_sample()
        result['measurements'] = []
        for index, test in enumerate(TESTS):
            monitor.ensure()
            reserve = (2-index)*180+75+120
            require(deadline-time.monotonic() > reserve, 'CALENDAR_CASE_RESERVATION')
            attempted = True
            label = 'measurement-interval' if index == 0 else 'measurement-calendar'
            phase(label, [measurement, test, '--ignored', '--exact', '--nocapture', '--test-threads=1', '--color=never'],
                  180, {**environment, 'TMPDIR': str(output/'perf-tmp')})
            monitor.ensure()
            result['measurements'].append(rows((output/(label+'.stdout')).read_text(), listed, index))
        monitor.close()
        result['state'] = 'PASS_CALENDAR_COST_SIX_ROWS'
    except BaseException as error:
        first_error = str(error) if isinstance(error, RuntimeError) else 'CALENDAR_EVIDENCE_FAILED'
    finally:
        errors = []
        try:
            monitor.close()
        except BaseException:
            errors.append({'check': 'quiet-monitor', 'code': 'CALENDAR_MONITOR_FAILED'})
        errors += final_checks(result, product, output, attempted,
                               verifier=lambda path: verify_product(path, git))
        try:
            settlement = reap_namespace()
            require(not settlement['remaining'], 'NAMESPACE_CHILDREN_REMAIN')
        except BaseException:
            settlement = {'remaining': 'UNKNOWN'}
            errors.append({'check': 'namespace-settlement', 'code': 'NAMESPACE_SETTLEMENT_FAILED'})
        try:
            require(sum(f.stat().st_size for f in output.rglob('*') if f.is_file()) <= EXPORT_BOUND,
                    'CALENDAR_EXPORT_BOUND')
        except BaseException:
            errors.append({'check': 'export-size', 'code': 'CALENDAR_EXPORT_BOUND'})
        first_error = first_error or (errors[0]['code'] if errors else None)
        result.update(first_error=first_error, cleanup_errors=errors, measurement_attempted=attempted,
                      namespace_settlement=settlement)
        if first_error:
            result['state'] = 'FAIL'
        write_json(output/'evidence.json', result)
    return 90 if first_error else 0
