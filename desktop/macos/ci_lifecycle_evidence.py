"""Bounded lifecycle snapshots and complete, redacted critical JSON receipts."""
import hashlib
import json
from pathlib import Path

from ci_lifecycle_contract import CASES, FRAMES, digest, canonical
from ci_support import MAX_FILE, MAX_TOTAL

PNG_MAX = 2 * 1024 * 1024
PNG_TOTAL = 30 * 1024 * 1024
NON_IMAGE_TOTAL = 12 * 1024 * 1024 - 256 * 1024
INDEX_MAX = 256 * 1024
EXPORT_TOTAL = 42 * 1024 * 1024
FINAL_METADATA_BYTES = 256 * 1024  # Inside the non-image budget, never extra capacity.


def capacity():
    """Declare and reconcile the finite envelope before any case reservation."""
    roster = [str(Path('lifecycle') / case / case / frame) for case in CASES for frame in FRAMES]
    if (len(set(roster)) != 15 or PNG_MAX * len(roster) != PNG_TOTAL
            or MAX_TOTAL != 12 * 1024 * 1024 or MAX_FILE != INDEX_MAX
            or NON_IMAGE_TOTAL + INDEX_MAX != MAX_TOTAL
            or PNG_TOTAL + NON_IMAGE_TOTAL + INDEX_MAX != EXPORT_TOTAL
            or FINAL_METADATA_BYTES != INDEX_MAX):
        raise RuntimeError('Lifecycle declared export capacity differs from its finite envelope')
    return {'PNG_paths': roster, 'PNG_each': PNG_MAX, 'PNG_total': PNG_TOTAL,
            'non_image_exported_payload': NON_IMAGE_TOTAL, 'index': INDEX_MAX,
            'total': EXPORT_TOTAL, 'critical_JSON_raw': MAX_TOTAL,
            'log_and_JSON_part': MAX_FILE, 'pending_final_metadata_within_non_image': FINAL_METADATA_BYTES}


def _budget(image_bytes, non_image_bytes, index_bytes, reserve=0):
    if min(image_bytes, non_image_bytes, index_bytes, reserve) < 0:
        raise RuntimeError('Invalid lifecycle export byte accounting')
    if image_bytes > PNG_TOTAL or non_image_bytes + reserve > NON_IMAGE_TOTAL:
        raise RuntimeError('Lifecycle image or non-image export budget exceeded')
    if index_bytes > INDEX_MAX or image_bytes + non_image_bytes + reserve + index_bytes > EXPORT_TOTAL:
        raise RuntimeError('Lifecycle export index or total budget exceeded')


def _excluded(relative):
    return any(part.endswith(('.app', '.xcresult')) or part.startswith('nac-lifecycle-app-')
               for part in relative.parts)


def _roster(actual, completed=None, final=False, failed_cases=None):
    allowed = {Path('lifecycle') / case / case / frame for case in CASES for frame in FRAMES}
    if actual - allowed:
        raise RuntimeError('Unexpected or duplicate lifecycle PNG path outside the fixed roster')
    if failed_cases is not None:
        attempted = tuple(failed_cases)
        if (final or completed is not None or not attempted or attempted != CASES[:len(attempted)]):
            raise RuntimeError('Partial lifecycle evidence requires a failed attempted-case prefix')
        expected = {Path('lifecycle') / case / case / frame for case in attempted for frame in FRAMES}
        if actual - expected:
            raise RuntimeError('Lifecycle failure PNG belongs to a case never dispatched')
        missing = sorted(str(path) for path in expected - actual)
        return {'result': 'failed_or_unknown', 'native_acceptance': False,
                'attempted_cases': list(attempted), 'capture_roster_complete': not missing,
                'incomplete': bool(missing), 'available_pngs': sorted(str(path) for path in actual),
                'missing_pngs': missing}
    if completed is None:
        completed = tuple(case for case in CASES if any(path.parts[1] == case for path in actual))
    completed = tuple(completed)
    if completed != CASES[:len(completed)] or (final and completed != CASES):
        raise RuntimeError('Lifecycle PNG cases are not the required completed prefix')
    expected = {Path('lifecycle') / case / case / frame for case in completed for frame in FRAMES}
    if actual != expected:
        raise RuntimeError('Lifecycle PNG roster has missing required snapshots')


