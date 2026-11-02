"""Path-specific attachment admission through H's existing SDK export owner."""
from ci_paths_budget import check as budget_check, checked_items
from collections import Counter
import json
from pathlib import Path
import re
import tempfile

from ci_paths_protocol import CASES, Cursor, PRODUCT, HELPER, decode, require
from ci_startup_attachments import png_identity
from ci_xctest_attachments import bounded_file, digest

CAPTURES = (('chooser-unicode', 'reloaded-form', 'moved-folder-error', 'session-files', 'finder-selected'),
            ('failure-panel',))
TESTS = ('testFolderSelection', 'testPendingEngineFailure')


def identities(scenario):
    method = TESTS[CASES.index(scenario)]
    return ('PathJourneys/' + method + '()',
            'test://com.apple.xcode/NACNativeUITests/NACPathUITests/PathJourneys/' + method)


def validate_payloads(values, config, configuration_hash, *, passing):
    """Actual producer history and original PNGs; paint still needs human review."""
    scenario = config['scenario']
    require(scenario in CASES and config['product_sha'] == PRODUCT and config['helper_sha256'] == HELPER,
            'attachment source/case')
    controller = decode(values['nac347-controller'])
    require(controller.get('schema') == 'nac347-controller-v1'
            and controller.get('scenario') == scenario
            and controller.get('configuration_sha256') == configuration_hash, 'controller binding')
    history = controller.get('history', [])
    require(type(history) is list and 0 < len(history) <= (5 if scenario == CASES[0] else 2), 'phase history bound')
    scope = {k: v for k, v in history[0].items() if k not in ('version', 'name', 'sequence')}
    cursor = Cursor(scope)
    for phase in history:
        budget_check()
        cursor.accept(phase)
    inputs = controller.get('inputs')
    require(type(inputs) is int and 0 <= inputs <= 160, 'input bound')
    rows = []
    for number in range(1, inputs + 1):
        budget_check()
        row = decode(values[f'nac347-input-{number:03d}'])
        require(row.get('schema') == 'nac347-input-v1' and row.get('index') == number
                and row.get('configuration_sha256') == configuration_hash
                and row.get('authorization_policy_unchanged') is True
                and row.get('app_pid') == scope['app_pid'] and row.get('window') == scope['window']
                and row.get('run') == scope['run'], 'per-input source/custody')
        require(type(row.get('sequence')) is int and 0 <= row['sequence'] < len(history)
                and row.get('phase') == history[row['sequence']]['name']
                and row.get('document') == history[row['sequence']]['document'], 'input phase/document')
        require(type(row.get('engine_start')) is list and len(row['engine_start']) == 3
                and row['engine_start'][0] == scope['engine_pid'] and row['engine_start'][1] > 0
                and 0 <= row['engine_start'][2] < 1_000_000
                and type(row.get('app_launch_epoch')) in (float, int) and row['app_launch_epoch'] > 0,
                'OS launch/start witness')
        if rows:
            require(row['sequence'] >= rows[-1]['sequence']
                    and row['engine_start'] == rows[0]['engine_start']
                    and row['app_launch_epoch'] == rows[0]['app_launch_epoch'], 'input incarnation changed')
        rows.append(row)
    expected = CAPTURES[CASES.index(scenario)]
    actual = controller.get('captures')
    require(type(actual) is list and len(actual) == len(set(actual)) and set(actual) <= set(expected), 'capture roster')
    total = 0
    images = []
    for name in actual:
        budget_check()
        data = values['nac347-' + name]
        # The existing PNG framing/CRC writer owns validation; smaller Finder
        # images are intentionally unqualified until the real readability gate.
        image = png_identity(data)
        total += len(data)
        caption = decode(values['nac347-caption-' + name])
        require(caption.get('schema') == 'nac347-capture-v1' and caption.get('name') == name
                and caption.get('configuration_sha256') == configuration_hash
                and caption.get('H') == config['harness_sha'] and caption.get('T') == PRODUCT
                and all(caption.get(k) == config[k] for k in ('native_sha256', 'engine_sha256', 'helper_sha256'))
                and caption.get('png_sha256') == digest(data), 'original PNG/source caption')
        sequence = caption.get('sequence')
        require(type(sequence) is int and 0 <= sequence < len(history), 'capture phase sequence')
        phase = history[sequence]
        require(all(caption.get(k) == phase[k] for k in ('app_pid', 'window', 'run', 'launch', 'view', 'document'))
                and caption.get('phase') == phase['name'], 'capture incarnation/document')
        require(sequence == {'chooser-unicode': 0, 'reloaded-form': 1, 'moved-folder-error': 3,
                             'session-files': 3, 'finder-selected': 4, 'failure-panel': 0}[name], 'capture attachment point')
        images.append(dict(name=name, **image))
    require(controller.get('capture_bytes') == total and total <= 10 * 1024 * 1024, 'capture byte accounting')
    allowed = {'nac347-controller', *(f'nac347-input-{n:03d}' for n in range(1, inputs + 1)),
               *('nac347-' + n for n in actual), *('nac347-caption-' + n for n in actual)}
    if scenario == CASES[0]:
        for stage, sequence in (('before', 3), ('after', 4)):
            budget_check()
            name = 'nac347-finder-' + stage
            if name not in values:
                require(not passing, 'missing Finder baseline/selection receipt')
                continue
            allowed.add(name)
            row = decode(values[name])
            require(row.get('schema') == 'nac347-finder-v1' and row.get('stage') == stage
                    and row.get('configuration_sha256') == configuration_hash
                    and row.get('H') == config['harness_sha'] and row.get('T') == PRODUCT
                    and row.get('close_authority') is False and sequence < len(history)
                    and row.get('phase') == history[sequence]
                    and row.get('folder') == 'Folder with spaces 日本語 ' + scope['run']
                    and row.get('leaf') == 'reveal me 日本語 ' + scope['run'], 'Finder source/action binding')
            windows = row.get('windows')
            require(type(windows) is list and len(windows) <= 64, 'Finder bounded windows')
            for ordinal, window in enumerate(windows):
                budget_check()
                require(type(window) is dict and window.get('index') == ordinal
                        and type(window.get('owned_title')) is bool
                        and all(type(window.get(k)) is int and 0 <= window[k] <= 4096
                                for k in ('leaf_count', 'selected_leaf_count'))
                        and window['selected_leaf_count'] <= window['leaf_count'], 'Finder window observation')
            if stage == 'before':
                require(all(not w['owned_title'] and w['leaf_count'] == 0 for w in windows), 'Finder target predates reveal')
            else:
                require(sum(w['owned_title'] for w in windows) == 1
                        and sum(w['owned_title'] and w['selected_leaf_count'] > 0 for w in windows) == 1
                        and sum(w['leaf_count'] > 0 for w in windows) == 1, 'Finder unique selected leaf')
    require(set(values) == allowed, 'extra/missing named attachments')
    if passing:
        cursor.finish()
        require(inputs > 0 and set(actual) == set(expected), 'incomplete passing controller/captures')
    budget_check()
    return dict(complete=passing, scope=scope, history=history, inputs=rows, images=images,
                actual_image_review_required=True, Finder_window_left_open=True)


