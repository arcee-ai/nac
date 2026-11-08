"""Collect only the nominated ordinary-startup test's named public attachments."""
import json
from collections import Counter
from pathlib import Path
import re
import stat
import struct
import tempfile
import zlib

from ci_startup_fixture import CASES, PRODUCT, TEST_SOURCE, TEST_FILES, SCHEMA, operations
from ci_xctest_attachments import bounded_file, digest, json_data, metadata_value

TEST_URL = 'test://com.apple.xcode/NACNativeUITests/NACStartupUITests/StartupJourneys/testOrdinaryStartup'
TEST_ID = 'StartupJourneys/testOrdinaryStartup()'
MAX_JSON = 64 * 1024
MAX_PNG = 2 * 1024 * 1024
MAX_SELECTED = 4 * MAX_PNG + 2 * 1024 * 1024
IDENTITY = ('app_pid', 'app_launch_epoch', 'window_number', 'app_path', 'native_sha256')
PROVENANCE = ('source_sha', 'test_source_sha', 'harness_sha', 'manifest_sha256', 'package_identity_sha256',
              'engine_identity_sha256', 'build_receipt_sha256', 'startup_source_sha256', 'native_sha256', 'engine_sha256')


class StartupAttachmentError(RuntimeError):
    def __init__(self, reason):
        super().__init__('Startup attachment rejected: ' + reason)
        self.reason = reason


def require(condition, reason):
    if not condition:
        raise StartupAttachmentError(reason)


def selected_test(tree):
    def cases(value):
        if isinstance(value, dict):
            if value.get('nodeType') == 'Test Case':
                yield value
            for item in value.values():
                yield from cases(item)
        elif isinstance(value, list):
            for item in value:
                yield from cases(item)
    found = list(cases(tree))
    require(len(found) == 1 and found[0].get('nodeIdentifierURL') == TEST_URL
            and found[0].get('nodeIdentifier') == TEST_ID, 'selected_test')
    return {'nodeIdentifier': TEST_ID, 'nodeIdentifierURL': TEST_URL, 'result': found[0].get('result')}


def png_identity(data):
    """Complete bounded PNG framing/CRC; actual decoding/OCR remains mandatory."""
    require(0 < len(data) <= MAX_PNG and data[:8] == b'\x89PNG\r\n\x1a\n', 'png_bound_or_signature')
    offset, dimensions, ended, image_data = 8, None, False, False
    while offset + 12 <= len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        end = offset + 12 + length
        require(end <= len(data), 'png_chunk_bound')
        kind, body = data[offset + 4:offset + 8], data[offset + 8:end - 4]
        require(zlib.crc32(kind + body) & 0xffffffff == struct.unpack('>I', data[end - 4:end])[0], 'png_crc')
        if dimensions is None:
            require(kind == b'IHDR' and length == 13, 'png_header')
            width, height = struct.unpack('>II', body[:8])
            require(800 <= width <= 8192 and 500 <= height <= 8192, 'png_dimensions')
            dimensions = {'width': width, 'height': height}
        elif kind == b'IHDR':
            require(False, 'png_duplicate_header')
        if kind == b'IDAT':
            image_data = True
        if kind == b'IEND':
            require(length == 0 and end == len(data) and image_data, 'png_end')
            ended = True
            break
        offset = end
    require(ended, 'png_incomplete')
    return {**dimensions, 'bytes': len(data), 'sha256': digest(data), 'actual_image_review_required': True}


def require_dispatch(row, config, configuration_sha256, witness, index):
    expected_operations = operations(config)
    number, stage = index // 2 + 1, 'before' if index % 2 == 0 else 'after'
    expected = {'schema': 'nac342-dispatch-v1', 'scenario': config['scenario'],
                'configuration_sha256': configuration_sha256, 'operation_index': number,
                'operation': expected_operations[number - 1], 'stage': stage,
                **{key: witness[key] for key in IDENTITY}}
    require(type(row) is dict and row == expected
            and all(type(row[key]) is type(value) for key, value in expected.items()), 'dispatch_binding_order_or_operation')
    return row


