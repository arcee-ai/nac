use serde_json::{json, Value};

use crate::tools::{ToolResult, ToolRuntime};

const MAX_HELPER_OUTPUT_BYTES: usize = 70_000;

// Keep the complete discovery algorithm in one helper so Local, Podman, and SSH
// use identical path, ignore, matching, ordering, and pagination semantics. The
// helper uses only Python's standard library; it never invokes a search binary.
const DISCOVERY_SCRIPT: &str = r#"
import base64
import hashlib
import json
import os
import re
import signal
import stat
import sys
import time

MAX_ENTRIES = 20_000
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_IGNORE_FILE_BYTES = 256 * 1024
MAX_TOTAL_IGNORE_BYTES = 1024 * 1024
MAX_IGNORE_RULES = 4096
MAX_TOTAL_FILE_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
MAX_MATERIALIZED_BYTES = 8 * 1024 * 1024
MAX_FIELD_BYTES = 1024
MAX_CONTEXT_LINE_BYTES = 256
MAX_MATCHES = 10_000
MAX_RECORDS = 20_000
MAX_PATTERN_BYTES = 64 * 1024
MAX_COLLECTION_BYTES = 64 * 1024
MAX_ROOTS = 32
MAX_GLOBS = 128
MAX_LIMIT = 1000
QUERY_TIMEOUT_SECONDS = 30.0
CURSOR_VERSION = 1
QUERY_DEADLINE = None


class RegexTimedOut(Exception):
    pass

def regex_timeout(_signum, _frame):
    raise RegexTimedOut()

def arm_timeout(maximum=None):
    if not hasattr(signal, 'setitimer'):
        return
    remaining = QUERY_DEADLINE - time.monotonic()
    if remaining <= 0:
        raise RegexTimedOut()
    delay = remaining if maximum is None else min(remaining, maximum)
    signal.signal(signal.SIGALRM, regex_timeout)
    signal.setitimer(signal.ITIMER_REAL, delay)

def disarm_timeout():
    if hasattr(signal, 'setitimer'):
        signal.setitimer(signal.ITIMER_REAL, 0)

