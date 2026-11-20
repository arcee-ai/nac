"""Read only exact H-exported private evidence and emit closed diagnostics."""
import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path

P = H = '06296d236d42422ede804856de6f240a06d9c535'
Q = '5306800fd6ea70471ecd372a4f495621e0f74695'
R = '1638a9f36b4978bfe790859d0d42ce3bea96a5cf'
TEST = 'test://com.apple.xcode/NACNativeUITests/NACStartupUITests/StartupJourneys/testOrdinaryStartup'
MAX_JSON = 1024 * 1024
MAX_PNG = 8 * 1024 * 1024


def read_owned(root, names, limit):
    """Traverse only fixed directory entries, refusing symlinks and oversized files."""
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in names[:-1]:
            nxt = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        child = os.open(names[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            info = os.fstat(child)
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise ValueError('bounded file')
            with os.fdopen(child, 'rb') as stream:
                child = -1
                data = stream.read(limit + 1)
            if len(data) != info.st_size or len(data) > limit:
                raise ValueError('changed file')
            return data
        finally:
            if child != -1:
                os.close(child)
    finally:
        os.close(fd)


def object_json(data):
    def unique(pairs):
        if len(dict(pairs)) != len(pairs):
            raise ValueError('duplicate key')
        return dict(pairs)
    value = json.loads(data, object_pairs_hook=unique,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('constant')))
    if type(value) is not dict:
        raise ValueError('object required')
    return value


def read_json(root, *names):
    return object_json(read_owned(root, names, MAX_JSON))


def matches_metadata(data, metadata):
    return (type(metadata) is dict and type(metadata.get('bytes')) is int
            and metadata['bytes'] == len(data)
            and metadata.get('sha256') == hashlib.sha256(data).hexdigest())


def postprocess(root, recognize):
    result = {'image_observation': 'unknown', 'phase': 'unknown', 'process_settlement': 'unknown',
              'input_completion': 'unknown'}
    try:
        folder = 'startup-configuredLocal'
        case = read_json(root, folder, 'case.json')
        if any(case.get(k) != v for k, v in {'P': P, 'Q': Q, 'R': R, 'H': H,
                                              'scenario': 'configuredLocal'}.items()):
            return result
        owner = read_json(root, folder, 'owner-observation.json')
        if case.get('owner_observation') == owner and owner.get('positive_process_settlement') is True:
            result['process_settlement'] = 'positive_owner_proof'
        index = read_json(root, folder, 'attachments', 'index.json')
        if (any(index.get(k) != v for k, v in {'P': P, 'Q': Q, 'H': H,
                                                'scenario': 'configuredLocal'}.items())
                or type(index.get('actual_test')) is not dict
                or index['actual_test'].get('nodeIdentifierURL') != TEST
                or index['actual_test'].get('result') != 'Failed'
                or index.get('selection_errors') != []
                or not re.fullmatch('[0-9a-f]{64}', str(index.get('configuration_sha256', '')))):
            return result
        config = index['configuration_sha256']
        if index.get('diagnostic_dispatch_order') == 'sdk_inventory_not_execution':
            entries = index.get('diagnostic_dispatches')
            if type(entries) is list and len(entries) <= 64:
                for stage in ('after', 'before'):
                    name = 'nac342-dispatch-v1-02-' + stage + '.json'
                    candidates = [e for e in entries if type(e) is dict and e.get('file') == name]
                    if len(candidates) != 1:
                        continue
                    try:
                        data = read_owned(root, (folder, 'attachments', name), MAX_JSON)
                        row = object_json(data)
                        if (matches_metadata(data, candidates[0]) and row.get('schema') == 'nac342-dispatch-v1'
                                and row.get('scenario') == 'configuredLocal' and row.get('configuration_sha256') == config
                                and row.get('operation_index') == 2 and row.get('stage') == stage
                                and type(row.get('operation')) is str
                                and row['operation'].startswith('click:Choose Working Folder: ')):
                            result['phase'] = 'folder_dispatch_' + stage + '_observed'
                            break
                    except (OSError, ValueError, TypeError):
                        continue
        image = read_owned(root, (folder, 'attachments', 'nac342-failure-configuredLocal.png'), MAX_PNG)
        metadata = index.get('failure_image')
        if matches_metadata(image, metadata) and image.startswith(b'\x89PNG\r\n\x1a\n'):
            if recognize(image) == 'ocr_title_match':
                result['image_observation'] = 'ocr_title_match'
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return result


def ocr(binary, data):
    try:
        call = subprocess.run([str(binary)], input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              timeout=60, check=False)
        if call.returncode == 0 and call.stdout == b'ocr_title_match\n':
            return 'ocr_title_match'
    except (OSError, subprocess.TimeoutExpired):
        pass
    return 'unknown'