def collect(tool, result, config, configuration_hash, output, *, passing):
    output.mkdir()
    index = dict(complete=False, retained=[], actual_image_review_required=True)
    try:
        test_id, test_url = identities(config['scenario'])
        tree_data = tool.capture([tool.path, 'get', 'test-results', 'tests', '--path', str(result)], 'paths-tests', retain=False)
        def cases(value):
            if isinstance(value, dict):
                if value.get('nodeType') == 'Test Case':
                    yield value
                for child in value.values():
                    budget_check()
                    yield from cases(child)
            elif isinstance(value, list):
                for child in value:
                    budget_check()
                    yield from cases(child)
        found = list(cases(decode(tree_data)))
        require(len(found) == 1 and found[0].get('nodeIdentifier') == test_id
                and found[0].get('nodeIdentifierURL') == test_url, 'actual path test identity')
        require(not passing or found[0].get('result') == 'Passed', 'actual path test result')
        index.update(actual_test=found[0], actual_test_tree_sha256=digest(tree_data))
        with tempfile.TemporaryDirectory(prefix='nac347-owned-attachments-') as temporary:
            export = Path(temporary).resolve() / 'export'
            tool.capture([tool.path, 'export', 'attachments', '--path', str(result), '--test-id', test_url,
                          '--output-path', str(export)], 'paths-export', retain=False)
            require(export.is_dir() and not export.is_symlink()
                    and not any(p.is_symlink() or not (p.is_file() or p.is_dir()) for p in checked_items(export.rglob('*'))), 'export inventory')
            manifest = decode(bounded_file(export / 'manifest.json', 256 * 1024))
            require(type(manifest) is list and len(manifest) == 1 and manifest[0].get('testIdentifier') == test_id
                    and manifest[0].get('testIdentifierURL', test_url) == test_url, 'export test binding')
            entries = manifest[0].get('attachments')
            require(type(entries) is list and len(entries) <= 512, 'attachment count')
            named, filenames = {}, []
            uuid = r'[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}'
            for entry in entries:
                budget_check()
                name, filename = entry.get('suggestedHumanReadableName'), entry.get('exportedFileName')
                require(type(filename) is str and filename not in ('', '.', '..')
                        and '/' not in filename and '\\' not in filename and '\0' not in filename, 'attachment filename')
                filenames.append(filename)
                if not isinstance(name, str) or not name.startswith('nac347-'):
                    continue  # Never retain automatic host images/video/diagnostics.
                match = re.fullmatch(r'(nac347-[A-Za-z0-9-]+?)(?:_\d+_' + uuid + r')?(?:\.(?:png|json))?', name)
                require(match and match[1] not in named, 'duplicate/malformed named attachment')
                named[match[1]] = filename
            require(all(count == 1 for count in Counter(filenames).values()), 'duplicate export file')
            values, total = {}, 0
            for name, filename in named.items():
                budget_check()
                limit = 2 * 1024 * 1024 if name in {'nac347-' + n for group in CAPTURES for n in group} else 256 * 1024
                data = bounded_file(export / filename, limit)
                total += len(data)
                require(total <= 11 * 1024 * 1024, 'selected total')
                values[name] = data
            proof = validate_payloads(values, config, configuration_hash, passing=passing)
            for name, data in values.items():
                budget_check()
                extension = '.png' if name in {'nac347-' + n for group in CAPTURES for n in group} else '.json'
                (output / (name + extension)).write_bytes(data)
                index['retained'].append(dict(file=name + extension, bytes=len(data), sha256=digest(data)))
            index.update(proof)
        return index
    finally:
        (output / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
