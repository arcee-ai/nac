"""Resolve controlled child expectations using immutable P's production source."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

from ci_qualifications import require_checkout
from ci_startup_process import capture
from ci_xctest_attachments import bounded_file

PRODUCT = '4b7a1f3e0bf6175a77c5ebf627fe965860e99976'
SOURCE = 'desktop/macos/CommandEnvironment.swift'
SOURCE_SHA256 = 'c4b64f8bed76285c9455c48256180ff5cec5e775eabb832cf326ab4da3ca14a2'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def resolve_environment(product, profile, *, run=None, directory=None):
    """No algorithm copy, ambient expectation, shell, product or process probe."""
    require_checkout(product, PRODUCT)
    source = Path(product) / SOURCE
    helper = Path(__file__).with_name('CIStartupEnvironment.swift').resolve(strict=True)
    source_data = bounded_file(source, 32 * 1024)
    helper_data = bounded_file(helper, 32 * 1024)
    if source.resolve(strict=True) != source or sha(source_data) != SOURCE_SHA256:
        raise RuntimeError('Immutable product environment resolver differs')
    launcher = profile['environment']
    if (not isinstance(launcher, dict) or any(not isinstance(value, str) or '\0' in value for value in launcher.values())
            or any(key.endswith(('_TOKEN', '_API_KEY')) or key == 'NAC_MANAGED_CONFIG' for key in launcher)):
        raise RuntimeError('Startup environment contains uncontrolled authority')
    request = {'environment': launcher, 'cwd': str(profile['home']), 'extra_paths': []}
    encoded = json.dumps(request, sort_keys=True).encode()
    if len(encoded) > 32 * 1024:
        raise RuntimeError('Startup environment input exceeds bound')
    if run is not None:
        data, errors = capture(['/usr/bin/xcrun', '--find', 'swiftc'], directory, 'environment-find', 10, run, cwd=product)
        if errors:
            raise RuntimeError('Environment compiler lookup stderr')
        compiler = data.decode().strip()
    else:
        compiler = subprocess.check_output(['/usr/bin/xcrun', '--find', 'swiftc'], timeout=10).decode().strip()
    swift = ['/usr/bin/xcrun', 'swiftc']
    if run is not None:
        stdout, stderr = capture([*swift, '--version'], directory, 'environment-version', 10, run, cwd=product)
        version_data = stdout + stderr
    else:
        version = subprocess.run([*swift, '--version'], capture_output=True, check=True, timeout=10)
        version_data = version.stdout + version.stderr
    if len(version_data) > 4096:
        raise RuntimeError('Startup environment compiler provenance exceeds bound')
    with tempfile.TemporaryDirectory(prefix='environment-resolver-', dir=profile['root']) as temporary:
        folder = Path(temporary)
        input_file, executable = folder / 'input.json', folder / 'Resolver'
        input_file.write_bytes(encoded)
        input_file.chmod(0o400)
        if run is not None:
            stdout, stderr = capture([*swift, '-swift-version', '5', str(source), str(helper), '-o', str(executable)],
                directory, 'environment-build', 45, run, cwd=product)
            build = subprocess.CompletedProcess([], 0, stdout, stderr)
        else:
            build = subprocess.run([*swift, '-swift-version', '5', str(source), str(helper), '-o', str(executable)],
                                   capture_output=True, timeout=45)
        if build.returncode or len(build.stdout) + len(build.stderr) > 32768:
            raise RuntimeError('Pure Foundation startup resolver compilation unavailable')
        if run is not None:
            stdout, stderr = capture([str(executable), str(input_file)], directory, 'environment-resolve', 5, run, cwd=product)
            result = subprocess.CompletedProcess([], 0, stdout, stderr)
        else:
            result = subprocess.run([str(executable), str(input_file)], capture_output=True, timeout=5)
        if result.returncode or result.stderr or len(result.stdout) > 32768:
            raise RuntimeError('Pure Foundation startup environment resolution unavailable')
        resolved = json.loads(result.stdout)
        if (not isinstance(resolved, dict) or set(resolved) != set(launcher)
                or any(not isinstance(value, str) or '\0' in value for value in resolved.values())
                or any(resolved[key] != value for key, value in launcher.items() if key != 'PATH')):
            raise RuntimeError('Product resolver changed another controlled value')
        receipt = {'product_sha': PRODUCT, 'source': SOURCE, 'source_sha256': SOURCE_SHA256,
                   'helper_sha256': sha(helper_data), 'compiler': compiler, 'compiler_version': version_data.decode(),
                   'compiler_invocation': swift,
                   'swift_version': '5', 'compilation_defines': [], 'executable_sha256': sha(executable.read_bytes()),
                   'input_sha256': sha(encoded), 'output_sha256': sha(result.stdout),
                   'cwd': request['cwd'], 'extra_paths': [],
                   'scope': 'Actual P CommandEnvironment.resolve in a pure Foundation helper; no app or engine launch'}
    if source.read_bytes() != source_data or helper.read_bytes() != helper_data:
        raise RuntimeError('Startup resolver source changed during resolution')
    return resolved, receipt
