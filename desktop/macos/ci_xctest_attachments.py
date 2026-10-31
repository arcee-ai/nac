"""Retain only the terminal driver's bounded, actual XCTest attachments."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

from ci_support import MAX_FILE

PROTOCOL = 'nac352-dispatch-v1'
TEST_URL = 'test://com.apple.xcode/NACNativeUITests/NACNativeUITests/NativeJourneys/testTerminalUnicodeControlResize'
MAX_SNAPSHOT = 64 * 1024
MAX_SNAPSHOTS = 12
MAX_SNAPSHOT_TOTAL = MAX_SNAPSHOT * MAX_SNAPSHOTS


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bounded_file(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise RuntimeError('Attachment file is not regular or exceeds its bound')
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError('Attachment file changed beyond its bound')
    return data


def json_data(data, limit=MAX_FILE):
    if len(data) > limit:
        raise RuntimeError('XCTest JSON exceeds its bound before decoding')
    return json.loads(data)


def actual_test(tree):
    def nodes(value):
        if isinstance(value, dict):
            if value.get('nodeType') == 'Test Case':
                yield value
            for child in value.values():
                yield from nodes(child)
        elif isinstance(value, list):
            for child in value:
                yield from nodes(child)
    cases = list(nodes(tree))
    if len(cases) != 1 or cases[0].get('nodeIdentifierURL') != TEST_URL or not cases[0].get('nodeIdentifier'):
        raise RuntimeError('Actual xcresult did not select exactly the nominated terminal test URL')
    return {key: cases[0].get(key) for key in ('nodeIdentifier', 'nodeIdentifierURL', 'name', 'result')}


def require_source_binding(binding):
    hashes = {'harness_sha': 40, 'target_sha': 40, 'operation_contract_sha256': 64}
    if (not isinstance(binding, dict) or set(binding) != set(hashes) | {'test_identifier_url'}
            or binding.get('test_identifier_url') != TEST_URL
            or any(not re.fullmatch('[0-9a-f]{' + str(length) + '}', str(binding.get(key, '')))
                   for key, length in hashes.items())):
        raise RuntimeError('Nominated terminal observer source/test binding is incomplete')


def require_binding(binding):
    hashes = {'harness_sha': 40, 'target_sha': 40, 'configuration_sha256': 64,
              'operation_contract_sha256': 64, 'native_sha256': 64}
    if (set(binding) != set(hashes) | {'test_identifier_url', 'app'}
            or binding.get('test_identifier_url') != TEST_URL
            or any(not re.fullmatch('[0-9a-f]{' + str(length) + '}', str(binding.get(key, '')))
                   for key, length in hashes.items())):
        raise RuntimeError('Terminal attachment source/configuration/native binding incomplete')
    app = binding.get('app', {})
    if (not isinstance(app, dict) or type(app.get('schema')) is not int or app['schema'] != 1
            or app.get('total_seconds_limit') != 240
            or app.get('unfocused_guard_rejected') is not True
            or any(type(app.get(key)) is not int or app[key] <= 0
                   for key in ('app_pid', 'engine_pid', 'target_window_number'))
            or type(app.get('app_launch_epoch')) not in (float, int) or app['app_launch_epoch'] <= 0
            or any(not isinstance(app.get(key), str) or not 0 < len(app[key]) <= 4096
                   for key in ('bundle_path', 'session_id', 'terminal_id', 'controller_revision'))
            or not Path(app['bundle_path']).is_absolute()):
        raise RuntimeError('Terminal attachment app incarnation/controller binding incomplete')


def require_snapshots(snapshots, binding, operations):
    """No gap, reordering, prior-row edit, replay or inferred completion."""
    if len(snapshots) > MAX_SNAPSHOTS or len(operations) != 6:
        raise RuntimeError('Unexpected terminal attachment/operation count')
    if snapshots:
        require_binding(binding)
    previous = []
    previous_time = -1
    for number, snapshot in enumerate(snapshots, 1):
        stage = 'before' if number % 2 else 'after'
        phase = (number - 1) // 2
        rows = snapshot.get('rows', [])
        stamp = snapshot.get('uptime_ns', '')
        if (set(snapshot) != {'schema', 'event_index', 'stage', 'uptime_ns', 'binding', 'rows'}
                or snapshot.get('schema') != PROTOCOL or type(snapshot.get('event_index')) is not int
                or snapshot['event_index'] != number or snapshot.get('stage') != stage
                or snapshot.get('binding') != binding or not isinstance(stamp, str)
                or not re.fullmatch('[0-9]{1,20}', stamp) or not 0 < int(stamp) < 2**64
                or int(stamp) <= previous_time
                or not isinstance(rows, list) or len(rows) != phase + 1):
            raise RuntimeError('Terminal attachment binding/order/state differs')
        for index, row in enumerate(rows):
            expected = operations[index]
            pending = index == phase and stage == 'before'
            fields = set(expected) | {'state'} | (set() if pending else {'elapsed_ms'})
            if (not isinstance(row, dict) or set(row) != fields
                    or any(type(row.get(key)) is not type(value) or row[key] != value for key, value in expected.items())
                    or row.get('state') != ('dispatching-once' if pending else 'dispatched-once')):
                raise RuntimeError('Terminal attachment phase/literal/provenance differs')
            if not pending and (type(row.get('elapsed_ms')) is not int
                                or not 0 <= row['elapsed_ms'] <= expected['seconds_limit'] * 1000):
                raise RuntimeError('Terminal attachment operation deadline differs')
        if ((stage == 'before' and rows[:-1] != previous)
                or (stage == 'after' and rows[:-1] != previous[:-1])):
            raise RuntimeError('Terminal attachment rewrote an earlier observation')
        previous, previous_time = rows, int(stamp)
    return {'complete': len(snapshots) == MAX_SNAPSHOTS, 'rows': previous,
            'observed_snapshots': len(snapshots),
            'input_completion_unknown': bool(snapshots and snapshots[-1]['stage'] == 'before'),
            'partial_scope': 'A dispatching snapshot may include partial input; never replay or infer zero input'}


def selected_attachments(export, manifest, test):
    if (not isinstance(manifest, list) or len(manifest) != 1
            or not isinstance(manifest[0], dict) or manifest[0].get('testIdentifier') != test['nodeIdentifier']):
        raise RuntimeError('Attachment manifest belongs to a foreign or ambiguous test')
    group = manifest[0]
    if 'testIdentifierURL' in group and group['testIdentifierURL'] != test['nodeIdentifierURL']:
        raise RuntimeError('Attachment manifest URL differs from the actual selected test')
    entries = group.get('attachments')
    if not isinstance(entries, list) or len(entries) > 4096:
        raise RuntimeError('Attachment manifest count is unavailable or unbounded')
    selected, seen_files, seen_names = [], set(), set()
    uuid = r'[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}'
    pattern = PROTOCOL + r'-(\d{2})-(before|after)(?:_\d+_' + uuid + r')?(?:\.json)?'
    for entry in entries:
        if not isinstance(entry, dict):
            raise RuntimeError('Attachment manifest entry is malformed')
        filename = entry.get('exportedFileName', '')
        name = entry.get('suggestedHumanReadableName', '')
        if (not isinstance(filename, str) or not filename or filename in ('.', '..')
                or '/' in filename or '\\' in filename or '\0' in filename or filename in seen_files):
            raise RuntimeError('Attachment filename is duplicate or escaped its private export')
        seen_files.add(filename)
        file = export / filename
        info = file.lstat()
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError('Attachment export contains a symlink or nonregular file')
        if not isinstance(name, str):
            raise RuntimeError('Attachment display name is malformed')
        if not name.startswith('nac352-dispatch-'):
            continue  # Never retain automatic screenshots, video or host data.
        match = re.fullmatch(pattern, name)
        if not match:
            raise RuntimeError('Foreign/malformed terminal attachment protocol')
        number, stage = int(match[1]), match[2]
        canonical = f'{PROTOCOL}-{number:02d}-{stage}'
        if (not 1 <= number <= MAX_SNAPSHOTS or canonical in seen_names
                or number != len(selected) + 1 or stage != ('before' if number % 2 else 'after')):
            raise RuntimeError('Terminal attachment gap, duplicate or reordering')
        seen_names.add(canonical)
        selected.append((file, canonical))
    if sum(file.stat().st_size for file, _ in selected) > MAX_SNAPSHOT_TOTAL:
        raise RuntimeError('Terminal attachments exceed their total bound before decoding')
    if any(file.stat().st_size > MAX_SNAPSHOT for file, _ in selected):
        raise RuntimeError('Terminal attachment exceeds its individual bound before decoding')
    return selected, len(entries) - len(selected)


class AttachmentTool:
    """Record the real selected SDK tool, commands and bounded schemas."""
    def __init__(self, raw, command):
        self.raw, self.command, self.calls = raw, command, []
        self.path = None

    def capture(self, argv, name, retain=True):
        output, status = '', 0
        try:
            output = self.command(argv)
            return output.encode()
        except subprocess.CalledProcessError as error:
            status, output = error.returncode, error.output or ''
            raise
        except BaseException as error:
            status, output = type(error).__name__, str(error)
            raise
        finally:
            data = output if isinstance(output, bytes) else output.encode()
            self.calls.append({'argv': argv, 'status': status, 'bytes': len(data), 'sha256': digest(data),
                               'retention': 'bounded text' if retain else 'hash/identity projection only'})
            if retain:
                (self.raw / (name + '.log')).write_bytes(data[:MAX_FILE])
            self.save()
            if len(data) > MAX_FILE:
                raise RuntimeError('XCTest tool output exceeds its bound before JSON decoding')

    def save(self):
        (self.raw / 'xctest-attachment-tool.json').write_text(json.dumps({
            'resolved_tool': self.path, 'identity': getattr(self, 'identity', None),
            'calls': self.calls}, indent=2) + '\n')

    def prepare(self):
        self.path = str(Path(self.capture(['xcrun', '--find', 'xcresulttool'], 'xctest-tool-path').decode().strip()).resolve())
        developer = Path(os.environ['DEVELOPER_DIR']).resolve()
        tool = Path(self.path)
        if not tool.is_file() or not tool.is_relative_to(developer.parent.parent):
            raise RuntimeError('Resolved xcresulttool is outside the selected Xcode bundle')
        with tool.open('rb') as stream:
            tool_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
        self.identity = {'path': self.path, 'sha256': tool_hash,
                         'version': self.capture([self.path, 'version'], 'xctest-tool-version').decode()}
        self.save()
        (self.raw / 'xctest-attachment-tool-identity.json').write_text(json.dumps(self.identity, indent=2) + '\n')
        for command, required in [(['export', 'attachments'], ('attachments', 'exportedFileName', 'suggestedHumanReadableName', 'testIdentifier')),
                                  (['get', 'test-results', 'tests'], ('testNodes', 'nodeType', 'nodeIdentifierURL'))]:
            stem = 'xctest-tool-' + '-'.join(command)
            self.capture([self.path, 'help', *command], stem + '-help')
            data = self.capture([self.path, *command, '--schema'], stem + '-schema')
            schema = json_data(data)
            serialized = json.dumps(schema)
            if not all('"' + key + '"' in serialized for key in required):
                raise RuntimeError('Selected xcresulttool schema lacks the required identity/attachment fields')
        return self

    def collect(self, result, binding, operations):
        if (self.raw / 'xctest-driver.json').exists():
            raise RuntimeError('Refusing a stale or pre-existing driver observation')
        folder = self.raw / 'xctest-dispatch-observations'
        folder.mkdir(exist_ok=True)
        index = {'test_identifier_url': TEST_URL, 'snapshots': [], 'complete': False}
        try:
            tree_bytes = self.capture([self.path, 'get', 'test-results', 'tests', '--path', str(result)],
                                      'xctest-actual-tests', retain=False)
            test = actual_test(json_data(tree_bytes))
            index.update(actual_test=test, actual_test_tree_sha256=digest(tree_bytes))
            with tempfile.TemporaryDirectory(prefix='nac-owned-xctest-attachments-') as temporary:
                export = Path(temporary).resolve() / 'export'
                argv = [self.path, 'export', 'attachments', '--path', str(result), '--test-id', TEST_URL,
                        '--output-path', str(export)]
                self.capture(argv, 'xctest-attachment-export', retain=False)
                if export.is_symlink() or not export.is_dir():
                    raise RuntimeError('XCTest did not create a private regular export directory')
                for member in export.rglob('*'):
                    if member.is_symlink() or not (member.is_file() or member.is_dir()):
                        raise RuntimeError('Unexpected symlink/nonregular member in private XCTest export')
                manifest_bytes = bounded_file(export / 'manifest.json', MAX_FILE)
                index['manifest_sha256'] = digest(manifest_bytes)
                manifest = json_data(manifest_bytes)
                selected, ignored = selected_attachments(export, manifest, test)
                index['manifest_test'] = {'identifier': manifest[0]['testIdentifier'],
                                          'url': manifest[0].get('testIdentifierURL')}
                index['omitted_automatic_attachments'] = ignored
                snapshots = []
                for file, name in selected:
                    data = bounded_file(file, MAX_SNAPSHOT)
                    metadata = {'file': name + '.json', 'exported_file': file.name,
                                'bytes': len(data), 'sha256': digest(data)}
                    try:
                        candidate = json_data(data, MAX_SNAPSHOT)
                        prefix = require_snapshots([*snapshots, candidate], binding, operations)
                    except BaseException as error:
                        index['rejected_input'] = {**metadata, 'retained': False,
                                                  'error_type': type(error).__name__}
                        raise
                    # Retain only after this complete prefix has passed JSON,
                    # identity, literal, state and earlier-row immutability checks.
                    (folder / (name + '.json')).write_bytes(data)
                    index['snapshots'].append(metadata)
                    snapshots.append(candidate)
                    index.update(prefix)
                index.update(require_snapshots(snapshots, binding, operations))
                if index['complete']:
                    (self.raw / 'xctest-driver.json').write_text(json.dumps(index['rows'], indent=2) + '\n')
            return index
        except BaseException as error:
            index['collection_error'] = {'type': type(error).__name__, 'message': str(error)[:4096]}
            raise
        finally:
            (folder / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