def require_cleanup(row, config, configuration_sha256, witness):
    expected = {'schema': 'nac342-cleanup-v1', 'scenario': config['scenario'],
                'configuration_sha256': configuration_sha256, 'app_pid': witness['app_pid'],
                'app_path': config['app_path'], 'app_termination_observed': True,
                'engine_cleanup': 'requires_external_exact_owner_audit',
                'profile_cleanup': 'requires_external_exact_owner_audit'}
    require(type(row) is dict and row == expected and row['app_termination_observed'] is True
            and type(row['app_pid']) is int, 'cleanup_binding')
    return row


def require_observation(row, config, configuration_sha256, witness, png):
    keys = set(PROVENANCE) | set(IDENTITY) | {
        'schema', 'scenario', 'configuration_sha256', 'bundle_id', 'ordinary_compile_mode', 'smoke_instrumentation',
        'operations', 'console', 'capture', 'png_sha256', 'visible_paint', 'input_method', 'physical_keyboard_or_ime_claim',
        'external_cleanup_required', 'future_schema_G2_assertion', 'expected_private_failure',
        'private_failure_observation', 'four_case_acceptance'}
    require(type(row) is dict and set(row) == keys, 'observation_fields')
    expected = {**{key: config[key] for key in PROVENANCE}, **{key: witness[key] for key in IDENTITY},
                'schema': SCHEMA, 'scenario': config['scenario'], 'configuration_sha256': configuration_sha256,
                'bundle_id': config['bundle_id'], 'ordinary_compile_mode': 'LOCAL_APP', 'smoke_instrumentation': False,
                'operations': operations(config), 'capture': 'public-XCTest-window-screenshot', 'png_sha256': png['sha256'],
                'visible_paint': 'requires_actual_image_review', 'input_method': 'public-XCTest',
                'physical_keyboard_or_ime_claim': False, 'external_cleanup_required': True,
                'private_failure_observation': 'not_read_by_public_UI_actor',
                'four_case_acceptance': 'requires_producer_source_binding_SDK_run_and_external_integrity_audits',
                'future_schema_G2_assertion': ('exact_unique_message_observed_producer_binding_required'
                                              if config['scenario'] == 'futureStore' else 'not_applicable'),
                'expected_private_failure': ({'kind': 'failed', 'version': 1, 'code': 'store_schema_incompatible',
                                             'stage': 'startup'} if config['scenario'] == 'futureStore' else {})}
    require(all(row[key] == value and type(row[key]) is type(value) for key, value in expected.items()), 'observation_binding')
    if config['scenario'] == 'futureStore':
        require(type(row['expected_private_failure'].get('version')) is int, 'declared_failure_version')
    console = row['console']
    require(isinstance(console, list) and len(console) == (26 if operations(config) else 4), 'console_count')
    for item in console:
        require(isinstance(item, dict) and set(item) == {'on_console', 'login_done', 'root_locked',
                'session_lock_flag', 'quartz_lock_flag', 'rendered_app_qualification_required'}, 'console_fields')
        require(item['on_console'] is True and item['login_done'] is True and item['root_locked'] is False
                and item['rendered_app_qualification_required'] is True
                and all(item[key] is None or item[key] is False for key in ('session_lock_flag', 'quartz_lock_flag')),
                'console_positive_observation')
    return row