def _index(manifest, image_bytes, non_image_bytes, reserve):
    data = (json.dumps(manifest, indent=2) + '\n').encode()
    _budget(image_bytes, non_image_bytes, len(data), reserve)
    return data


def images(destination, scenario, helper, native_report, raw):
    folder = destination / scenario
    expected = {folder / name for name in FRAMES}
    actual = set(destination.rglob('*.png'))
    if actual != expected:
        raise RuntimeError('Lifecycle case did not retain exactly its five snapshots')
    result = []
    for image in sorted(actual):
        canonical(image, parent=destination)
        if not image.is_file() or image.stat().st_size > PNG_MAX:
            raise RuntimeError('Lifecycle PNG missing or exceeds the unchanged image cap')
        role = 'sheet' if image.name.endswith('-sheet.png') else 'workspace'
        before = digest(image)
        observed = native_report([str(helper), role, str(image)],
                                 destination / (image.stem + '-reader.log'))
        if (not isinstance(observed, dict) or observed.get('role') != role
                or observed.get('readable') is not True
                or observed.get('composited_paint_acceptance') is not False
                or observed.get('trusted_input_acceptance') is not False):
            raise RuntimeError('Lifecycle native snapshot readability not established')
        if digest(image) != before:
            raise RuntimeError('Lifecycle PNG changed across native readability observation')
        result.append({'file': str(image.relative_to(raw)), 'sha256': before,
                       'bytes': image.stat().st_size, 'observation': observed})
    return result


def _redact(data, replacements):
    text = data.decode('utf-8', errors='replace')
    for source, replacement in replacements:
        if source:
            text = text.replace(source, replacement)
    return text.encode()


