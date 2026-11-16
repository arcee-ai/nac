"""Retain only the terminal driver's bounded, actual XCTest attachments."""
import hashlib
from ci_paths_budget import check as budget_check, checked_digest
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
MAX_METADATA_ENTRIES = 64


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bounded_file(path, limit):
    budget_check()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise RuntimeError('Attachment file is not regular or exceeds its bound')
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError('Attachment file changed beyond its bound')
    budget_check()
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


class AttachmentSelectionError(RuntimeError):
    def __init__(self, reason, selected, ignored):
        messages = {'order': 'Terminal attachment gap, duplicate or reordering',
                    'bound': 'Terminal attachment bound before decoding',
                    'file': 'Attachment export contains an unsafe or nonregular file'}
        super().__init__(messages.get(reason, 'Terminal attachment manifest rejected'))
        self.reason, self.selected, self.ignored = reason, selected, ignored


def metadata_value(value):
    """No raw manifest strings, paths, URLs or exception text in diagnostics."""
    kind = {str: 'string', dict: 'object', list: 'array', int: 'integer',
            float: 'number', bool: 'boolean', type(None): 'null'}.get(type(value), 'other')
    result = {'type': kind}
    if isinstance(value, str):
        data = value.encode('utf-8', errors='surrogatepass')
        result.update(bytes=len(data), sha256=digest(data))
    return result


