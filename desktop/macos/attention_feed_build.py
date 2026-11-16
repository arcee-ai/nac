"""Source-bound command construction for the non-app attention fixture.

No build or native query occurs on import. Runtime callers must supply an exact
committed candidate and preserve the ordinary single-writer/gated build lane.
"""
import hashlib
import json
import re
import subprocess
from pathlib import Path

COMMON_SOURCES = ('AttentionFeedProtocol.swift', 'AttentionCompletions.swift',
                  'AttentionProjection.swift', 'NativeAttentionObserver.swift')
SWIFT_PROGRAMS = {
    'pure': (*COMMON_SOURCES, 'AttentionFeedTests.swift'),
    'http': (*COMMON_SOURCES, 'AttentionFeedHTTPFixture.swift'),
    'completions': ('AttentionFeedProtocol.swift', 'AttentionCompletions.swift', 'AttentionCompletionTests.swift'),
    'indicator': (*COMMON_SOURCES, 'NativeAttentionIndicator.swift', 'NativeAttentionIndicatorTests.swift'),
}
SOURCES = tuple(dict.fromkeys(source for group in SWIFT_PROGRAMS.values() for source in group))


def build_environment(environment):
    assert environment.get('CARGO_BUILD_JOBS') == '2', 'Use the allocated v5 Rust0/jobs2 build lane'
    target = Path(environment['CARGO_TARGET_DIR']).resolve()
    assert target.is_dir(), 'The caller must own its admitted target directory'
    return target


def swift_commands(compiler, sdk, owner, output, *, typecheck=False):
    flags = [str(compiler), '-swift-version', '5', '-target', 'arm64-apple-macosx14.0',
             '-sdk', str(sdk), '-warnings-as-errors']
    return {name: flags + [str(Path(owner) / source) for source in sources] +
            (['-typecheck'] if typecheck else ['-o', str(Path(output) / name)])
            for name, sources in SWIFT_PROGRAMS.items()}


def source_binding(root, source_ref):
    """An explicit full commit, exact HEAD/tree and clean checkout; no old-base premise."""
    assert re.fullmatch(r'[0-9a-f]{40}', source_ref or ''), 'Supply --source-ref as the admitted full commit SHA'
    root = Path(root)
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
    assert git('rev-parse', source_ref + '^{commit}') == source_ref
    assert git('rev-parse', 'HEAD') == source_ref, 'Checkout differs from the admitted producer candidate'
    assert not git('status', '--porcelain'), 'Qualification requires a clean committed candidate'
    assert not git('diff', source_ref, '--'), 'Tracked source drifted from the admitted candidate'
    return dict(source_revision=source_ref, source_tree=git('rev-parse', source_ref + '^{tree}'))


def producer_receipts(entries, binding, inspect_identity):
    assert len(entries) == 2 and {entry['mode'] for entry in entries} == {'ordinary', 'review'}
    binaries = {}
    for entry in entries:
        assert entry['source_binding'] == binding, 'Producer receipt is from a different source/tree'
        binary = Path(entry['binary'])
        assert hashlib.sha256(binary.read_bytes()).hexdigest() == entry['sha256'], 'Producer bytes changed'
        assert entry['identity'] == inspect_identity(binary), 'Private executable identity changed'
        assert entry['identity']['source_revision'] == binding['source_revision'], 'Producer embeds a different revision'
        binaries[entry['mode']] = entry
    return binaries


def completion_envelope(schemas):
    """DTO keys stay aligned; core's byte budget, not rows*worst-ID, bounds a page."""
    frame = next(value for value in schemas['AttentionFrame']['oneOf']
                 if value['properties']['kind']['enum'] == ['completions'])
    page_name = frame['properties']['page']['$ref'].rsplit('/', 1)[1]
    page_schema = schemas[page_name]
    assert set(page_schema['properties']) == {'store_id', 'cursor', 'high_water', 'baseline', 'more', 'items'}
    item_name = page_schema['properties']['items']['items']['$ref'].rsplit('/', 1)[1]
    assert set(schemas[item_name]['properties']) == {
        'sequence', 'session_id', 'run_id', 'behavior', 'kind', 'goal_id', 'mark_version'}
    encode = lambda value: json.dumps(value, separators=(',', ':')).encode()
    maximum = 2**63 - 1
    store = '10000000-0000-0000-0000-000000000001'
    def pages(items):
        core = dict(cursor=dict(store=store, sequence=maximum), high_water=maximum,
                    baseline=False, more=False, items=items)
        wire = dict(kind='completions', page=dict(store_id=store, cursor=maximum, high_water=maximum,
                                                baseline=False, more=False, items=items))
        return core, wire
    item = dict(sequence=maximum, session_id='"' * 512, run_id='"' * 512,
                behavior='direct-with-orchestrator', kind='goal', goal_id='"' * 512, mark_version=maximum)
    items = []
    while len(items) < 128 and len(encode(pages(items + [item])[0])) <= 64 * 1024:
        items.append(item)
    core, wire = pages(items)
    overhead = len(encode(wire)) - len(encode(core))
    assert items and len(items) < 128 and 0 <= overhead < 1024
    assert len(encode(wire)) <= 64 * 1024 + 1024
    small = dict(item, session_id='s', run_id='r', goal_id='g')
    row_core, row_wire = pages([small] * 128)
    assert len(encode(row_core)) <= 64 * 1024 and len(encode(row_wire)) <= 64 * 1024 + 1024
    return dict(kind='completions', rows_per_page=128, core_page_bytes=64 * 1024,
                byte_limited_worst_id_rows=len(items), maximum_escaped_item_bytes=len(encode(item)),
                dto_frame_overhead=overhead, byte_limited_frame_bytes=len(encode(wire)),
                row_limited_frame_bytes=len(encode(row_wire)), native_completion_frame_cap=64 * 1024 + 1024)