def export_plan(raw, replacements, *, completed=None, final=False, reserve=0, failed_cases=None):
    """JSON is complete or rejected. Oversize JSON has readable text parts.

    Redaction precedes splitting, so an exact secret cannot straddle pieces.
    Reassembling parts reproduces the full redacted JSON bytes, not a capped
    prefix. Binaries, bundles, private profile/store contents and env dumps are
    excluded; the case's native/summary receipts carry store semantics.
    A stopped ledger may request an incomplete attempted-case subset for
    failure evidence. This mode cannot satisfy completed/final success checks.
    """
    plan, manifest = [], []
    image_bytes, non_image_bytes = 0, 0
    pngs = [path for path in raw.rglob('*') if path.suffix.lower() == '.png'
            and not _excluded(path.relative_to(raw))]
    if any(not path.is_file() or path.is_symlink() for path in pngs):
        raise RuntimeError('Lifecycle PNG roster contains a non-file or symlink')
    actual = {path.relative_to(raw) for path in pngs}
    failure_status = _roster(actual, completed, final, failed_cases)
    for source in sorted(raw.rglob('*')):
        relative = source.relative_to(raw)
        if _excluded(relative):
            continue
        if source.is_symlink():
            raise RuntimeError('Unexpected symlink in lifecycle export')
        if not source.is_file() or source.suffix not in ('.json', '.log', '.png', '.ips', '.crash'):
            continue
        size = source.stat().st_size
        critical = source.suffix in ('.json', '.png')
        if critical and size > (PNG_MAX if source.suffix == '.png' else MAX_TOTAL):
            raise RuntimeError('Lifecycle critical receipt exceeds its unchanged bound')
        with source.open('rb') as stream:
            data = stream.read(MAX_TOTAL + 1 if critical else MAX_FILE)
        original_sha = digest(source)
        if source.suffix != '.png':
            data = _redact(data, replacements)
        entry = {'file': str(relative), 'raw_source_bytes': size, 'raw_source_sha256': original_sha,
                 'critical': critical, 'truncated': not critical and size > MAX_FILE,
                 'exported_sha256': hashlib.sha256(data).hexdigest(), 'exported_bytes': len(data)}
        if source.suffix == '.json' and len(data) > MAX_FILE:
            # The original JSON is represented completely by these parts. It
            # is never also exported as a misleading truncated .json file.
            text = data.decode('utf-8')
            entry['parts'] = []
            while text:
                count = min(len(text), MAX_FILE // 8)
                part_name = Path('complete-json') / relative / (str(len(entry['parts'])) + '.json')
                while True:
                    payload = (json.dumps({'text': text[:count]}, ensure_ascii=False) + '\n').encode()
                    if len(payload) <= MAX_FILE:
                        break
                    count //= 2
                entry['parts'].append({'file': str(part_name), 'bytes': len(payload),
                                       'sha256': hashlib.sha256(payload).hexdigest()})
                plan.append((part_name, payload))
                non_image_bytes += len(payload)
                _budget(image_bytes, non_image_bytes, 0, reserve)
                text = text[count:]
        else:
            plan.append((relative, data))
            if source.suffix == '.png':
                canonical(source, parent=raw)
                image_bytes += len(data)
            else:
                if source.suffix != '.json' and len(data) > MAX_FILE:
                    raise RuntimeError('Lifecycle redacted log exceeds its unchanged file bound')
                non_image_bytes += len(data)
        manifest.append(entry)
        _budget(image_bytes, non_image_bytes, 0, reserve)
    if failure_status is not None:
        relative = Path('failure-evidence.json')
        if any(entry['file'] == str(relative) for entry in manifest):
            raise RuntimeError('Lifecycle generated failure status collides with a source receipt')
        data = (json.dumps(failure_status, indent=2) + '\n').encode()
        if len(data) > MAX_FILE:
            raise RuntimeError('Lifecycle failure status exceeds its metadata file bound')
        plan.append((relative, data))
        non_image_bytes += len(data)
        manifest.append({'file': str(relative), 'generated': True, 'critical': True, 'truncated': False,
                         'exported_sha256': hashlib.sha256(data).hexdigest(), 'exported_bytes': len(data)})
    return plan, _index(manifest, image_bytes, non_image_bytes, reserve)


def export_evidence(raw, output, replacements):
    output.mkdir(parents=True, exist_ok=True)
    try:
        ledger = raw / 'lifecycle/ledger.json'
        state = json.loads(ledger.read_text()) if ledger.is_file() and not ledger.is_symlink() else {}
        final = state.get('phase') == 'complete'
        failed_cases = None
        if state.get('phase') in ('stopped_failed', 'stopped_unknown'):
            failed_cases = tuple(case for case in CASES
                                 if type(state.get('cases', {}).get(case, {}).get('dispatches')) is int
                                 and state['cases'][case]['dispatches'] == 1)
        plan, index = export_plan(raw, replacements, final=final, failed_cases=failed_cases)
    except Exception as error:
        # Preserve bounded admission/result diagnostics even when a critical
        # oversized receipt makes complete evidence impossible. Never call it
        # truncation-free acceptance, and never replay the case to replace it.
        failure = {'result': 'failed', 'critical_evidence_complete': False,
                   'error': _redact(str(error).encode(), replacements).decode()[:4096],
                   'retained_metadata': []}
        for name in ('ci-report.json', 'lifecycle/ledger.json', 'lifecycle/builds.json'):
            source = raw / name
            if source.is_file() and not source.is_symlink() and source.stat().st_size <= MAX_FILE:
                data = _redact(source.read_bytes(), replacements)
                if len(data) <= MAX_FILE:
                    path = output / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                    failure['retained_metadata'].append({'file': name, 'raw_sha256': digest(source),
                                                         'exported_sha256': hashlib.sha256(data).hexdigest()})
        (output / 'export-error.json').write_text(json.dumps(failure, indent=2) + '\n')
        raise
    for relative, data in plan:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    (output / 'export.json').write_bytes(index)