def select_inventory(export, entries, fixed, pattern, index):
    """Inspect all metadata before payloads; late aliases invalidate prior rows."""
    files, names, selected = Counter(), Counter(), []
    metadata, errors = [], []
    index.update(selection_metadata=metadata, selection_errors=errors)
    total, first_error = 0, len(entries)
    for ordinal, entry in enumerate(entries):
        filename = entry.get('exportedFileName') if isinstance(entry, dict) else None
        name = entry.get('suggestedHumanReadableName') if isinstance(entry, dict) else None
        match = re.fullmatch(pattern, name) if isinstance(name, str) else None
        canonical = match[1] if match else None
        if isinstance(filename, str):
            files[filename] += 1
        if canonical:
            names[canonical] += 1
        row = {'ordinal': ordinal, 'name': metadata_value(name), 'filename': metadata_value(filename)}
        if len(metadata) < 64:
            metadata.append(row)
        try:
            require(isinstance(entry, dict), 'manifest_entry')
            require(isinstance(filename, str) and filename not in ('', '.', '..')
                    and not any(c in filename for c in ('/', '\\', '\0')) and files[filename] == 1, 'export_filename')
            file = export / filename
            info = file.lstat()
            require(stat.S_ISREG(info.st_mode), 'export_regular_file')
            require(isinstance(name, str), 'display_name')
            if not name.startswith('nac342-'):
                index['automatic_omitted'] += 1
                row.clear()
                row.update(ordinal=ordinal, kind='omitted_automatic')
                continue
            require(match is not None, 'named_attachment')
            dispatch = re.fullmatch(r'nac342-dispatch-v1-(\d{2})-(before|after)', canonical)
            kind = 'dispatch' if dispatch else fixed.get(canonical)
            require(kind is not None and names[canonical] == 1, 'foreign_or_duplicate_attachment')
            row['kind'] = kind
            if dispatch:
                row.update(operation_index=int(dispatch[1]), stage=dispatch[2])
            limit = MAX_PNG if kind in ('png', 'failure') else MAX_JSON
            require(info.st_size <= limit and total + info.st_size <= MAX_SELECTED, 'selected_size')
            total += info.st_size
            selected.append((ordinal, file, canonical, kind))
        except BaseException as error:
            first_error = min(first_error, ordinal)
            if len(errors) < 64:
                errors.append({'ordinal': ordinal, 'reason': error.reason if isinstance(error, StartupAttachmentError)
                               else 'inventory_unavailable'})
    # No ambiguous identity/file is ever copied, including a duplicate whose
    # later metadata points outside the export. Keep only a continuous dispatch
    # prefix preceding the first inventory error; never infer SDK chronology.
    return [(file, name, kind) for ordinal, file, name, kind in selected
            if files[file.name] == 1 and names[name] == 1 and (kind != 'dispatch' or ordinal < first_error)]


