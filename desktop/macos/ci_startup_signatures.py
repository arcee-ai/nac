"""Configured-case build-only signature admission; no signing or native launch.

Approved request-only exception (2026-11-10). The existing build owner invokes
xcodebuild. This
module observes the actual two signed outputs, not generated entitlement input.
"""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import struct
import xml.etree.ElementTree as ET

from ci_xctest_attachments import bounded_file
from ci_xctest_project import SCHEME, private_request_selection, require_private_port_signatures


def require(ok, reason):
    if not ok:
        raise RuntimeError('Startup signed request port: ' + reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def toolchain(command):
    developer = os.environ.get('DEVELOPER_DIR')
    require(bool(developer), 'selected developer directory missing')
    result = {'developer_directory': developer}
    for name, args in (
        ('xcode', ['xcodebuild', '-version']),
        ('sdk', ['xcrun', '--sdk', 'macosx', '--show-sdk-version']),
        ('sdk_path', ['xcrun', '--sdk', 'macosx', '--show-sdk-path']),
        ('swift', ['xcrun', 'swiftc', '--version']),
        ('compiler', ['xcrun', '--find', 'swiftc'])):
        value = command(args)
        require(type(value) is str and 0 < len(value) <= 8192, 'toolchain observation missing')
        result[name] = value
    return result


def source_snapshot(selection, config_path, configuration_sha256):
    require(sha(bounded_file(config_path, 64 * 1024)) == configuration_sha256,
            'immutable configuration changed')
    sources = selection['receipt']['sources']
    require(type(sources) is dict and len(sources) == 4, 'complete compiler source inventory required')
    result = {}
    for name, expected in sources.items():
        path = Path(name)
        require(path.is_absolute() and path.resolve(strict=True) == path,
                'source path alias')
        actual = sha(bounded_file(path, 256 * 1024))
        require(actual == expected, 'compiler source bytes differ')
        result[name] = actual
    project = Path(selection['project']) / 'project.pbxproj'
    require(sha(bounded_file(project, 256 * 1024)) == selection['receipt']['generated_project_sha256'],
            'generated project changed')
    for name, key in ((SCHEME.name, 'ordinary_scheme_sha256'),
                      (selection['scheme'] + '.xcscheme', 'selected_scheme_sha256')):
        scheme = Path(selection['project']) / SCHEME.parent / name
        require(scheme.resolve(strict=True) == scheme, 'selected scheme path alias')
        require(sha(bounded_file(scheme, 64 * 1024)) == selection['receipt'].get(key),
                'selected/ordinary scheme changed')
    return result


def decoded_entitlements(text, executable, *, allow_absent=False):
    require(type(text) is str and len(text.encode()) <= 64 * 1024, 'signed XML output bound')
    prefix = 'Executable=' + str(executable) + '\n'
    if allow_absent and text in (prefix, prefix[:-1]):
        return None  # Verified loadable-library absence, distinct from empty XML.
    if text.startswith(prefix):
        text = text[len(prefix):]
    require(text.lstrip().startswith('<?xml') and text.count('<?xml') == 1,
            'unexpected signature output; require actual XML')
    root = ET.fromstring(text)
    # plistlib would silently overwrite a repeated key. Reject every duplicate.
    for node in root.iter('dict'):
        children = list(node)
        require(len(children) % 2 == 0 and all(children[i].tag == 'key' for i in range(0, len(children), 2)),
                'malformed signed dictionary')
        keys = [children[i].text for i in range(0, len(children), 2)]
        require(len(keys) == len(set(keys)), 'duplicate signed entitlement')
    result = plistlib.loads(text.encode())
    require(type(result) is dict, 'signed entitlement dictionary missing')
    return result


def macho_type(data):
    """Read only bounded Mach-O code kind; strict codesign still verifies it."""
    def thin(value):
        headers = {b'\xcf\xfa\xed\xfe': ('<', 32), b'\xce\xfa\xed\xfe': ('<', 28),
                   b'\xfe\xed\xfa\xcf': ('>', 32), b'\xfe\xed\xfa\xce': ('>', 28)}
        endian, size = headers.get(value[:4], ('', 0))
        require(bool(endian) and len(value) >= size, 'invalid Mach-O header')
        return struct.unpack_from(endian + 'I', value, 12)[0]
    if data[:4] not in (b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
        return thin(data)
    require(len(data) >= 8, 'short universal header')
    count = struct.unpack_from('>I', data, 4)[0]
    stride = 32 if data[:4] == b'\xca\xfe\xba\xbf' else 20
    end = 8 + count * stride
    require(0 < count <= 8 and end <= len(data), 'universal table bounds')
    kinds, ranges = set(), []
    for index in range(count):
        at = 8 + index * stride + 8
        if stride == 32:
            start, size, alignment, reserved = struct.unpack_from('>QQII', data, at)
            require(reserved == 0, 'universal reserved field')
        else:
            start, size, alignment = struct.unpack_from('>III', data, at)
        require(start >= end and size >= 28 and start + size <= len(data)
                and alignment <= 30 and start % (1 << alignment) == 0, 'universal slice bounds')
        require(all(start + size <= a or start >= b for a, b in ranges), 'overlapping universal slices')
        ranges.append((start, start + size))
        kinds.add(thin(data[start:start + size]))
    require(len(kinds) == 1, 'mixed universal code kinds')
    return kinds.pop()


def signed_outputs(runner, receipt, command):
    """Read-only verification/display of each actual generated signed bundle."""
    products = runner.parent
    require(products.resolve(strict=True) == products, 'products path alias')
    require(sha(bounded_file(runner, 512 * 1024)) == receipt['xctestrun_sha256'], 'xctestrun changed')
    target = receipt['generated_target']
    require(target.get('IsUITestBundle') is True and target.get('IsXCTRunnerHostedTestBundle') is True,
            'actual generated hosted XCTest role missing')

    def resolve(value, host=None):
        require(type(value) is str, 'generated product path absent')
        if value.startswith('__TESTROOT__/'):
            path = products / value[len('__TESTROOT__/'):]
        elif host is not None and value.startswith('__TESTHOST__/'):
            path = host / value[len('__TESTHOST__/'):]
        else:
            raise RuntimeError('Unsupported actual generated product path')
        require(path.resolve(strict=True) == path and path.is_relative_to(products) and path.is_dir(),
                'product outside canonical derived products')
        return path

    host = resolve(target['TestHostPath'])
    bundle = resolve(target['TestBundlePath'], host)
    require(host.name == 'NACStartupUITests-Runner.app' and bundle.name == 'NACStartupUITests.xctest'
            and bundle.is_relative_to(host / 'Contents/PlugIns'), 'actual selected runner/testbundle differs')
    result = {}
    for name, product in (('runner', host), ('testbundle', bundle)):
        info_path = product / 'Contents/Info.plist'
        info = bounded_file(info_path, 256 * 1024)
        executable_name = plistlib.loads(info).get('CFBundleExecutable')
        require(type(executable_name) is str and re.fullmatch('[A-Za-z0-9_-]+', executable_name),
                'bundle executable declaration differs')
        executable = product / 'Contents/MacOS' / executable_name
        require(executable.resolve(strict=True) == executable, 'signed executable alias')
        binary = bounded_file(executable, 32 * 1024 * 1024)
        before = sha(binary)
        verified = command(['/usr/bin/codesign', '--verify', '--strict', str(product)])
        text = command(['/usr/bin/codesign', '--display', '--entitlements', '-', '--xml', str(product)])
        kind = macho_type(binary)
        require(kind == (2 if name == 'runner' else 8), 'signed executable code kind differs')
        require(plistlib.loads(info).get('CFBundlePackageType') == ('APPL' if name == 'runner' else 'BNDL'),
                'signed bundle package kind differs')
        values = decoded_entitlements(text, executable, allow_absent=name == 'testbundle')
        require(before == sha(bounded_file(executable, 32 * 1024 * 1024))
                and info == bounded_file(info_path, 256 * 1024), 'signed binary/info changed during inspection')
        result[name] = dict(product=str(product), executable=str(executable), binary_sha256=before,
                            info_sha256=sha(info), entitlements=values, mach_o_type=kind,
                            entitlements_presence='absent' if values is None else 'present',
                            signed_xml_sha256=sha(text.encode()), verification_sha256=sha(verified.encode()))
    return result


def signature_values(rows):
    return {name: dict(presence=row['entitlements_presence'], entitlements=row['entitlements'],
                       mach_o_type=row['mach_o_type']) for name, row in rows.items()}


def private_build_pair(folder, config_path, configuration_sha256, config, selection, run, command,
                       context, build):
    """Two normal build-for-testing calls, no signing overrides/test execution.

    The ordinary baseline is actually built and independently inspected, using
    identical selected source/configuration/toolchain, before the candidate.
    Missing/changed evidence fails before returning a testable runner.
    """
    require(command is not None and context is not None, 'owned fixture/build observation ports missing')
    before_toolchain = toolchain(command)
    source = source_snapshot(selection, config_path, configuration_sha256)
    selected = private_request_selection(selection, bounded_file(config_path, 64 * 1024), configuration_sha256,
        owned_profile=context['profile'], profiles_root=context['profiles_root'],
        declaration=context['declaration'], output=folder / 'request-project')
    require(source_snapshot(selected, config_path, configuration_sha256) == source, 'candidate copied selection differs')
    baseline_folder = folder / 'normal-signature-baseline'
    baseline_folder.mkdir(mode=0o700)
    baseline_runner, baseline_receipt = build(baseline_folder, config_path, configuration_sha256,
                                            config, selection, run)
    baseline = signed_outputs(baseline_runner, baseline_receipt, command)
    require(source_snapshot(selection, config_path, configuration_sha256) == source
            and toolchain(command) == before_toolchain, 'baseline source/toolchain changed')
    require(source_snapshot(selected, config_path, configuration_sha256) == source, 'candidate selection changed before build')
    runner, receipt = build(folder, config_path, configuration_sha256, config, selected, run)
    actual = signed_outputs(runner, receipt, command)
    require(source_snapshot(selected, config_path, configuration_sha256) == source
            and toolchain(command) == before_toolchain, 'candidate source/toolchain changed')
    port = Path(context['declaration']['path']).parent / 'requests'
    observation = dict(schema='nac342-signature-observation-v1', acceptance=False,
                       admission='NOT_ESTABLISHED', toolchain=before_toolchain, sources=source,
                       configuration_sha256=configuration_sha256, baseline=baseline, candidate=actual)
    (folder / 'private-request-signature-observations.json').write_text(json.dumps(observation, indent=2) + '\n')
    require_private_port_signatures(signature_values(actual), signature_values(baseline), port)
    gate = dict(schema='nac342-request-child-signatures-v1', acceptance=False,
                toolchain=before_toolchain, sources=source, configuration_sha256=configuration_sha256,
                baseline_xctestrun_sha256=baseline_receipt['xctestrun_sha256'],
                baseline=baseline, candidate=actual, request_port=dict(selected['receipt']['private_request_proposal'],
                    actual_runner_entitlements_verified=True, actual_testbundle_entitlements_verified=True),
                both_actual_signatures_verified=True)
    receipt['private_request_signature_gate'] = gate
    recheck_private_build(receipt, context)
    (folder / 'private-request-signatures.json').write_text(json.dumps(gate, indent=2) + '\n')
    return runner, receipt


def recheck_private_build(receipt, context):
    """Existing owner calls again immediately before XCTest can launch input."""
    import stat
    gate = receipt.get('private_request_signature_gate')
    require(type(gate) is dict and gate.get('both_actual_signatures_verified') is True,
            'two-output signature admission absent')
    require(gate['request_port']['nonce'] == context['declaration']['nonce'], 'owner nonce changed')
    for name, expected in gate['request_port']['identities'].items():
        path = Path(name)
        info = path.lstat()
        require(path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
                and (info.st_dev, info.st_ino, info.st_uid, info.st_mode) == tuple(expected),
                'owned directory identity changed after signing')
    for row in gate['candidate'].values():
        require(sha(bounded_file(Path(row['executable']), 32 * 1024 * 1024)) == row['binary_sha256'],
                'candidate signed executable changed before input')
        require(sha(bounded_file(Path(row['product']) / 'Contents/Info.plist', 256 * 1024)) == row['info_sha256'],
                'candidate Info changed before input')
