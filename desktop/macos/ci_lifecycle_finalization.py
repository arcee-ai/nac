"""Finite lifecycle-only late writers and complete export staging.

Slots reserve capacity inside the existing non-image envelope. A producer that
violates a slot cannot publish a passing report. Complete bounded source bytes
remain available to the ordinary failed-evidence exporter.
"""
import json
import os
from pathlib import Path
import tempfile

from ci_lifecycle_contract import CASES, canonical, digest, persist
from ci_lifecycle_evidence import (FINAL_METADATA_BYTES, FINAL_TAIL_LIMITS, MAX_FILE,
                                    export_evidence, payload)

REPORT_BASE_LIMIT = 128 * 1024
GUI_VALUE_LIMIT = 32 * 1024


def serialized(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def charge(relative, data, replacements, limit):
    chunks, _, _ = payload(Path(relative), data, replacements)
    size = sum(len(part) for _, part in chunks)
    if size > limit:
        raise RuntimeError('Lifecycle finalization producer exceeds its exported slot: ' + str(relative))
    return size


def prepare(report, builds, replacements):
    """Reject oversized known report/build inputs before the first reservation."""
    value = dict(report or {}, lifecycle_builds=builds)
    base = charge('ci-report.json', serialized(value), replacements, REPORT_BASE_LIMIT)
    return {'reserved_non_image_bytes': FINAL_METADATA_BYTES, 'exported_slots': FINAL_TAIL_LIMITS,
            'report_baseline_bytes': base, 'report_baseline_limit': REPORT_BASE_LIMIT,
            'GUI_value_limit': GUI_VALUE_LIMIT,
            'rule': 'Every late writer is bounded; final actual plan precedes export acceptance'}


def ledger_guard(value, replacements):
    return charge('lifecycle/ledger.json', serialized(value), replacements, FINAL_TAIL_LIMITS['ledger'])


def result_guard(raw, path, replacements):
    canonical(path, parent=raw)
    return charge(path.relative_to(raw), path.read_bytes(), replacements, FINAL_TAIL_LIMITS['external_result'])


def gui_guard(value, replacements):
    return charge('GUI-value.json', serialized(value), replacements, GUI_VALUE_LIMIT)


def collect_crashes(raw, folder, started):
    """The established three 64KiB snippets, with fixed exportable log names."""
    records = []
    for source in sorted(folder.glob('NACPreview*')):
        if len(records) == 3:
            break
        if not source.is_file() or source.is_symlink() or source.stat().st_mtime < started:
            continue
        with source.open('rb') as stream:
            data = stream.read(65536)
        destination = raw / ('crash-' + str(len(records)) + '.log')
        destination.write_bytes(data)
        records.append({'file': destination.name, 'source_name': source.name,
                        'source_bytes': source.stat().st_size, 'retained_bytes': len(data),
                        'truncated': source.stat().st_size > len(data), 'retained_sha256': digest(destination)})
    return records


def _tail(raw, replacements):
    rows = {}
    fixed = [('ci-report.json', 'report'), ('lifecycle/ledger.json', 'ledger'),
             ('gui-reader-end.log', 'GUI_log'), *[(f'crash-{i}.log', f'crash_{i}') for i in range(3)]]
    for case in CASES:
        name = 'lifecycle/' + case + '/external-result.json'
        if (raw / name).exists():
            # Every result is checked; only the final result is a late slot.
            result_guard(raw, raw / name, replacements)
            fixed = [(n, slot) for n, slot in fixed if slot != 'external_result']
            fixed.append((name, 'external_result'))
    for name, slot in fixed:
        source = raw / name
        if not source.exists():
            continue  # Failure before that writer; never a successful capture claim.
        canonical(source, parent=raw)
        data = source.read_bytes()
        if source.suffix == '.log' and len(data) > MAX_FILE:
            raise RuntimeError('Lifecycle finalization log producer exceeds its raw file bound: ' + name)
        rows[name] = {'slot': slot, 'raw_bytes': len(data), 'raw_sha256': digest(source),
                      'exported_bytes': charge(name, data, replacements, FINAL_TAIL_LIMITS[slot])}
    return rows


def _publish(raw, output, replacements, *, failed_metadata=False):
    if output.exists() and any(output.iterdir()):
        raise RuntimeError('Lifecycle export destination must remain empty until atomic publication')
    stage = Path(tempfile.mkdtemp(prefix=output.name + '-staged-', dir=output.parent))
    try:
        export_evidence(raw, stage, replacements)
    except BaseException:
        if failed_metadata and (stage / 'export-error.json').is_file():
            os.replace(stage, output)
        raise
    os.replace(stage, output)


def finalize(raw, output, report, replacements, *, crashes=None, started=None):
    """No raw writer runs after this actual complete-plan acceptance check."""
    try:
        if crashes is not None:
            report['crash_snippets'] = collect_crashes(raw, crashes, started)
            report['crash_reports'] = len(report['crash_snippets'])
        persist(raw / 'ci-report.json', report)
        rows = _tail(raw, replacements)
        receipt = {'export_capacity_validated': True, 'report_result': report.get('result'),
                   'reserved_non_image_bytes': FINAL_METADATA_BYTES, 'slots': FINAL_TAIL_LIMITS,
                   'actual_tail': rows, 'native_acceptance': False}
        persist(raw / 'finalization.json', receipt)
        charge('finalization.json', serialized(receipt), replacements, FINAL_TAIL_LIMITS['finalization'])
        # Includes the actual report, result/ledger, GUI log, crashes, generated
        # failure receipt and index. No placeholder-only acceptance or late tail.
        _publish(raw, output, replacements)
    except BaseException as primary:
        report['result'] = 'failed'
        report['finalization_error'] = {'type': type(primary).__name__, 'error': str(primary)[:4096]}
        try:
            persist(raw / 'ci-report.json', report)
            persist(raw / 'finalization.json', {'export_capacity_validated': False,
                    'report_result': 'failed', 'native_acceptance': False,
                    'error': report['finalization_error']})
            # Preserve complete bounded originals even for a producer-slot
            # violation when the actual aggregate still fits; never claim pass.
            _publish(raw, output, replacements, failed_metadata=True)
        except BaseException as error:
            if hasattr(primary, 'add_note'):
                primary.add_note('Failed finalization evidence: ' + type(error).__name__)
        raise
