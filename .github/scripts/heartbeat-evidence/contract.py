"""Pure contracts for one explicitly selected heartbeat evidence run."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import uuid

HEAD = '48b9769453c7cb0b245d9f9b1f955ef4a880a431'
TREE = 'b2f53563c8bebdc8322c636b74a57fac1f981086'
BASELINE = 'adefd79e7b43c35f98d760ffa5ff846dc8c13e32'
ASSETS = '502447dd764fdc4be9db1816fa67d74c4ff9f36b'
BRANCH = 'refs/heads/codex/all-480-linux-evidence'
MODE = 'matched-and-measure'
CUSTODY_MODE = 'custody-check'
TEST = 'application::heartbeat_scheduler::tests::heartbeat_scheduler_measure_1_10_100_with_two_owners_and_bounded_chat_contention'
METRICS = {'cold_scan_ms', 'warm_p50_ms', 'warm_p95_ms', 'warm_max_ms',
           'maximum_admission_lateness_ms', 'database_bytes',
           'resident_before_kib', 'resident_active_kib'}


def require(value, code):
    if not value:
        raise RuntimeError(code)


def validate_request(control, event, ref, mode, head, tree, baseline, *, expected_mode=MODE):
    require(expected_mode in (MODE, CUSTODY_MODE), 'EXPECTED_EVIDENCE_MODE')
    require(bool(re.fullmatch('[0-9a-f]{40}', control)), 'CONTROL_SHA')
    require(event == 'workflow_dispatch' and ref == BRANCH and mode == expected_mode, 'EXPLICIT_DISPATCH')
    require((head, tree, baseline) == (HEAD, TREE, BASELINE), 'PRODUCT_PINS')


def validate_event(event, mode, control, *, expected_mode=MODE):
    require(expected_mode in (MODE, CUSTODY_MODE), 'EXPECTED_EVIDENCE_MODE')
    inputs = event.get('inputs') if type(event) is dict else None
    require(type(inputs) is dict and set(inputs) == {'heartbeat_evidence', 'heartbeat_control_sha'},
            'DISPATCH_INPUT_SCHEMA')
    require(inputs['heartbeat_evidence'] == mode == expected_mode
            and inputs['heartbeat_control_sha'] == control, 'DISPATCH_INPUT_BINDING')


def sha256(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            value.update(block)
    return value.hexdigest()


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.pending')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def measurement_inventory(stdout):
    lines = [line for line in stdout.splitlines() if line]
    require(bool(lines), 'MEASUREMENT_INVENTORY_EMPTY')
    summary = re.fullmatch(r'(\d+) tests?, (\d+) benchmarks?', lines[-1])
    require(summary is not None and summary[2] == '0', 'MEASUREMENT_INVENTORY_SUMMARY')
    entries = [re.fullmatch(r'(\S+): test', line) for line in lines[:-1]]
    require(all(entries), 'MEASUREMENT_INVENTORY_ENTRY')
    names = [entry[1] for entry in entries]
    require(len(names) == int(summary[1]) and len(set(names)) == len(names),
            'MEASUREMENT_INVENTORY_COUNT')
    require(names.count(TEST) == 1, 'MEASUREMENT_INVENTORY_SELECTION')
    return {'registered_tests': names, 'total': len(names), 'measurement_test': TEST}


def measurement_rows(stdout, inventory):
    names = inventory['registered_tests']
    require(inventory['total'] == len(names) == len(set(names)) and names.count(TEST) == 1
            and inventory['measurement_test'] == TEST, 'MEASUREMENT_INVENTORY_BINDING')
    require(re.findall(r'^running (\d+) tests?$', stdout, re.M) == ['1'], 'EXACT_ONE_MEASUREMENT_TEST')
    selected = re.findall(r'^test (\S+) \.\.\.', stdout, re.M)
    require(selected == [TEST], 'MEASUREMENT_TEST_NAME')
    summaries = re.findall(r'^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; '
                           r'(\d+) measured; (\d+) filtered out; finished in [^\n]+$', stdout, re.M)
    require(len(summaries) == 1 and summaries[0][:5] == ('ok', '1', '0', '0', '0'),
            'EXACT_ONE_MEASUREMENT_TEST')
    require(int(summaries[0][5]) == inventory['total']-1, 'MEASUREMENT_FILTER_COUNT')
    # libtest prints the test prefix before the first println with --nocapture.
    rows = [json.loads(value) for value in re.findall(
        r'(?:^|\s)HEARTBEAT_MEASUREMENT (\{[^\n]*\})', stdout, re.M)]
    require(len(rows) == 3, 'THREE_MEASUREMENT_ROWS')
    for row, schedules, admitted in zip(rows, (1, 10, 100), (1, 4, 4)):
        require(type(row) is dict and set(row) == METRICS | {
            'schedules', 'runnable_chats', 'owners', 'admitted', 'pending'}, 'MEASUREMENT_SCHEMA')
        for key, expected in {'schedules': schedules, 'runnable_chats': admitted, 'owners': 2,
                              'admitted': admitted, 'pending': schedules-admitted}.items():
            require(type(row[key]) is int and row[key] == expected, 'MEASUREMENT_CARDINALITY')
        for key in METRICS:
            value = row[key]
            require(type(value) in (int, float) and math.isfinite(value) and value >= 0,
                    'MEASUREMENT_VALUE')
        require(row['warm_p50_ms'] <= row['warm_p95_ms'] <= row['warm_max_ms'], 'MEASUREMENT_ORDER')
    return rows


def test_executable(cargo_stdout):
    choices = []
    for line in cargo_stdout.splitlines():
        item = json.loads(line)
        if (item.get('reason') == 'compiler-artifact' and item.get('profile', {}).get('test')
                and item.get('target', {}).get('name') == 'nac_server' and item.get('executable')):
            choices.append(item['executable'])
    require(len(choices) == 1, 'EXACT_TEST_EXECUTABLE')
    return Path(choices[0])


def verify_pair(directory):
    directory = Path(directory)
    result = json.loads((directory/'manifest.json').read_text())
    require(result['status'] == 'passed' and result['head'] == HEAD
            and result['baseline']['revision'] == BASELINE, 'CAPTURE_IDENTITY')
    require(result['current']['assets_tree'] == ASSETS, 'CAPTURE_ASSETS')
    require(result['before'] == result['after'] and result['after'].get('active_run') is None
            and result['provider_requests'] == [], 'CAPTURE_NO_WORK')
    require(len(result['captures']) == len(result['settled_ui']) == 2, 'EXACT_CAPTURE_PAIR')
    require(result['cleanup']['status'] != 'UNRESOLVED', 'CAPTURE_CLEANUP')
    pairs = []
    for label, visible in [('baseline', False), ('current', True)]:
        capture = next(item for item in result['captures'] if item['label'] == label)
        require(capture['inspection_status'] == 404 and capture['visible_error'] is visible, 'CAPTURE_STATE')
        file = directory/(label+'-missing-heartbeat-inspection.png')
        require(file.is_file() and not file.is_symlink() and file.stat().st_size <= 32*1024*1024, 'PNG_FILE')
        with file.open('rb') as stream:
            header = stream.read(24)
        require(header[:8] == b'\x89PNG\r\n\x1a\n' and header[12:16] == b'IHDR', 'PNG_HEADER')
        width, height = struct.unpack('>II', header[16:24])
        require((width, height) == (1920, 1200), 'PNG_DIMENSIONS')
        pairs.append({'label': label, 'file': file.name, 'sha256': sha256(file), 'width': width, 'height': height})
    return pairs


def artifact_manifest(root):
    root = Path(root)
    files = []
    for file in sorted(root.rglob('*')):
        require(not file.is_symlink(), 'ARTIFACT_SYMLINK')
        if file.is_file() and file.name != 'artifact-manifest.json':
            files.append({'file': str(file.relative_to(root)), 'bytes': file.stat().st_size,
                          'sha256': sha256(file)})
    return {'files': files, 'pixel_inspection': 'PENDING individual original PNG review',
            'limits': 'Linux VM samples; scripted/blocked vendor; no physical-host or Darwin qualification'}