def selected_attachments(export, manifest, test, diagnostics=None):
    diagnostics = diagnostics if diagnostics is not None else {}
    diagnostics.update(manifest_type=metadata_value(manifest)['type'], entries=[],
                       metadata_entries_omitted=0, automatic_entries=0)
    if (not isinstance(manifest, list) or len(manifest) != 1
            or not isinstance(manifest[0], dict) or manifest[0].get('testIdentifier') != test['nodeIdentifier']):
        raise AttachmentSelectionError('test', [], 0)
    group = manifest[0]
    if 'testIdentifierURL' in group and group['testIdentifierURL'] != test['nodeIdentifierURL']:
        raise AttachmentSelectionError('test', [], 0)
    entries = group.get('attachments')
    diagnostics['entry_count'] = len(entries) if isinstance(entries, list) else None
    if not isinstance(entries, list) or len(entries) > 4096:
        raise AttachmentSelectionError('count', [], 0)
    selected, seen_files, seen_names = [], {}, {}
    first_error, prefix_limit, total, ignored = None, MAX_SNAPSHOTS, 0, 0
    uuid = r'[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}'
    pattern = PROTOCOL + r'-(\d{2})-(before|after)(?:_\d+_' + uuid + r')?(?:\.json)?'

    def reject(reason, row, limit=None):
        nonlocal first_error, prefix_limit
        first_error = first_error or reason
        row['reason'] = reason
        prefix_limit = min(prefix_limit, len(selected) if limit is None else limit)

    for ordinal, entry in enumerate(entries):
        row = {'ordinal': ordinal, 'entry_type': metadata_value(entry)['type']}
        # The bounded manifest is the input cap. This projection has its own
        # finite row cap; omitted metadata never relaxes inventory validation.
        if len(diagnostics['entries']) < MAX_METADATA_ENTRIES:
            diagnostics['entries'].append(row)
        else:
            diagnostics['metadata_entries_omitted'] += 1
        if not isinstance(entry, dict):
            reject('entry', row)
            continue
        filename = entry.get('exportedFileName', '')
        name = entry.get('suggestedHumanReadableName', '')
        row.update(filename=metadata_value(filename), name=metadata_value(name))
        canonical = None
        if not isinstance(name, str):
            reject('name', row)
        elif name.startswith('nac352-dispatch-'):
            match = re.fullmatch(pattern, name)
            if not match:
                reject('protocol', row)
            else:
                number, stage = int(match[1]), match[2]
                if not 1 <= number <= MAX_SNAPSHOTS:
                    reject('order', row)
                else:
                    canonical = f'{PROTOCOL}-{number:02d}-{stage}'
                    row.update(protocol=PROTOCOL, event_index=number, stage=stage, phase=(number + 1) // 2)
                    # Even an unsafe later file can make an earlier slot
                    # ambiguous. Examine owned identity before file admission.
                    if number in seen_names:
                        reject('order', row, seen_names[number])
                    else:
                        seen_names[number] = len(selected)
                    if number != len(selected) + 1 or stage != ('before' if number % 2 else 'after'):
                        reject('order', row)
        if (not isinstance(filename, str) or not filename or filename in ('.', '..')
                or '/' in filename or '\\' in filename or '\0' in filename):
            reject('filename', row)
            continue
        if filename in seen_files:
            reject('duplicate_file', row, seen_files[filename])
        else:
            seen_files[filename] = len(selected)
        file = export / filename
        try:
            info = file.lstat()
            row.update(file_type='regular' if stat.S_ISREG(info.st_mode) else 'nonregular', bytes=info.st_size)
        except (OSError, UnicodeError):
            reject('file', row)
            continue
        if not stat.S_ISREG(info.st_mode):
            reject('file', row)
            continue
        if not isinstance(name, str):
            continue
        if not name.startswith('nac352-dispatch-'):
            ignored += 1
            diagnostics['automatic_entries'] += 1
            # Automatic attachment content and identifying strings are absent.
            row.clear()
            row.update(ordinal=ordinal, kind='omitted_automatic')
            continue  # Never retain automatic screenshots, video or host data.
        if canonical is None:
            continue
        if info.st_size > MAX_SNAPSHOT or total + info.st_size > MAX_SNAPSHOT_TOTAL:
            reject('bound', row)
        if first_error is None:
            selected.append((file, canonical))
            total += info.st_size
    if first_error:
        diagnostics['reason'] = first_error
        raise AttachmentSelectionError(first_error, selected[:prefix_limit], ignored)
    return selected, ignored


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
            tool_hash = checked_digest(stream).hexdigest()
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
                unsafe_inventory = any(member.is_symlink() or not (member.is_file() or member.is_dir())
                                       for member in export.rglob('*'))
                manifest_bytes = bounded_file(export / 'manifest.json', MAX_FILE)
                index['manifest_sha256'] = digest(manifest_bytes)
                manifest = json_data(manifest_bytes)
                selection_error = None
                index['selection_metadata'] = {}
                try:
                    selected, ignored = selected_attachments(export, manifest, test, index['selection_metadata'])
                except AttachmentSelectionError as error:
                    selection_error, selected, ignored = error, error.selected, error.ignored
                    index['selection_metadata']['reason'] = error.reason
                index['omitted_automatic_attachments'] = ignored
                snapshots, total = [], 0
                for file, name in selected:
                    data = bounded_file(file, MAX_SNAPSHOT)
                    total += len(data)
                    if total > MAX_SNAPSHOT_TOTAL:
                        raise RuntimeError('Terminal attachment prefix exceeds its total bound before copying')
                    metadata = {'file': name + '.json', 'exported_file_sha256': metadata_value(file.name)['sha256'],
                                'bytes': len(data), 'sha256': digest(data)}
                    try:
                        candidate = json_data(data, MAX_SNAPSHOT)
                        prefix = require_snapshots([*snapshots, candidate], binding, operations)
                    except BaseException as error:
                        index['rejected_input'] = {**metadata, 'retained': False,
                                                  'error_type': type(error).__name__}
                        raise RuntimeError('Terminal attachment JSON or producer prefix rejected') from None
                    # Retain only after this complete prefix has passed JSON,
                    # identity, literal, state and earlier-row immutability checks.
                    (folder / (name + '.json')).write_bytes(data)
                    index['snapshots'].append(metadata)
                    snapshots.append(candidate)
                    index.update(prefix)
                index.update(require_snapshots(snapshots, binding, operations))
                if selection_error:
                    raise selection_error
                if unsafe_inventory:
                    raise RuntimeError('Unexpected symlink/nonregular member in private XCTest export')
                if index['complete']:
                    (self.raw / 'xctest-driver.json').write_text(json.dumps(index['rows'], indent=2) + '\n')
            return index
        except BaseException as error:
            index['complete'] = False
            index['collection_error'] = {'type': type(error).__name__, 'reason': 'attachment_collection_failed'}
            raise
        finally:
            (folder / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