class SearchError(Exception):
    def __init__(self, code, message, path=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.path = path

def fail(code, message, path=None):
    raise SearchError(code, message, path)

def strict_utf8(value, label):
    try:
        value.encode('utf-8')
    except UnicodeEncodeError:
        fail('invalid_utf8_path', f'{label} is not valid UTF-8')
    return value

def bounded_text(value, maximum=MAX_FIELD_BYTES):
    raw = value.encode('utf-8', errors='replace')
    if len(raw) <= maximum:
        return value, False
    raw = raw[:maximum]
    while True:
        try:
            return raw.decode('utf-8') + '…', True
        except UnicodeDecodeError as error:
            raw = raw[:error.start]

def diagnostic(code, message, path=None):
    message, truncated = bounded_text(str(message))
    item = {'record_type': 'error', 'code': code, 'message': message}
    if path is not None:
        path, path_truncated = bounded_text(path)
        item['path'] = path
        truncated = truncated or path_truncated
    if truncated:
        item['message_truncated'] = True
    return item

def normalize_relative(value, label, workspace_real):
    if not isinstance(value, str):
        fail('invalid_arguments', f'{label} must be a string')
    strict_utf8(value, label)
    if value == '':
        value = '.'
    if value.startswith('~'):
        fail('outside_workspace', f'{label} leaves the workspace', value)
    normalized = os.path.normpath(value)
    if os.path.isabs(normalized):
        normalized_real = os.path.realpath(normalized)
        try:
            if os.path.commonpath([workspace_real, normalized_real]) != workspace_real:
                fail('outside_workspace', f'{label} leaves the workspace', value)
        except ValueError:
            fail('outside_workspace', f'{label} leaves the workspace', value)
        normalized = os.path.relpath(normalized_real, workspace_real)
    if normalized == '..' or normalized.startswith('../'):
        fail('outside_workspace', f'{label} leaves the workspace', value)
    if normalized == '.':
        return ''
    return normalized.replace(os.sep, '/')

def open_dir_at(parent_fd, component, display):
    flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    try:
        fd = os.open(component, flags, dir_fd=parent_fd)
    except OSError as error:
        fail('unreadable_path', error.strerror or str(error), display)
    mode = os.fstat(fd).st_mode
    if not stat.S_ISDIR(mode):
        os.close(fd)
        fail('not_directory', 'search root is not a directory', display)
    return fd

def open_root(workspace_fd, relative):
    fd = os.dup(workspace_fd)
    if not relative:
        return fd
    consumed = []
    for component in relative.split('/'):
        consumed.append(component)
        child = open_dir_at(fd, component, '/'.join(consumed))
        os.close(fd)
        fd = child
    return fd

def open_file_at(workspace_fd, relative):
    components = relative.split('/')
    fd = os.dup(workspace_fd)
    try:
        for component in components[:-1]:
            child = open_dir_at(fd, component, '/'.join(components[:-1]))
            os.close(fd)
            fd = child
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
        file_fd = os.open(components[-1], flags, dir_fd=fd)
        if not stat.S_ISREG(os.fstat(file_fd).st_mode):
            os.close(file_fd)
            fail('unsupported_file_type', 'path is not a regular file', relative)
        return file_fd
    finally:
        os.close(fd)

def glob_regex(pattern):
    if not isinstance(pattern, str):
        fail('invalid_glob', 'glob pattern must be a string')
    if len(pattern.encode('utf-8')) > MAX_PATTERN_BYTES:
        fail('invalid_glob', 'glob pattern is too large')
    out = ['^']
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == '*':
            if index + 1 < len(pattern) and pattern[index + 1] == '*':
                index += 2
                if index < len(pattern) and pattern[index] == '/':
                    out.append('(?:.*/)?')
                    index += 1
                else:
                    out.append('.*')
                continue
            out.append('[^/]*')
        elif char == '?':
            out.append('[^/]')
        elif char == '[':
            end = index + 1
            if end < len(pattern) and pattern[end] in ('!', '^'):
                end += 1
            if end < len(pattern) and pattern[end] == ']':
                end += 1
            while end < len(pattern) and pattern[end] != ']':
                end += 1
            if end >= len(pattern):
                fail('invalid_glob', f'unclosed character class at byte {index}')
            stuff = pattern[index + 1:end]
            if stuff.startswith('!'):
                stuff = '^' + stuff[1:]
            elif stuff.startswith('^'):
                stuff = '\\' + stuff
            out.append('[' + stuff.replace('\\', '\\\\') + ']')
            index = end
        elif char == '\\':
            if index + 1 >= len(pattern):
                fail('invalid_glob', 'trailing escape in glob pattern')
            index += 1
            out.append(re.escape(pattern[index]))
        else:
            out.append(re.escape(char))
        index += 1
    out.append('$')
    try:
        return re.compile(''.join(out))
    except re.error as error:
        fail('invalid_glob', str(error))

def parse_ignore_line(line):
    line = line.rstrip('\n\r')
    if not line:
        return None
    while line.endswith(' '):
        slash_count = 0
        index = len(line) - 2
        while index >= 0 and line[index] == '\\':
            slash_count += 1
            index -= 1
        if slash_count % 2 == 1:
            break
        line = line[:-1]
    if not line:
        return None
    if line.startswith('\\#') or line.startswith('\\!'):
        line = line[1:]
    elif line.startswith('#'):
        return None
    negated = line.startswith('!')
    if negated:
        line = line[1:]
    directory_only = line.endswith('/')
    if directory_only:
        line = line[:-1]
    anchored = line.startswith('/')
    if anchored:
        line = line[1:]
    if not line:
        return None
    has_slash = '/' in line
    regex = glob_regex(line)
    return (negated, directory_only, anchored, has_slash, regex)

def load_ignore(fd, base, budget):
    path = (base + '/.gitignore').lstrip('/')
    if path in budget['cache']:
        return budget['cache'][path]
    try:
        ignore_fd = os.open('.gitignore', os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0), dir_fd=fd)
    except FileNotFoundError:
        budget['cache'][path] = []
        return []
    except OSError as error:
        loaded = [diagnostic('unreadable_path', error.strerror or str(error), path)]
        budget['cache'][path] = loaded
        return loaded
    try:
        raw = bytearray()
        while len(raw) <= MAX_IGNORE_FILE_BYTES:
            chunk = os.read(ignore_fd, min(65536, MAX_IGNORE_FILE_BYTES + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        if len(raw) > MAX_IGNORE_FILE_BYTES:
            fail('ignore_limit', f'.gitignore exceeds {MAX_IGNORE_FILE_BYTES} bytes', path)
        budget['bytes'] -= len(raw)
        if budget['bytes'] < 0:
            fail('ignore_limit', f'ignore files exceed {MAX_TOTAL_IGNORE_BYTES} aggregate bytes', path)
        text = bytes(raw).decode('utf-8', errors='replace')
        rules = []
        for line in text.splitlines():
            parsed = parse_ignore_line(line)
            if parsed is not None:
                budget['rules'] -= 1
                if budget['rules'] < 0:
                    fail('ignore_limit', f'ignore files exceed {MAX_IGNORE_RULES} rules', path)
                rules.append((base, parsed))
        budget['cache'][path] = rules
        return rules
    finally:
        os.close(ignore_fd)

def partition_ignore(loaded):
    return (
        [item for item in loaded if not isinstance(item, dict)],
        [item for item in loaded if isinstance(item, dict)],
    )

def ancestor_ignore_rules(workspace_fd, root, gitignore, budget):
    if not gitignore or not root:
        return [], []
    rules = []
    errors = []
    fd = os.dup(workspace_fd)
    base = ''
    try:
        loaded = load_ignore(fd, base, budget)
        own_rules, own_errors = partition_ignore(loaded)
        rules.extend(own_rules)
        errors.extend(own_errors)
        components = root.split('/')
        for component in components[:-1]:
            child_base = f'{base}/{component}' if base else component
            child = open_dir_at(fd, component, child_base)
            os.close(fd)
            fd = child
            base = child_base
            loaded = load_ignore(fd, base, budget)
            own_rules, own_errors = partition_ignore(loaded)
            rules.extend(own_rules)
            errors.extend(own_errors)
        return rules, errors
    finally:
        os.close(fd)

def cap_records(records, path):
    if len(records) <= MAX_RECORDS:
        return records
    return records[:MAX_RECORDS - 1] + [
        diagnostic('record_limit', f'search exceeded {MAX_RECORDS} structured records', path)
    ]

def ignored(path, is_dir, rule_stack, gitignore):
    if not gitignore:
        return False
    parts = path.split('/')
    if any(part in ('target', 'node_modules') for part in parts):
        return True
    decision = False
    for base, rule in rule_stack:
        negated, directory_only, anchored, has_slash, regex = rule
        if directory_only and not is_dir:
            continue
        if base:
            prefix = base + '/'
            if not path.startswith(prefix):
                continue
            candidate = path[len(prefix):]
        else:
            candidate = path
        matched = bool(regex.fullmatch(candidate)) if (anchored or has_slash) else any(regex.fullmatch(part) for part in candidate.split('/'))
        if matched:
            decision = not negated
    return decision

def is_hidden(path):
    return any(part.startswith('.') and part not in ('.', '..') for part in path.split('/'))

def symlink_error(parent_fd, name, path, workspace_real):
    try:
        target = os.readlink(name, dir_fd=parent_fd)
        if os.path.isabs(target):
            resolved = os.path.realpath(target)
        else:
            parent = os.path.dirname(os.path.join(workspace_real, path))
            resolved = os.path.realpath(os.path.join(parent, target))
        outside = os.path.commonpath([workspace_real, resolved]) != workspace_real
    except (OSError, ValueError):
        outside = True
    if outside:
        return diagnostic('symlink_escape', 'symlink target leaves the workspace', path)
    return diagnostic('symlink_unsupported', 'symlinks are not followed', path)

def walk_root(workspace_fd, workspace_real, root, hidden, gitignore, budget, ignore_budget):
    root_fd = open_root(workspace_fd, root)
    os.close(root_fd)
    parent_rules, records = ancestor_ignore_rules(workspace_fd, root, gitignore, ignore_budget)
    if root and (not hidden and is_hidden(root)):
        return records
    if root and ignored(root, True, parent_rules, gitignore):
        return records
    stack = [(root, parent_rules)]
    while stack:
        directory, inherited_rules = stack.pop()
        try:
            fd = open_root(workspace_fd, directory)
        except SearchError as error:
            records.append(diagnostic(error.code, error.message, error.path or directory))
            continue
        try:
            loaded = load_ignore(fd, directory, ignore_budget) if gitignore else []
            own_rules, errors = partition_ignore(loaded)
            records.extend(errors)
            rules = inherited_rules + own_rules
            try:
                names = os.listdir(fd)
            except OSError as error:
                records.append(diagnostic('unreadable_path', error.strerror or str(error), directory or '.'))
                continue
            names.sort(key=lambda value: os.fsencode(value))
            child_dirs = []
            for name in names:
                try:
                    strict_utf8(name, 'path')
                except SearchError as error:
                    records.append(diagnostic(error.code, error.message, directory or '.'))
                    continue
                path = f'{directory}/{name}' if directory else name
                if not hidden and is_hidden(path):
                    continue
                budget['remaining'] -= 1
                if budget['remaining'] < 0:
                    records.append(diagnostic('entry_limit', f'traversal exceeded {MAX_ENTRIES} entries', path))
                    return cap_records(records, path)
                try:
                    metadata = os.stat(name, dir_fd=fd, follow_symlinks=False)
                except OSError as error:
                    records.append(diagnostic('unreadable_path', error.strerror or str(error), path))
                    continue
                mode = metadata.st_mode
                if stat.S_ISLNK(mode):
                    records.append(symlink_error(fd, name, path, workspace_real))
                    continue
                is_dir = stat.S_ISDIR(mode)
                if ignored(path, is_dir, rules, gitignore):
                    continue
                if is_dir:
                    records.append({'record_type': 'entry', 'path': path, 'kind': 'directory'})
                    child_dirs.append((path, rules))
                elif stat.S_ISREG(mode):
                    records.append({'record_type': 'entry', 'path': path, 'kind': 'file', 'size': metadata.st_size})
            for child in reversed(child_dirs):
                stack.append(child)
        finally:
            os.close(fd)
    return cap_records(records, root or '.')

def canonical_request(tool, args):
    excluded = {key: value for key, value in args.items() if key != 'cursor'}
    raw = json.dumps({'tool': tool, 'args': excluded}, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()

def decode_cursor(value, fingerprint, total):
    if value is None or (isinstance(value, str) and value.strip().lower() in ('', 'none', 'null')):
        return 0
    if not isinstance(value, str):
        fail('invalid_cursor', 'cursor must be a string')
    if len(value.encode('utf-8')) > 4096:
        fail('invalid_cursor', 'cursor is too large')
    try:
        padding = '=' * (-len(value) % 4)
        payload = json.loads(base64.urlsafe_b64decode(value + padding))
    except Exception:
        fail('invalid_cursor', 'cursor is malformed')
    if payload.get('v') != CURSOR_VERSION:
        fail('invalid_cursor', 'cursor version is unsupported')
    if payload.get('q') != fingerprint:
        fail('invalid_cursor', 'cursor does not match this request')
    offset = payload.get('o')
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0 or offset > total:
        fail('invalid_cursor', 'cursor offset is out of range')
    return offset

def encode_cursor(fingerprint, offset):
    raw = json.dumps({'v': CURSOR_VERSION, 'q': fingerprint, 'o': offset}, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')

def parse_common(args):
    gitignore = args.get('gitignore', True)
    hidden = args.get('hidden', False)
    limit = args.get('limit', 200)
    if not isinstance(gitignore, bool) or not isinstance(hidden, bool):
        fail('invalid_arguments', 'gitignore and hidden must be booleans')
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > MAX_LIMIT:
        fail('invalid_arguments', f'limit must be between 1 and {MAX_LIMIT}')
    return gitignore, hidden, limit

def public_record(item, tool):
    return {
        key: value for key, value in item.items()
        if key != 'record_type' and not key.startswith('_') and not (tool == 'glob' and key == 'size')
    }

def page_body(selected, index, total, fingerprint, tool):
    truncated = index < total
    entries = [public_record(item, tool) for item in selected if item['record_type'] == 'entry']
    errors = [public_record(item, tool) for item in selected if item['record_type'] == 'error']
    return {
        ('entries' if tool == 'glob' else 'matches'): entries,
        'truncated': truncated,
        'next_cursor': encode_cursor(fingerprint, index) if truncated else None,
        'errors': errors,
    }

def page(records, offset, limit, fingerprint, tool):
    selected = []
    index = offset
    while index < len(records) and len(selected) < limit:
        candidate = selected + [records[index]]
        body = page_body(candidate, index + 1, len(records), fingerprint, tool)
        if len(json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) > MAX_OUTPUT_BYTES:
            break
        selected = candidate
        index += 1
    if index == offset and index < len(records):
        fail('output_limit', 'the next bounded record cannot fit in the output limit')
    return page_body(selected, index, len(records), fingerprint, tool)

def validate_regex_subset(pattern):
    in_class = False
    escaped = False
    for index, character in enumerate(pattern):
        if escaped:
            if character in ('z', 'B'):
                fail('invalid_regex', f'\\{character} has version-dependent Python semantics')
            escaped = False
            continue
        if character == '\\':
            escaped = True
            continue
        if character == '[':
            in_class = True
            continue
        if character == ']' and in_class:
            in_class = False
            continue
        if in_class:
            continue
        if pattern.startswith('(?>', index):
            fail('invalid_regex', 'atomic groups are outside the portable regex subset')
        if character in ('*', '+', '?') and index + 1 < len(pattern) and pattern[index + 1] == '+':
            fail('invalid_regex', 'possessive quantifiers are outside the portable regex subset')
        if character == '{' and re.match(r'\{(?:\d+(?:,\d*)?|,\d+)\}\+', pattern[index:]):
            fail('invalid_regex', 'possessive quantifiers are outside the portable regex subset')
        if pattern.startswith('(?', index) and index != 0:
            closing = pattern.find(')', index + 2)
            if closing >= 0 and re.fullmatch(r'[aiLmsux]+', pattern[index + 2:closing]):
                fail('invalid_regex', 'global inline flags are only portable at the start of a pattern')

def validate_collection(values, name, maximum):
    if len(values) > maximum:
        fail('invalid_arguments', f'{name} may contain at most {maximum} values')
    total = sum(len(value.encode('utf-8')) for value in values)
    if total > MAX_COLLECTION_BYTES:
        fail('invalid_arguments', f'{name} exceeds the aggregate byte limit')

def compile_grep(args):
    pattern = args.get('pattern')
    if not isinstance(pattern, str) or not pattern:
        fail('invalid_regex', 'pattern must be a non-empty string')
    if len(pattern.encode('utf-8')) > MAX_PATTERN_BYTES:
        fail('invalid_regex', 'pattern is too large')
    regex_mode = args.get('regex', True)
    multiline = args.get('multiline', False)
    case = args.get('case', 'smart')
    context = args.get('context', 0)
    if not isinstance(regex_mode, bool) or not isinstance(multiline, bool):
        fail('invalid_arguments', 'regex and multiline must be booleans')
    if case not in ('smart', 'sensitive', 'insensitive'):
        fail('invalid_arguments', 'case must be smart, sensitive, or insensitive')
    if not isinstance(context, int) or isinstance(context, bool) or context < 0 or context > 100:
        fail('invalid_arguments', 'context must be between 0 and 100')
    if regex_mode:
        validate_regex_subset(pattern)
    source = pattern if regex_mode else re.escape(pattern)
    flags = re.MULTILINE
    if multiline:
        flags |= re.DOTALL
    if case == 'insensitive' or (case == 'smart' and pattern.lower() == pattern):
        flags |= re.IGNORECASE
    try:
        return re.compile(source, flags), multiline, context
    except re.error as error:
        fail('invalid_regex', str(error))

def search_file(workspace_fd, path, size, regex, multiline, context, match_budget, memory_budget):
    if size > MAX_FILE_BYTES:
        return [diagnostic('oversized_file', f'file exceeds {MAX_FILE_BYTES} bytes', path)], 0
    try:
        fd = open_file_at(workspace_fd, path)
    except SearchError as error:
        return [diagnostic(error.code, error.message, error.path)], 0
    try:
        raw = bytearray()
        while len(raw) <= MAX_FILE_BYTES:
            chunk = os.read(fd, min(65536, MAX_FILE_BYTES + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
    except OSError as error:
        return [diagnostic('unreadable_path', error.strerror or str(error), path)], 0
    finally:
        os.close(fd)
    if len(raw) > MAX_FILE_BYTES:
        return [diagnostic('oversized_file', f'file exceeds {MAX_FILE_BYTES} bytes', path)], len(raw)
    raw = bytes(raw)
    if b'\0' in raw[:8192]:
        return [diagnostic('binary_file', 'binary file skipped', path)], len(raw)
    text = raw.decode('utf-8', errors='replace')
    line_chunks = text.splitlines(keepends=True)
    lines = [line.rstrip('\r\n') for line in line_chunks]
    if not line_chunks and text == '':
        line_chunks = ['']
        lines = ['']
    line_starts = []
    position = 0
    for line in line_chunks:
        line_starts.append(position)
        position += len(line)

    def line_index_at(position):
        low, high = 0, len(line_starts)
        while low < high:
            middle = (low + high) // 2
            if line_starts[middle] <= position:
                low = middle + 1
            else:
                high = middle
        return max(0, low - 1)
    found = []

    def append_match(match, line_index, absolute_start, absolute_end, shown):
        byte_column = len(text[line_starts[line_index]:absolute_start].encode('utf-8', errors='replace')) + 1
        shown, shown_truncated = bounded_text(shown)
        item = {
            'record_type': 'entry',
            'path': path,
            'line': line_index + 1,
            'column': byte_column,
            'text': shown,
            '_start': absolute_start,
            '_end': absolute_end,
        }
        if shown_truncated:
            item['text_truncated'] = True
        if context:
            before = lines[max(0, line_index-context):line_index]
            end_position = max(absolute_start, absolute_end - 1)
            end_line = line_index_at(end_position) + 1
            after = lines[end_line:end_line+context]
            item['before'] = [bounded_text(line, MAX_CONTEXT_LINE_BYTES)[0] for line in before]
            item['after'] = [bounded_text(line, MAX_CONTEXT_LINE_BYTES)[0] for line in after]
            if any(bounded_text(line, MAX_CONTEXT_LINE_BYTES)[1] for line in before + after):
                item['context_truncated'] = True
        encoded_bytes = len(json.dumps(item, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        if encoded_bytes > memory_budget['remaining']:
            return False
        memory_budget['remaining'] -= encoded_bytes
        found.append(item)
        return True

    effective_limit = min(MAX_MATCHES, max(1, match_budget))
    arm_timeout(2.0)
    try:
        if multiline:
            for match in regex.finditer(text):
                line_index = line_index_at(match.start())
                if not append_match(match, line_index, match.start(), match.end(), match.group(0)):
                    found.append(diagnostic('materialized_limit', f'search exceeded {MAX_MATERIALIZED_BYTES} materialized bytes', path))
                    break
                if len(found) >= effective_limit:
                    found.append(diagnostic('match_limit', f'search exceeded {effective_limit} matches in this bounded unit', path))
                    break
        else:
            for line_index, line in enumerate(lines):
                for match in regex.finditer(line):
                    absolute_start = line_starts[line_index] + match.start()
                    absolute_end = line_starts[line_index] + match.end()
                    if not append_match(match, line_index, absolute_start, absolute_end, line):
                        found.append(diagnostic('materialized_limit', f'search exceeded {MAX_MATERIALIZED_BYTES} materialized bytes', path))
                        return found, len(raw)
                    if len(found) >= effective_limit:
                        found.append(diagnostic('match_limit', f'search exceeded {effective_limit} matches in this bounded unit', path))
                        return found, len(raw)
    except RegexTimedOut:
        if time.monotonic() >= QUERY_DEADLINE:
            raise
        found.append(diagnostic('regex_timeout', 'regular expression exceeded the per-file time limit', path))
    finally:
        arm_timeout()
    return found, len(raw)

def run_glob(args, workspace_fd, workspace_real):
    pattern = args.get('pattern')
    matcher = glob_regex(pattern)
    root = normalize_relative(args.get('root', '.'), 'root', workspace_real)
    gitignore, hidden, limit = parse_common(args)
    records = walk_root(
        workspace_fd, workspace_real, root, hidden, gitignore,
        {'remaining': MAX_ENTRIES},
        {'bytes': MAX_TOTAL_IGNORE_BYTES, 'rules': MAX_IGNORE_RULES, 'cache': {}},
    )
    prefix = root + '/' if root else ''
    selected = []
    for item in records:
        if item['record_type'] == 'error':
            selected.append(item)
            continue
        relative = item['path'][len(prefix):] if prefix and item['path'].startswith(prefix) else item['path']
        if matcher.fullmatch(relative):
            selected.append(item)
    selected.sort(key=lambda item: (os.fsencode(item.get('path', '')), item['record_type'], item.get('kind', ''), item.get('code', '')))
    fingerprint = canonical_request('glob', args)
    offset = decode_cursor(args.get('cursor'), fingerprint, len(selected))
    return page(selected, offset, limit, fingerprint, 'glob')

def run_grep(args, workspace_fd, workspace_real):
    regex, multiline, context = compile_grep(args)
    roots_value = args.get('roots', ['.'])
    if not isinstance(roots_value, list) or not roots_value or not all(isinstance(root, str) for root in roots_value):
        fail('invalid_arguments', 'roots must be a non-empty array of strings')
    validate_collection(roots_value, 'roots', MAX_ROOTS)
    roots = sorted(set(normalize_relative(root, 'root', workspace_real) for root in roots_value))
    roots = [root for index, root in enumerate(roots) if not any(root == parent or (parent == '' or root.startswith(parent + '/')) for parent in roots[:index])]
    globs = args.get('globs', [])
    if globs is None:
        globs = []
    if not isinstance(globs, list) or not all(isinstance(value, str) for value in globs):
        fail('invalid_arguments', 'globs must be an array of strings')
    validate_collection(globs, 'globs', MAX_GLOBS)
    glob_matchers = [glob_regex(value) for value in globs]
    gitignore, hidden, limit = parse_common(args)
    inventory = []
    seen = set()
    budget = {'remaining': MAX_ENTRIES}
    ignore_budget = {'bytes': MAX_TOTAL_IGNORE_BYTES, 'rules': MAX_IGNORE_RULES, 'cache': {}}
    for root in roots:
        for item in walk_root(workspace_fd, workspace_real, root, hidden, gitignore, budget, ignore_budget):
            identity = (item.get('path'), item['record_type'], item.get('code'))
            if identity not in seen:
                seen.add(identity)
                inventory.append(item)
    records = [item for item in inventory if item['record_type'] == 'error']
    total_bytes = 0
    memory_budget = {'remaining': MAX_MATERIALIZED_BYTES}
    for item in inventory:
        if item['record_type'] != 'entry' or item.get('kind') != 'file':
            continue
        path = item['path']
        if glob_matchers and not any(matcher.fullmatch(path) for matcher in glob_matchers):
            continue
        if len(records) >= MAX_RECORDS - 1:
            records.append(diagnostic('record_limit', f'search exceeded {MAX_RECORDS} structured records', path))
            break
        size = item.get('size', 0)
        if size > MAX_TOTAL_FILE_BYTES - total_bytes:
            records.append(diagnostic('total_read_limit', f'search exceeded {MAX_TOTAL_FILE_BYTES} input bytes', path))
            break
        remaining = MAX_RECORDS - len(records)
        found, read_bytes = search_file(
            workspace_fd, path, size, regex, multiline, context,
            max(1, remaining - 1), memory_budget,
        )
        total_bytes += read_bytes
        records.extend(found[:remaining])
        if any(entry.get('code') in ('match_limit', 'materialized_limit') for entry in found):
            break
    records.sort(key=lambda item: (os.fsencode(item.get('path', '')), item.get('_start', -1), item.get('_end', -1), item['record_type'], item.get('code', '')))
    fingerprint = canonical_request('grep', args)
    offset = decode_cursor(args.get('cursor'), fingerprint, len(records))
    return page(records, offset, limit, fingerprint, 'grep')

def main():
    global QUERY_DEADLINE
    QUERY_DEADLINE = time.monotonic() + QUERY_TIMEOUT_SECONDS
    arm_timeout()
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or not isinstance(request.get('args'), dict):
            fail('invalid_arguments', 'tool request must be an object')
        tool = request.get('tool')
        args = request['args']
        workspace_real = os.path.realpath(os.getcwd())
        workspace_fd = os.open(workspace_real, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0))
        try:
            if tool == 'glob':
                response = run_glob(args, workspace_fd, workspace_real)
            elif tool == 'grep':
                response = run_grep(args, workspace_fd, workspace_real)
            else:
                fail('invalid_arguments', 'unknown discovery tool')
        finally:
            os.close(workspace_fd)
        encoded = json.dumps(response, ensure_ascii=False, separators=(',', ':'))
        if len(encoded.encode('utf-8')) > MAX_OUTPUT_BYTES:
            fail('output_limit', 'serialized response exceeds the output byte limit')
        disarm_timeout()
        sys.stdout.write(encoded)
    except RegexTimedOut:
        disarm_timeout()
        sys.stdout.write(json.dumps({'error': {'code': 'search_timeout', 'message': 'search exceeded the query time limit', 'path': None}}, separators=(',', ':')))
        sys.exit(2)
    except SearchError as error:
        disarm_timeout()
        sys.stdout.write(json.dumps({'error': {'code': error.code, 'message': error.message, 'path': error.path}}, ensure_ascii=False, separators=(',', ':')))
        sys.exit(2)
    except Exception as error:
        disarm_timeout()
        sys.stdout.write(json.dumps({'error': {'code': 'internal_error', 'message': str(error)}}, ensure_ascii=False, separators=(',', ':')))
        sys.exit(2)

main()
"#;

pub(crate) async fn execute(tool: &'static str, args: Value, runtime: &ToolRuntime) -> ToolResult {
    if !args.is_object() {
        return error_result("invalid_arguments", "tool arguments must be an object");
    }

    let request = json!({ "tool": tool, "args": args });
    let input = match serde_json::to_vec(&request) {
        Ok(value) => value,
        Err(error) => return error_result("invalid_arguments", &error.to_string()),
    };
    // Isolated mode keeps Python's import path and environment independent of
    // workspace-controlled modules. Prefer fixed system paths; if an environment
    // uses a different layout, resolve PATH without executing the candidate and
    // reject any interpreter located inside the workspace.
    let command_args = vec![
        "-I".to_string(),
        "-S".to_string(),
        "-c".to_string(),
        DISCOVERY_SCRIPT.to_string(),
    ];
    let mut output = None;
    let mut launch_errors = Vec::new();
    for interpreter in [
        "/usr/bin/python3",
        "/usr/local/bin/python3",
        "/opt/homebrew/bin/python3",
        "/run/current-system/sw/bin/python3",
        "/nix/var/nix/profiles/default/bin/python3",
    ] {
        match runtime
            .backend
            .exec(interpreter, &command_args, Some(&input))
            .await
        {
            Ok(value) if matches!(value.status.code(), Some(126 | 127)) => {
                launch_errors.push(format!("{interpreter}: executable unavailable"));
            }
            Ok(value) => {
                output = Some(value);
                break;
            }
            Err(error) => launch_errors.push(format!("{interpreter}: {error}")),
        }
    }
    if output.is_none() {
        let resolver_args = vec![
            "-c".to_string(),
            "workspace=$(pwd -P) || exit 126\ncandidate=$(command -v python3) || exit 127\ncase \"$candidate\" in /*) ;; *) exit 126 ;; esac\ndirectory=${candidate%/*}; name=${candidate##*/}; [ -n \"$directory\" ] || directory=/\ncd -P \"$directory\" || exit 126\ncandidate=$PWD/$name\n[ -L \"$candidate\" ] && exit 125\nprintf '%s\\n%s\\n' \"$candidate\" \"$workspace\""
                .to_string(),
        ];
        match runtime.backend.exec("/bin/sh", &resolver_args, None).await {
            Ok(resolved) if resolved.status.success() && resolved.stdout.len() <= 4096 => {
                let resolved = String::from_utf8_lossy(&resolved.stdout);
                let paths: Vec<&str> = resolved.lines().collect();
                let candidate = paths.first().copied().unwrap_or_default().to_string();
                let candidate_path = std::path::Path::new(&candidate);
                let workspace_path = paths.get(1).copied().map(std::path::Path::new);
                let outside_workspace = paths.len() == 2
                    && candidate_path.is_absolute()
                    && workspace_path.is_some_and(|workspace| {
                        workspace.is_absolute() && !candidate_path.starts_with(workspace)
                    });
                if outside_workspace {
                    match runtime
                        .backend
                        .exec(&candidate, &command_args, Some(&input))
                        .await
                    {
                        Ok(value) if !matches!(value.status.code(), Some(126 | 127)) => {
                            output = Some(value);
                        }
                        Ok(_) => launch_errors.push(format!("{candidate}: executable unavailable")),
                        Err(error) => launch_errors.push(format!("{candidate}: {error}")),
                    }
                } else {
                    launch_errors.push("PATH resolved python3 inside the workspace".to_string());
                }
            }
            Ok(_) => {
                launch_errors.push("PATH did not resolve a usable absolute python3".to_string())
            }
            Err(error) => {
                launch_errors.push(format!("failed to resolve python3 from PATH: {error}"))
            }
        }
    }
    let Some(output) = output else {
        return error_result(
            "backend_error",
            &format!(
                "failed to execute {tool} in {} with an isolated Python interpreter: {}",
                runtime.backend.remote_io_label(),
                launch_errors.join("; ")
            ),
        );
    };

    if output.stdout.len() > MAX_HELPER_OUTPUT_BYTES {
        return error_result(
            "output_limit",
            "discovery helper output exceeded its byte limit",
        );
    }
    let parsed: Value = match serde_json::from_slice(&output.stdout) {
        Ok(value) => value,
        Err(error) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return error_result(
                "backend_protocol",
                &format!("invalid discovery response: {error}; {stderr}"),
            );
        }
    };
    if !output.status.success() {
        return ToolResult {
            content: parsed.to_string(),
            is_error: true,
        };
    }
    if !parsed.is_object() {
        return error_result("backend_protocol", "discovery response must be an object");
    }
    ToolResult {
        content: parsed.to_string(),
        is_error: false,
    }
}

fn error_result(code: &str, message: &str) -> ToolResult {
    ToolResult {
        content: json!({ "error": { "code": code, "message": message } }).to_string(),
        is_error: true,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;

    use serde_json::{json, Value};

    use super::execute;
    fn fixture_runtime() -> (crate::tools::ToolRuntime, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("nac-discovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).expect("create src fixture");
        fs::create_dir_all(root.join("target")).expect("create target fixture");
        fs::create_dir_all(root.join(".hidden")).expect("create hidden fixture");
        fs::create_dir_all(root.join("nested")).expect("create nested fixture");
        fs::write(
            root.join("src/a.rs"),
            "pub enum ExecutionBackend {}\nsecond line\n",
        )
        .expect("write a.rs");
        fs::write(root.join("src/b.rs"), "ExecutionBackend appears again\n").expect("write b.rs");
        fs::write(root.join("target/generated.rs"), "ExecutionBackend\n")
            .expect("write generated fixture");
        fs::write(root.join(".hidden/secret.rs"), "ExecutionBackend\n")
            .expect("write hidden fixture");
        fs::write(root.join("nested/drop.txt"), "ExecutionBackend\n")
            .expect("write nested ignored fixture");
        fs::write(root.join("nested/keep.txt"), "before\nneedle\nafter\n")
            .expect("write nested re-included fixture");
        fs::write(root.join("nested/.gitignore"), "*.txt\n!keep.txt\n")
            .expect("write nested ignore fixture");
        fs::write(root.join("binary.dat"), b"ExecutionBackend\0binary")
            .expect("write binary fixture");
        fs::write(root.join("ignored.rs"), "ExecutionBackend\n").expect("write ignored fixture");
        fs::write(root.join(".gitignore"), "ignored.rs\n").expect("write ignore fixture");

        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Local {
            workspace_cwd: root.clone(),
        });
        (runtime, root)
    }

    async fn podman_runtime(root: &std::path::Path) -> crate::tools::ToolRuntime {
        let sandbox = crate::sandbox::SandboxSession::create(
            crate::sandbox::SandboxSpec {
                backend: crate::sandbox::SandboxBackendType::Podman,
                image: crate::sandbox::DEFAULT_SANDBOX_IMAGE.to_string(),
                mounts: vec![crate::sandbox::MountSpec {
                    host: root.to_path_buf(),
                    guest: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
                    read_only: true,
                }],
                workdir: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
                gpu_devices: Vec::new(),
                shm_size: Some("0".to_string()),
                cpus: 2,
                memory_mib: 512,
            },
            format!("discovery-test-{}", uuid::Uuid::new_v4()),
            true,
        )
        .await
        .expect("create Podman discovery fixture");
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = root.to_path_buf();
        runtime.config_cwd = root.to_path_buf();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(Some(sandbox), root);
        runtime
    }

    fn parsed(result: crate::tools::ToolResult) -> Value {
        assert!(
            !result.is_error,
            "unexpected tool error: {}",
            result.content
        );
        serde_json::from_str(&result.content).expect("tool output must be JSON")
    }

    #[tokio::test]
    async fn glob_respects_defaults_and_returns_stable_paths() {
        let (runtime, root) = fixture_runtime();
        let output = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
        let paths: Vec<&str> = output["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .map(|entry| entry["path"].as_str().expect("path"))
            .collect();
        assert_eq!(paths, vec!["src/a.rs", "src/b.rs"]);
        assert_eq!(output["truncated"], false);
        assert!(output["next_cursor"].is_null());
        let model_shaped = parsed(
            execute(
                "glob",
                json!({
                    "pattern": "**/*.rs",
                    "root": root,
                    "cursor": ""
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(model_shaped["entries"], output["entries"]);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn grep_paginates_every_match_once() {
        let (runtime, root) = fixture_runtime();
        let first = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "globs": ["**/*.rs"],
                    "limit": 1
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(first["matches"][0]["path"], "src/a.rs");
        assert_eq!(first["matches"][0]["line"], 1);
        assert_eq!(first["matches"][0]["column"], 10);
        assert_eq!(first["truncated"], true);
        let cursor = first["next_cursor"].as_str().expect("cursor");

        let second = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "globs": ["**/*.rs"],
                    "limit": 1,
                    "cursor": cursor
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(second["matches"][0]["path"], "src/b.rs");
        assert_eq!(second["truncated"], false);
        assert!(second["next_cursor"].is_null());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn invalid_patterns_and_outside_roots_are_explicit_errors() {
        let (runtime, root) = fixture_runtime();
        let invalid = execute("glob", json!({"pattern": "["}), &runtime).await;
        assert!(invalid.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&invalid.content).expect("error JSON")["error"]["code"],
            "invalid_glob"
        );

        let outside = execute(
            "grep",
            json!({"pattern": "x", "roots": ["../outside"]}),
            &runtime,
        )
        .await;
        assert!(outside.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&outside.content).expect("error JSON")["error"]["code"],
            "outside_workspace"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn explicit_options_include_hidden_ignored_and_generated_paths() {
        let (runtime, root) = fixture_runtime();
        let output = parsed(
            execute(
                "glob",
                json!({
                    "pattern": "**/*.rs",
                    "hidden": true,
                    "gitignore": false
                }),
                &runtime,
            )
            .await,
        );
        let paths: Vec<&str> = output["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .map(|entry| entry["path"].as_str().expect("path"))
            .collect();
        assert_eq!(
            paths,
            vec![
                ".hidden/secret.rs",
                "ignored.rs",
                "src/a.rs",
                "src/b.rs",
                "target/generated.rs"
            ]
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn nested_gitignore_negation_is_applied_before_matching() {
        let (runtime, root) = fixture_runtime();
        let output = parsed(
            execute(
                "glob",
                json!({"pattern": "**/*.txt", "root": "nested"}),
                &runtime,
            )
            .await,
        );
        assert_eq!(output["entries"].as_array().expect("entries").len(), 1);
        assert_eq!(output["entries"][0]["path"], "nested/keep.txt");
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn grep_supports_context_case_modes_and_path_globs() {
        let (runtime, root) = fixture_runtime();
        let context = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "needle",
                    "regex": false,
                    "roots": ["nested"],
                    "globs": ["nested/*.txt"],
                    "context": 1
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(context["matches"].as_array().expect("matches").len(), 1);
        assert_eq!(context["matches"][0]["path"], "nested/keep.txt");
        assert_eq!(context["matches"][0]["line"], 2);
        assert_eq!(context["matches"][0]["before"], json!(["before"]));
        assert_eq!(context["matches"][0]["after"], json!(["after"]));

        let smart = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "executionbackend",
                    "regex": false,
                    "globs": ["src/*.rs"],
                    "case": "smart"
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(smart["matches"].as_array().expect("matches").len(), 2);
        let sensitive = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "executionbackend",
                    "regex": false,
                    "globs": ["src/*.rs"],
                    "case": "sensitive"
                }),
                &runtime,
            )
            .await,
        );
        assert!(sensitive["matches"].as_array().expect("matches").is_empty());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn grep_multiline_controls_cross_line_matches() {
        let (runtime, root) = fixture_runtime();
        let single_line = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "before.*after",
                    "roots": ["nested"],
                    "globs": ["nested/keep.txt"]
                }),
                &runtime,
            )
            .await,
        );
        assert!(single_line["matches"]
            .as_array()
            .expect("matches")
            .is_empty());
        let multiline = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "before.*after",
                    "roots": ["nested"],
                    "globs": ["nested/keep.txt"],
                    "multiline": true
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(multiline["matches"].as_array().expect("matches").len(), 1);
        assert_eq!(multiline["matches"][0]["line"], 1);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn grep_deduplicates_overlapping_roots_and_reports_binary_files() {
        let (runtime, root) = fixture_runtime();
        let matches = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "roots": [".", "src", "src"]
                }),
                &runtime,
            )
            .await,
        );
        let paths: Vec<&str> = matches["matches"]
            .as_array()
            .expect("matches")
            .iter()
            .map(|entry| entry["path"].as_str().expect("path"))
            .collect();
        assert_eq!(paths, vec!["src/a.rs", "src/b.rs"]);
        assert!(matches["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "binary_file" && error["path"] == "binary.dat"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn invalid_regex_limits_and_mismatched_cursors_are_errors() {
        let (runtime, root) = fixture_runtime();
        let invalid_regex = execute("grep", json!({"pattern": "("}), &runtime).await;
        assert!(invalid_regex.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&invalid_regex.content).expect("error JSON")["error"]
                ["code"],
            "invalid_regex"
        );
        let invalid_limit = execute("glob", json!({"pattern": "**", "limit": 0}), &runtime).await;
        assert!(invalid_limit.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&invalid_limit.content).expect("error JSON")["error"]
                ["code"],
            "invalid_arguments"
        );
        let first =
            parsed(execute("glob", json!({"pattern": "**/*.rs", "limit": 1}), &runtime).await);
        let mismatched = execute(
            "glob",
            json!({
                "pattern": "**/*.txt",
                "limit": 1,
                "cursor": first["next_cursor"]
            }),
            &runtime,
        )
        .await;
        assert!(mismatched.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&mismatched.content).expect("error JSON")["error"]
                ["code"],
            "invalid_cursor"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn dispatch_path_bounds_long_match_text() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("src/long.rs"),
            format!("needle {}\n", "x".repeat(10_000)),
        )
        .expect("write long fixture");
        let result = crate::tools::execute_tool(
            "grep",
            json!({
                "pattern": "needle",
                "regex": false,
                "globs": ["src/long.rs"]
            }),
            &runtime,
            &crate::model::ModelClient::new_for_test(),
        )
        .await;
        assert!(
            !result.is_error,
            "unexpected dispatch error: {}",
            result.content
        );
        assert!(result.content.len() < 70_000);
        let output: Value = serde_json::from_str(&result.content).expect("result JSON");
        assert_eq!(output["matches"].as_array().expect("matches").len(), 1);
        assert_eq!(output["matches"][0]["text_truncated"], true);

        let malformed = execute(
            "glob",
            json!({"pattern": "**", "cursor": "not-a-cursor"}),
            &runtime,
        )
        .await;
        assert!(malformed.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&malformed.content).expect("error JSON")["error"]["code"],
            "invalid_cursor"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn pathological_regex_is_bounded_per_file() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("src/pathological.txt"),
            format!("{}!\n", "a".repeat(20_000)),
        )
        .expect("write pathological fixture");
        let output = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "(a+)+$",
                    "globs": ["src/pathological.txt"],
                    "case": "sensitive"
                }),
                &runtime,
            )
            .await,
        );
        assert!(output["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "regex_timeout"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn aborting_search_cancels_the_helper_process() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("src/pathological.txt"),
            format!("{}!\n", "a".repeat(20_000)),
        )
        .expect("write pathological fixture");
        let task = tokio::spawn(async move {
            execute(
                "grep",
                json!({
                    "pattern": "(a+)+$",
                    "globs": ["src/pathological.txt"],
                    "case": "sensitive"
                }),
                &runtime,
            )
            .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        task.abort();
        let joined = tokio::time::timeout(std::time::Duration::from_secs(1), task)
            .await
            .expect("cancelled search must stop promptly");
        assert!(joined
            .expect_err("aborted task must not complete")
            .is_cancelled());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_escapes_are_structured_and_never_followed() {
        use std::os::unix::fs::symlink;

        let (runtime, root) = fixture_runtime();
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).expect("create outside fixture");
        fs::write(outside.join("secret.rs"), "ExecutionBackend\n").expect("write outside file");
        symlink(&outside, root.join("escape")).expect("create escaping symlink");
        let output = parsed(execute("glob", json!({"pattern": "**"}), &runtime).await);
        assert!(output["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "symlink_escape" && error["path"] == "escape"));
        assert!(output["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .all(|entry| !entry["path"].as_str().expect("path").starts_with("escape/")));
        fs::remove_dir_all(root).expect("remove fixture");
        fs::remove_dir_all(outside).expect("remove outside fixture");
    }

    #[tokio::test]
    #[ignore = "requires Podman"]
    async fn podman_and_local_backends_return_identical_discovery_pages() {
        let (local, root) = fixture_runtime();
        let podman = podman_runtime(&root).await;
        let requests = [
            (
                "glob",
                json!({
                    "pattern": "**/*",
                    "hidden": true,
                    "gitignore": false,
                    "limit": 5
                }),
            ),
            (
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "hidden": true,
                    "gitignore": false,
                    "limit": 5
                }),
            ),
        ];
        for (tool, request) in requests {
            let local_output = execute(tool, request.clone(), &local).await;
            let podman_output = execute(tool, request, &podman).await;
            assert_eq!(
                podman_output.is_error, local_output.is_error,
                "{tool}: Podman={}, local={}",
                podman_output.content, local_output.content
            );
            assert_eq!(
                serde_json::from_str::<Value>(&podman_output.content).expect("Podman JSON"),
                serde_json::from_str::<Value>(&local_output.content).expect("local JSON"),
                "{tool}"
            );
        }
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "mutates process PATH; run filtered with one test thread"]
    async fn ssh_and_local_backends_return_identical_discovery_pages() {
        use std::os::unix::fs::PermissionsExt;

        struct PathGuard(Option<std::ffi::OsString>);
        impl Drop for PathGuard {
            fn drop(&mut self) {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }

        let original_path = std::env::var_os("PATH");
        let fake_bin = std::env::temp_dir().join(format!("nac-fake-ssh-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&fake_bin).expect("create fake ssh bin");
        let ssh = fake_bin.join("ssh");
        fs::write(
            &ssh,
            "#!/bin/bash\nremote=\"${@: -1}\"\ncase \"$remote\" in *'/usr/bin/python3'*|*'/usr/local/bin/python3'*|*'/opt/homebrew/bin/python3'*|*'/run/current-system/sw/bin/python3'*|*'/nix/var/nix/profiles/default/bin/python3'*) exit 127;; esac\nexec /bin/bash -c \"$remote\"\n",
        )
        .expect("write fake ssh");
        fs::set_permissions(&ssh, fs::Permissions::from_mode(0o755))
            .expect("make fake ssh executable");
        let python = fake_bin.join("python3");
        fs::write(&python, "#!/bin/sh\nexec /usr/bin/python3 \"$@\"\n")
            .expect("write PATH-only python fixture");
        fs::set_permissions(&python, fs::Permissions::from_mode(0o755))
            .expect("make PATH-only python executable");
        let combined_path = std::env::join_paths(
            std::iter::once(fake_bin.clone()).chain(
                original_path
                    .as_deref()
                    .into_iter()
                    .flat_map(std::env::split_paths),
            ),
        )
        .expect("compose fake ssh PATH");
        let _path_guard = PathGuard(original_path);
        std::env::set_var("PATH", combined_path);

        let (local, root) = fixture_runtime();
        let mut ssh_runtime = crate::tools::test_runtime();
        ssh_runtime.workspace_cwd = root.clone();
        ssh_runtime.config_cwd = root.clone();
        ssh_runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Ssh(
            crate::sandbox::SshBackend::new("fixture-host".to_string(), root.clone()),
        ));
        for (tool, request) in [
            (
                "glob",
                json!({"pattern": "**/*.rs", "hidden": true, "gitignore": false}),
            ),
            (
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "hidden": true,
                    "gitignore": false
                }),
            ),
        ] {
            let local_output = execute(tool, request.clone(), &local).await;
            let ssh_output = execute(tool, request, &ssh_runtime).await;
            assert_eq!(ssh_output.is_error, local_output.is_error, "{tool}");
            assert_eq!(
                serde_json::from_str::<Value>(&ssh_output.content).expect("SSH JSON"),
                serde_json::from_str::<Value>(&local_output.content).expect("local JSON"),
                "{tool}"
            );
        }
        fs::remove_dir_all(root).expect("remove fixture");
        fs::remove_dir_all(fake_bin).expect("remove fake ssh bin");
    }

    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "mutates process PATH; run filtered with one test thread"]
    async fn tools_work_without_external_search_binaries_on_path() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        struct PathGuard(Option<std::ffi::OsString>);
        impl Drop for PathGuard {
            fn drop(&mut self) {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }

        let original_path = std::env::var_os("PATH");
        let python = original_path
            .as_deref()
            .into_iter()
            .flat_map(std::env::split_paths)
            .map(|directory| directory.join("python3"))
            .find(|candidate| candidate.is_file())
            .expect("python3 must be available for the backend helper");
        let isolated_path =
            std::env::temp_dir().join(format!("nac-discovery-path-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&isolated_path).expect("create isolated PATH");
        symlink(python, isolated_path.join("python3")).expect("link python3");
        for command in ["rg", "grep", "find", "fd"] {
            let shim = isolated_path.join(command);
            fs::write(&shim, "#!/bin/sh\nexit 97\n").expect("write failing search shim");
            fs::set_permissions(&shim, fs::Permissions::from_mode(0o755))
                .expect("make search shim executable");
        }
        let _path_guard = PathGuard(original_path);
        std::env::set_var("PATH", &isolated_path);

        let (runtime, root) = fixture_runtime();
        let glob = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
        assert_eq!(glob["entries"].as_array().expect("entries").len(), 2);
        let grep = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "globs": ["src/*.rs"]
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(grep["matches"].as_array().expect("matches").len(), 2);
        fs::remove_dir_all(root).expect("remove fixture");
        fs::remove_dir_all(isolated_path).expect("remove isolated PATH");
    }

    #[tokio::test]
    async fn scoped_roots_inherit_workspace_ignore_rules() {
        let (runtime, root) = fixture_runtime();
        fs::write(root.join(".gitignore"), "ignored.rs\n*.generated.rs\n")
            .expect("extend workspace ignore fixture");
        fs::write(
            root.join("nested/skipped.generated.rs"),
            "ExecutionBackend\n",
        )
        .expect("write ancestor-ignored fixture");

        let glob = parsed(
            execute(
                "glob",
                json!({"pattern": "**/*.rs", "root": "nested"}),
                &runtime,
            )
            .await,
        );
        assert!(glob["entries"].as_array().expect("entries").is_empty());
        let grep = parsed(
            execute(
                "grep",
                json!({"pattern": "ExecutionBackend", "regex": false, "roots": ["nested"]}),
                &runtime,
            )
            .await,
        );
        assert!(grep["matches"].as_array().expect("matches").is_empty());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn multiline_context_starts_after_the_match_end() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("src/context.rs"),
            "before\nBEGIN\nmiddle\nafter\n",
        )
        .expect("write multiline context fixture");
        let output = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "BEGIN\n",
                    "roots": ["src"],
                    "globs": ["src/context.rs"],
                    "multiline": true,
                    "context": 1
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(output["matches"][0]["before"], json!(["before"]));
        assert_eq!(output["matches"][0]["after"], json!(["middle"]));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn byte_limited_pages_have_exact_continuation_cursors() {
        let (runtime, root) = fixture_runtime();
        for index in 0..400 {
            let directory = root.join(format!("src/{index:04}-{}", "x".repeat(180)));
            fs::create_dir(&directory).expect("create long path fixture");
            fs::write(directory.join("match.rs"), "x\n").expect("write long path fixture");
        }

        let mut cursor: Option<String> = None;
        let mut paths = Vec::new();
        loop {
            let output = parsed(
                execute(
                    "glob",
                    json!({
                        "pattern": "0*/match.rs",
                        "root": "src",
                        "limit": 1000,
                        "cursor": cursor
                    }),
                    &runtime,
                )
                .await,
            );
            assert!(output.to_string().len() <= 64 * 1024);
            paths.extend(
                output["entries"]
                    .as_array()
                    .expect("entries")
                    .iter()
                    .map(|entry| entry["path"].as_str().expect("path").to_string()),
            );
            cursor = output["next_cursor"].as_str().map(ToString::to_string);
            if cursor.is_none() {
                break;
            }
        }
        let expected: Vec<String> = (0..400)
            .map(|index| format!("src/{index:04}-{}/match.rs", "x".repeat(180)))
            .collect();
        assert_eq!(paths, expected);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn aggregate_arrays_and_version_specific_regexes_are_rejected() {
        let (runtime, root) = fixture_runtime();
        let roots: Vec<String> = (0..33).map(|index| format!("root-{index}")).collect();
        let excessive = execute("grep", json!({"pattern": "x", "roots": roots}), &runtime).await;
        assert!(excessive.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&excessive.content).expect("error JSON")["error"]["code"],
            "invalid_arguments"
        );

        let unsupported =
            execute("grep", json!({"pattern": "(?>x)", "regex": true}), &runtime).await;
        assert!(unsupported.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&unsupported.content).expect("error JSON")["error"]
                ["code"],
            "invalid_regex"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn isolated_python_does_not_import_workspace_modules() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("base64.py"),
            "from pathlib import Path\nPath('workspace-imported').write_text('bad')\n",
        )
        .expect("write import-shadow fixture");
        let output = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
        assert_eq!(output["entries"].as_array().expect("entries").len(), 2);
        assert!(!root.join("workspace-imported").exists());
        assert!(output["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .all(|entry| entry.get("size").is_none()));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn portable_regex_validation_keeps_ordinary_escapes() {
        let (runtime, root) = fixture_runtime();
        let escaped = parsed(
            execute(
                "grep",
                json!({"pattern": "\\bExecutionBackend\\b", "globs": ["src/*.rs"]}),
                &runtime,
            )
            .await,
        );
        assert_eq!(escaped["matches"].as_array().expect("matches").len(), 2);
        let literal_closing_brace =
            parsed(execute("grep", json!({"pattern": "}+", "regex": true}), &runtime).await);
        assert!(literal_closing_brace["matches"].is_array());

        for pattern in ["x(?i)y", "a{,3}+"] {
            let nonportable =
                execute("grep", json!({"pattern": pattern, "regex": true}), &runtime).await;
            assert!(nonportable.is_error, "{pattern}");
            assert_eq!(
                serde_json::from_str::<Value>(&nonportable.content).expect("error JSON")["error"]
                    ["code"],
                "invalid_regex"
            );
        }
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn context_materialization_has_a_cumulative_byte_limit() {
        let (runtime, root) = fixture_runtime();
        let line = format!("{}\n", "x".repeat(300));
        fs::write(root.join("src/memory.rs"), line.repeat(10_000))
            .expect("write materialization fixture");
        let output = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "^",
                    "roots": ["src"],
                    "globs": ["src/memory.rs"],
                    "context": 100,
                    "limit": 1000
                }),
                &runtime,
            )
            .await,
        );
        assert!(output["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "materialized_limit"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn ignore_rules_have_cumulative_count_and_byte_limits() {
        let (runtime, root) = fixture_runtime();
        let roots: Vec<String> = (0..32).map(|index| format!("root-{index}")).collect();
        for directory in &roots {
            fs::create_dir(root.join(directory)).expect("create sibling root");
        }
        let shared_rules: String = (0..129).map(|index| format!("shared-{index}\n")).collect();
        fs::write(root.join(".gitignore"), shared_rules).expect("write shared ignore fixture");
        let shared =
            parsed(execute("grep", json!({"pattern": "x", "roots": roots}), &runtime).await);
        assert!(shared["matches"].as_array().expect("matches").is_empty());

        let rules: String = (0..4097)
            .map(|index| format!("ignored-{index}\n"))
            .collect();
        fs::write(root.join(".gitignore"), rules).expect("write excessive ignore fixture");
        let result = execute("glob", json!({"pattern": "**/*"}), &runtime).await;
        assert!(result.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&result.content).expect("error JSON")["error"]["code"],
            "ignore_limit"
        );

        fs::write(root.join(".gitignore"), "literal\\\\ \n")
            .expect("write trailing-space parity fixture");
        fs::write(root.join("literal\\"), "x").expect("write backslash filename fixture");
        let parity = parsed(execute("glob", json!({"pattern": "literal*"}), &runtime).await);
        assert!(parity["entries"].as_array().expect("entries").is_empty());
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