def collect(tool, result, config, configuration_sha256, witness, output):
    """Tool is the actual prepared H SDK observer; unit adapters are explicit."""
    output.mkdir()
    index = {'complete': False, 'selected': [], 'dispatches': [], 'automatic_omitted': 0,
             'input_completion_unknown': True, 'visible_paint': 'requires_actual_image_review'}
    try:
        require(config['scenario'] in CASES and witness.get('preinstalled') is True
                and witness.get('owned_incarnation_verified') is True, 'external_witness')
        require(config.get('source_sha') == PRODUCT and config.get('test_source_sha') == TEST_SOURCE
                and config.get('startup_source_sha256') == TEST_FILES['StartupJourneys.swift']
                and re.fullmatch('[0-9a-f]{40}', str(config.get('harness_sha', '')))
                and re.fullmatch('[0-9a-f]{64}', configuration_sha256), 'nominated_source_configuration')
        index.update(P=PRODUCT, Q=TEST_SOURCE, H=config['harness_sha'], configuration_sha256=configuration_sha256,
                     scenario=config['scenario'])
        require(type(witness.get('app_pid')) is int and witness['app_pid'] > 0
                and type(witness.get('window_number')) is int and witness['window_number'] > 0
                and type(witness.get('app_launch_epoch')) in (int, float) and witness['app_launch_epoch'] > 0
                and witness['app_path'] == config['app_path'] and witness['native_sha256'] == config['native_sha256'],
                'external_incarnation_binding')
        tree_bytes = tool.capture([tool.path, 'get', 'test-results', 'tests', '--path', str(result)],
                                  'startup-tests', retain=False)
        test = selected_test(json_data(tree_bytes))
        index.update(actual_test=test, test_tree_sha256=digest(tree_bytes))
        with tempfile.TemporaryDirectory(prefix='nac342-owned-attachments-') as temporary:
            export = Path(temporary).resolve() / 'export'
            tool.capture([tool.path, 'export', 'attachments', '--path', str(result), '--test-id', TEST_URL,
                          '--output-path', str(export)], 'startup-export', retain=False)
            require(export.is_dir() and not export.is_symlink(), 'private_export')
            manifest_bytes = bounded_file(export / 'manifest.json', 256 * 1024)
            index['manifest_sha256'] = digest(manifest_bytes)
            manifest = json_data(manifest_bytes)
            require(isinstance(manifest, list) and len(manifest) == 1 and isinstance(manifest[0], dict), 'manifest_group')
            group = manifest[0]
            require(group.get('testIdentifier') == TEST_ID
                    and group.get('testIdentifierURL', TEST_URL) == TEST_URL, 'manifest_test')
            entries = group.get('attachments')
            require(isinstance(entries, list) and len(entries) <= 4096, 'manifest_count')
            scenario = config['scenario']
            fixed = {f'nac342-ordinary-{scenario}': 'png', f'nac342-failure-{scenario}': 'failure',
                     f'nac342-ordinary-v1-{scenario}': 'observation', f'nac342-cleanup-v1-{scenario}': 'cleanup'}
            uuid = r'[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}'
            pattern = r'(nac342-[A-Za-z0-9-]+?)(?:_\d+_' + uuid + r')?(?:\.(?:json|png))?'
            selected = select_inventory(export, entries, fixed, pattern, index)
            # Admission of the complete inventory precedes any payload copy;
            # no later duplicate can retroactively invalidate a retained file.
            inventory_valid = not any(p.is_symlink() or not (p.is_file() or p.is_dir()) for p in export.rglob('*'))
            values, images, total = {}, {}, 0
            for file, name, kind in selected:
                data = bounded_file(file, MAX_PNG if kind in ('png', 'failure') else MAX_JSON)
                total += len(data)
                require(total <= MAX_SELECTED, 'growing_total')
                if kind == 'dispatch':
                    row = require_dispatch(json_data(data, MAX_JSON), config, configuration_sha256,
                                           witness, len(index['dispatches']))
                    require(name == 'nac342-dispatch-v1-' + f"{row['operation_index']:02d}-{row['stage']}", 'dispatch_name')
                    index['dispatches'].append(row)
                elif kind in ('png', 'failure'):
                    images[kind] = (name, data, png_identity(data))
                    continue  # Bind ordinary image and final JSON before copying either.
                else:
                    values[kind] = (name, data, json_data(data, MAX_JSON))
                    continue
                (output / (name + '.json')).write_bytes(data)
                index['selected'].append({'name': name, 'bytes': len(data), 'sha256': digest(data)})
            if 'failure' in images:
                name, data, identity = images['failure']
                (output / (name + '.png')).write_bytes(data)
                index['failure_image'] = identity
            require('cleanup' in values, 'cleanup_missing')
            cleanup = require_cleanup(values['cleanup'][2], config, configuration_sha256, witness)
            name, data, _ = values['cleanup']
            (output / (name + '.json')).write_bytes(data)
            index['cleanup'] = cleanup
            require('png' in images and 'observation' in values and 'failure' not in images, 'required_ordinary_observation')
            name, data, image = images['png']
            observation = require_observation(values['observation'][2], config, configuration_sha256, witness, image)
            (output / (name + '.png')).write_bytes(data)
            (output / (values['observation'][0] + '.json')).write_bytes(values['observation'][1])
            index.update(image=image, observation=observation)
            require(inventory_valid and not index['selection_errors'], 'complete_inventory')
            require(len(index['dispatches']) == len(operations(config)) * 2, 'dispatch_completion')
            require(test['result'] == 'Passed', 'actual_test_result')
            index.update(complete=True, image=image, observation=observation, input_completion_unknown=False)
        return index
    except BaseException as error:
        index['complete'] = False
        index['collection_error'] = {'type': type(error).__name__,
                                     'reason': error.reason if isinstance(error, StartupAttachmentError)
                                     else 'startup_collection_failed'}
        if isinstance(error, StartupAttachmentError):
            raise
        raise RuntimeError('Startup attachment collection failed; see bounded index') from None
    finally:
        (output / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
