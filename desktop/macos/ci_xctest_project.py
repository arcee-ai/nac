"""Materialize finite external test targets from the maintained XCTest project.

No code is copied and no xctestrun is fabricated. The hash-locked small base has
one group-relative source and no configuration/resource file references. A base
change requires reviewing every inherited reference before updating these pins.
"""
import hashlib
import json
from pathlib import Path
import re

from ci_qualifications import require_checkout
from ci_xctest_attachments import bounded_file

PROJECT = Path('desktop/macos/NativeUITests/NACNativeUITests.xcodeproj')
SCHEME = Path('xcshareddata/xcschemes/NACNativeUITests.xcscheme')
NATIVE = Path('desktop/macos/NativeUITests/NativeJourneys.swift')
PERFORMANCE = Path('desktop/macos/performance/PerformanceJourneys.swift')
STARTUP = Path('desktop/macos/startup_xctest/StartupJourneys.swift')
PROJECT_HASH = 'c300f4f487568373cdceed57def49e0fee0a2933f202d41f4ee57acbfefe23c8'
SCHEME_HASH = 'ec07cee66f67e5d22db49ab474bf6f79441f26f56cef1412f02382aef005de0c'
TARGETS = ('NACNativeUITests', 'NACPerformanceUITests', 'NACStartupUITests')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_file(root, relative):
    path = root / relative
    if path.resolve() != path or not path.is_file():
        raise RuntimeError('XCTest input is missing, symlinked or nonregular: ' + str(relative))
    return path, bounded_file(path, 256 * 1024)


def checkout(root, sha):
    root = Path(root)
    if (not root.is_absolute() or root.resolve() != root
            or not isinstance(sha, str) or not re.fullmatch('[0-9a-f]{40}', sha)):
        raise RuntimeError('XCTest source must be a canonical absolute immutable checkout')
    require_checkout(root, sha)
    return root


def quote(path):
    text = str(path)
    if any(ord(character) < 32 or ord(character) == 127 for character in text):
        raise RuntimeError('Control character in XCTest source path')
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Maintained XCTest project shape differs')
    return text.replace(old, new)


def source_variant(base, native_path, external_path, source_hash, target, prefix, support=()):
    # Exact base pin resolves EVERY inherited file reference: the native Swift
    # file becomes absolute; built-products refs remain Xcode outputs. Groups,
    # build configurations and framework phases contain no other input paths.
    text = base.decode()
    native_ref = 'path = NativeJourneys.swift;\n      sourceTree = "<group>";'
    text = replace_once(text, native_ref, 'path = ' + quote(native_path) + ';\n      sourceTree = "<absolute>";')
    clones = []
    for number in (4, 5, 6, 7, 8, 9, 11, 13):
        identity = 'A1' + f'{number:022d}'
        pattern = r'^    ' + identity + r' = \{\n.*?^    \};'
        matches = re.findall(pattern, text, re.MULTILINE | re.DOTALL)
        if len(matches) != 1:
            raise RuntimeError('Maintained XCTest object missing or ambiguous')
        clone = matches[0].replace('A100000000000000000000', 'B100000000000000000000')
        clone = clone.replace('NACNativeUITests', target)
        clone = clone.replace('ai.arcee.nac.ci.ui-tests', 'ai.arcee.nac.ci.' + prefix.lower() + '-ui-tests')
        if number == 5:
            clone = replace_once(clone, quote(native_path), quote(external_path))
        if number == 13:
            clone = replace_once(clone, 'NAC_UI_FIXTURE = "";',
                'NAC_UI_FIXTURE = "";\n        NAC_' + prefix + '_SOURCE_PATH = ' + quote(external_path)
                + ';\n        NAC_' + prefix + '_SOURCE_SHA256 = ' + quote(source_hash) + ';'
                + (''.join('\n        NAC_STARTUP_' + name + ' = "";'
                           for name in ('PRODUCT_SHA', 'TEST_SHA', 'HARNESS_SHA', 'CONFIGURATION_SHA256'))
                   if target == TARGETS[2] else ''))
        clones.append(clone)
    for old, new in (
        ('targets = (A10000000000000000000004);', 'targets = (A10000000000000000000004, B10000000000000000000004);'),
        ('children = (A10000000000000000000005, A10000000000000000000003);',
         'children = (A10000000000000000000005, B10000000000000000000005, A10000000000000000000003);'),
        ('children = (A10000000000000000000006);', 'children = (A10000000000000000000006, B10000000000000000000006);'),
    ):
        text = replace_once(text, old, new)
    if support:
        file_ids, build_ids = [], []
        for index, path in enumerate(support, 1):
            file_id, build_id = 'C1' + f'{index:022d}', 'C2' + f'{index:022d}'
            file_ids.append(file_id); build_ids.append(build_id)
            clones += [f'    {file_id} = {{\n      isa = PBXFileReference;\n      lastKnownFileType = sourcecode.swift;\n'
                       f'      path = {quote(path)};\n      sourceTree = "<absolute>";\n    }};',
                       f'    {build_id} = {{\n      isa = PBXBuildFile;\n      fileRef = {file_id};\n    }};']
        # Change only the cloned startup source phase, never the original target.
        clones = [item.replace('files = (B10000000000000000000009);',
                    'files = (B10000000000000000000009, ' + ', '.join(build_ids) + ');') for item in clones]
        text = replace_once(text, 'children = (A10000000000000000000005, B10000000000000000000005, A10000000000000000000003);',
            'children = (A10000000000000000000005, B10000000000000000000005, ' + ', '.join(file_ids) + ', A10000000000000000000003);')
    text = replace_once(text, '  };\n  rootObject', '\n'.join(clones) + '\n  };\n  rootObject')
    return text.encode()


