"""Bounded lifecycle snapshots and complete, redacted critical JSON receipts."""
import hashlib
import json
from pathlib import Path

from ci_lifecycle_contract import FRAMES, digest, canonical
from ci_support import MAX_FILE, MAX_TOTAL


def images(destination, scenario, helper, native_report, raw):
    folder = destination / scenario
    expected = {folder / name for name in FRAMES}
    actual = set(destination.rglob('*.png'))
    if actual != expected:
        raise RuntimeError('Lifecycle case did not retain exactly its five snapshots')
    result = []
    for image in sorted(actual):
        canonical(image, parent=destination)
        if not image.is_file() or image.stat().st_size > 2 * 1024 * 1024:
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


def export_plan(raw, replacements):
    """JSON is complete or rejected. Oversize JSON has readable text parts.

    Redaction precedes splitting, so an exact secret cannot straddle pieces.
    Reassembling parts reproduces the full redacted JSON bytes, not a capped
    prefix. Binaries, bundles, private profile/store contents and env dumps are
    excluded; the case's native/summary receipts carry store semantics.
    """
    plan, manifest, total = [], [], 0
    for source in sorted(raw.rglob('*')):
        relative = source.relative_to(raw)
        if any(part.endswith(('.app', '.xcresult')) or part.startswith('nac-lifecycle-app-')
               for part in relative.parts):
            continue
        if source.is_symlink():
            raise RuntimeError('Unexpected symlink in lifecycle export')
        if not source.is_file() or source.suffix not in ('.json', '.log', '.png', '.ips', '.crash'):
            continue
        size = source.stat().st_size
        critical = source.suffix in ('.json', '.png')
        if critical and size > (2 * 1024 * 1024 if source.suffix == '.png' else MAX_TOTAL):
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
                total += len(payload)
                text = text[count:]
        else:
            plan.append((relative, data))
            total += len(data)
        manifest.append(entry)
        if total > MAX_TOTAL - MAX_FILE:
            raise RuntimeError('Lifecycle evidence leaves no bounded final-report/upload allowance')
    index = (json.dumps(manifest, indent=2) + '\n').encode()
    if len(index) > MAX_FILE or total + len(index) > MAX_TOTAL:
        raise RuntimeError('Lifecycle export index exceeds the unchanged evidence bound')
    return plan, index


def export_evidence(raw, output, replacements):
    output.mkdir(parents=True, exist_ok=True)
    try:
        plan, index = export_plan(raw, replacements)
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
