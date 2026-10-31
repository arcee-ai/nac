"""Materialize an optional performance target from the maintained XCTest project.

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
PROJECT_HASH = 'c300f4f487568373cdceed57def49e0fee0a2933f202d41f4ee57acbfefe23c8'
SCHEME_HASH = 'ec07cee66f67e5d22db49ab474bf6f79441f26f56cef1412f02382aef005de0c'
TARGETS = ('NACNativeUITests', 'NACPerformanceUITests')


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


def performance_variant(base, native_path, performance_path, performance_hash):
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
        clone = clone.replace('NACNativeUITests', 'NACPerformanceUITests')
        clone = clone.replace('ai.arcee.nac.ci.ui-tests', 'ai.arcee.nac.ci.performance-ui-tests')
        if number == 5:
            clone = replace_once(clone, quote(native_path), quote(performance_path))
        if number == 13:
            clone = replace_once(clone, 'NAC_UI_FIXTURE = "";',
                'NAC_UI_FIXTURE = "";\n        NAC_PERFORMANCE_SOURCE_PATH = ' + quote(performance_path)
                + ';\n        NAC_PERFORMANCE_SOURCE_SHA256 = ' + quote(performance_hash) + ';')
        clones.append(clone)
    for old, new in (
        ('targets = (A10000000000000000000004);', 'targets = (A10000000000000000000004, B10000000000000000000004);'),
        ('children = (A10000000000000000000005, A10000000000000000000003);',
         'children = (A10000000000000000000005, B10000000000000000000005, A10000000000000000000003);'),
        ('children = (A10000000000000000000006);', 'children = (A10000000000000000000006, B10000000000000000000006);'),
    ):
        text = replace_once(text, old, new)
    text = replace_once(text, '  };\n  rootObject', '\n'.join(clones) + '\n  };\n  rootObject')
    return text.encode()


def materialize_project(harness_root, harness_sha, *, performance_root=None, performance_sha=None,
                        performance_source_sha256=None, output=None):
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
    if performance_root is None:
        if any(value is not None for value in (performance_sha, performance_source_sha256, output)):
            raise RuntimeError('Optional performance selection is incomplete')
        require_checkout(harness, harness_sha)
        return {'project': str(project_path.parent), 'scheme': TARGETS[0], 'receipt': receipt}
    performance = checkout(performance_root, performance_sha)
    performance_path, source = source_file(performance, PERFORMANCE)
    if (not isinstance(performance_source_sha256, str)
            or not re.fullmatch('[0-9a-f]{64}', performance_source_sha256)
            or digest(source) != performance_source_sha256):
        raise RuntimeError('Exact performance Swift source hash differs')
    if output is None:
        raise RuntimeError('Performance selection requires a private output directory')
    output = Path(output)
    if (not output.is_absolute() or output.resolve() != output or output.exists()
            or not output.parent.is_dir() or output.is_relative_to(harness) or output.is_relative_to(performance)):
        raise RuntimeError('Generated project destination must be absent, canonical and outside source checkouts')
    generated = performance_variant(base, native_path, performance_path, performance_source_sha256)
    selected_scheme = scheme.replace(b'NACNativeUITests', b'NACPerformanceUITests')
    selected_scheme = selected_scheme.replace(b'A10000000000000000000004', b'B10000000000000000000004')
    # The private container retains the maintained project's name; only the
    # target/product/scheme selection changes. No missing inherited source root.
    selected_scheme = selected_scheme.replace(b'container:NACPerformanceUITests.xcodeproj', b'container:NACNativeUITests.xcodeproj')
    selected_scheme = selected_scheme.replace(b'    </EnvironmentVariables>',
        b'      <EnvironmentVariable key="NAC_PERFORMANCE_SOURCE_PATH" value="$(NAC_PERFORMANCE_SOURCE_PATH)" isEnabled="YES"/>\n'
        b'      <EnvironmentVariable key="NAC_PERFORMANCE_SOURCE_SHA256" value="$(NAC_PERFORMANCE_SOURCE_SHA256)" isEnabled="YES"/>\n'
        b'    </EnvironmentVariables>')
    require_checkout(harness, harness_sha)
    require_checkout(performance, performance_sha)
    if source_file(harness, NATIVE)[1] != native or source_file(performance, PERFORMANCE)[1] != source:
        raise RuntimeError('XCTest source changed during materialization')
    output.mkdir(mode=0o700)
    project = output / PROJECT.name
    schemes = project / SCHEME.parent
    schemes.mkdir(parents=True)
    (project / 'project.pbxproj').write_bytes(generated)
    (schemes / SCHEME.name).write_bytes(scheme)
    performance_scheme = schemes / 'NACPerformanceUITests.xcscheme'
    performance_scheme.write_bytes(selected_scheme)
    receipt.update(performance_sha=performance_sha, expected_target=TARGETS[1], generated=True,
                   performance_source_path=str(performance_path), performance_source_sha256=digest(source),
                   generated_project_sha256=digest(generated), ordinary_scheme_sha256=digest(scheme),
                   selected_scheme_sha256=digest(selected_scheme),
                   source_resolution='All inherited input references reviewed under exact base pins; H/P Swift refs absolute')
    receipt['sources'][str(performance_path)] = digest(source)
    (output / 'project-selection.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return {'project': str(project), 'scheme': TARGETS[1], 'receipt': receipt}