def materialize_project(harness_root, harness_sha, *, performance_root=None, performance_sha=None,
                        performance_source_sha256=None, startup_root=None, startup_sha=None,
                        startup_source_sha256=None, output=None):
    """Return an actual project/selected scheme plus honest source/hash receipt.

    output must be an absent directory below a caller-owned canonical private
    parent outside both sources. No optional input means the original project.
    """
    harness = checkout(harness_root, harness_sha)
    project_path, base = source_file(harness, PROJECT / 'project.pbxproj')
    scheme_path, scheme = source_file(harness, PROJECT / SCHEME)
    native_path, native = source_file(harness, NATIVE)
    if digest(base) != PROJECT_HASH or digest(scheme) != SCHEME_HASH:
        raise RuntimeError('Maintained XCTest definition changed; review all inherited references')
    receipt = {'harness_sha': harness_sha, 'base_project_sha256': digest(base),
               'base_scheme_sha256': digest(scheme), 'sources': {
                   str(native_path): digest(native)}, 'expected_target': TARGETS[0],
               'generated': False}
    startup = any(value is not None for value in (startup_root, startup_sha, startup_source_sha256))
    if startup and any(value is not None for value in (performance_root, performance_sha, performance_source_sha256)):
        raise RuntimeError('External XCTest selections are mutually exclusive')
    if startup and any(value is None for value in (startup_root, startup_sha, startup_source_sha256)):
        raise RuntimeError('Optional startup selection is incomplete')
    if performance_root is None and not startup:
        if any(value is not None for value in (performance_sha, performance_source_sha256, output)):
            raise RuntimeError('Optional performance selection is incomplete')
        require_checkout(harness, harness_sha)
        return {'project': str(project_path.parent), 'scheme': TARGETS[0], 'receipt': receipt}
    prefix, target = ('STARTUP', TARGETS[2]) if startup else ('PERFORMANCE', TARGETS[1])
    external_sha = startup_sha if startup else performance_sha
    external_hash = startup_source_sha256 if startup else performance_source_sha256
    external = checkout(startup_root if startup else performance_root, external_sha)
    relative = STARTUP if startup else PERFORMANCE
    external_path, source = source_file(external, relative)
    if (not isinstance(external_hash, str)
            or not re.fullmatch('[0-9a-f]{64}', external_hash) or digest(source) != external_hash):
        raise RuntimeError('Exact external Swift source hash differs')
    if output is None:
        raise RuntimeError('External selection requires a private output directory')
    output = Path(output)
    if (not output.is_absolute() or output.resolve() != output or output.exists()
            or not output.parent.is_dir() or output.is_relative_to(harness) or output.is_relative_to(external)):
        raise RuntimeError('Generated project destination must be absent, canonical and outside source checkouts')
    support = {}
    if startup:
        for name in ('StartupAXGuard.swift', 'StartupAXReceipt.swift'):
            path, value = source_file(external, STARTUP.with_name(name))
            support[path] = value
    generated = source_variant(base, native_path, external_path, external_hash, target, prefix, tuple(support))
    selected_scheme = scheme.replace(b'NACNativeUITests', target.encode())
    selected_scheme = selected_scheme.replace(b'A10000000000000000000004', b'B10000000000000000000004')
    # The private container retains the maintained project's name; only the
    # target/product/scheme selection changes. No missing inherited source root.
    selected_scheme = selected_scheme.replace(('container:' + target + '.xcodeproj').encode(), b'container:NACNativeUITests.xcodeproj')
    selected_scheme = selected_scheme.replace(b'    </EnvironmentVariables>',
        ''.join('      <EnvironmentVariable key="NAC_' + prefix + '_' + name
                + '" value="$(NAC_' + prefix + '_' + name + ')" isEnabled="YES"/>\n'
                for name in (('SOURCE_PATH', 'SOURCE_SHA256', 'PRODUCT_SHA', 'TEST_SHA', 'HARNESS_SHA', 'CONFIGURATION_SHA256')
                             if startup else ('SOURCE_PATH', 'SOURCE_SHA256'))).encode()
        + b'    </EnvironmentVariables>')
    require_checkout(harness, harness_sha)
    require_checkout(external, external_sha)
    if source_file(harness, NATIVE)[1] != native or source_file(external, relative)[1] != source:
        raise RuntimeError('XCTest source changed during materialization')
    for path, value in support.items():
        if source_file(external, STARTUP.with_name(path.name))[1] != value:
            raise RuntimeError('Startup support source changed during materialization')
    output.mkdir(mode=0o700)
    project = output / PROJECT.name
    schemes = project / SCHEME.parent
    schemes.mkdir(parents=True)
    (project / 'project.pbxproj').write_bytes(generated)
    (schemes / SCHEME.name).write_bytes(scheme)
    (schemes / (target + '.xcscheme')).write_bytes(selected_scheme)
    receipt.update({prefix.lower() + '_sha': external_sha, prefix.lower() + '_source_path': str(external_path),
                    prefix.lower() + '_source_sha256': digest(source)})
    receipt.update(expected_target=target, generated=True,
                   generated_project_sha256=digest(generated), ordinary_scheme_sha256=digest(scheme),
                   selected_scheme_sha256=digest(selected_scheme),
                   source_resolution='All inherited input references reviewed under exact base pins; H/P Swift refs absolute')
    receipt['sources'][str(external_path)] = digest(source)
    for path, value in support.items():
        receipt['sources'][str(path)] = digest(value)
    (output / 'project-selection.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return {'project': str(project), 'scheme': target, 'receipt': receipt}
