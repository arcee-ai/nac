"""Exercise the complete preview start owner with inert capture collaborators.

No AppKit/WebKit, provider listener, profile filesystem or engine is initialized.
Shared-host callers must hold the canonical compiler lease around this test.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import tempfile
import time
import unittest

SOURCE_ROOT = Path(__file__).resolve().parent
ARTIFACTS = None

HARNESS = r'''
import Foundation
import Darwin
struct EngineLaunchConfiguration: Equatable { let cwd: URL; let store: URL; let environment: [String:String] }
struct EngineReceipt { let incarnation: String }
struct EngineFailure: Error {}
final class PreviewProfile {
    let workspace=URL(fileURLWithPath:"/inert/workspace")
    let store=URL(fileURLWithPath:"/inert/store")
    let environment=["SENTINEL":"unchanged","HTTP_PROXY":"original-http","NO_PROXY":"original-bypass"]
    init() throws {}
}
final class FixtureProvider {
    let baseURL=URL(string:"http://127.0.0.1:43123")!
    var starts=0
    func start() async throws { starts += 1 }
}
final class PreviewSmoke {
    var profiles=0; var engines=0; var before=0
    func configure(_ profile: PreviewProfile) throws { profiles += 1 }
    func configure(_ engine: PreviewEngine) { engines += 1 }
    func beforeLaunch(_ profile: PreviewProfile) async throws { before += 1 }
}
final class PreviewEngine {
    var receipt: EngineReceipt?
    var onReady: ((URL)->Void)?
    var onExit: ((Int32)->Void)?
    var onFailure: ((EngineFailure)->Void)?
    var configurations: [EngineLaunchConfiguration]=[]
    func launch(executable: URL, configuration: EngineLaunchConfiguration) throws { configurations.append(configuration) }
    #if PREVIEW_SMOKE && !LOCAL_APP
__HELPER__
    #endif
}
@MainActor final class PreviewApp {
    var profile: PreviewProfile?
    let provider=FixtureProvider()
    let engine=PreviewEngine()
    var smoke: PreviewSmoke?=PreviewSmoke()
    var stopping=false
    var failure: String?
    var launchConfiguration: EngineLaunchConfiguration?
    var loading: Task<Void,Never>?
    var loads=0
    func load(_ url: URL, incarnation: String) async { loads += 1 }
    func engineFailed(_ failure: EngineFailure) {}
    let recovery=InertRecovery()
    func fail(_ message: String) { failure=message }
    func exercise(_ retry: EngineLaunchConfiguration?=nil) async { await start(retryConfiguration:retry) }
__START__
}
final class InertRecovery { func engineExited(_ message: String) {} }
@main struct Control {
    static func require(_ condition: @autoclosure () -> Bool, _ message: String = "Inert complete-start control failed") {
        guard condition() else { fputs("FAIL: " + message + "\n", stderr); exit(1) }
    }
    @MainActor static func main() async {
        let hostEnvironment=ProcessInfo.processInfo.environment
        let app=PreviewApp()
        await app.exercise()
        require(app.failure == nil && app.engine.configurations.count == 1)
        let saved=app.launchConfiguration!
        var expected=app.profile!.environment
        expected["MODELS_DEV_URL"]=app.provider.baseURL.appendingPathComponent("models-dev").absoluteString
        let arguments=CommandLine.arguments
        var recording=false
        #if PREVIEW_SMOKE && !LOCAL_APP
        if arguments.filter({$0=="--smoke-scenario"}).count == 1,
           let index=arguments.firstIndex(of:"--smoke-scenario"), index+1<arguments.count {
            recording=arguments[index+1]=="external-navigation-recording"
        }
        #endif
        if recording {
            for key in ["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY"] { expected[key]=app.provider.baseURL.absoluteString }
            expected["NO_PROXY"]="127.0.0.1,localhost,::1"
        }
        require(saved.environment == expected, "Actual complete start bypassed its scenario fence")
        require(saved == app.engine.configurations[0])
        await app.exercise(saved)
        require(app.engine.configurations == [saved,saved], "Saved retry changed launch configuration")
        require(app.provider.starts == 1 && app.profile!.environment["HTTP_PROXY"] == "original-http")
        #if PREVIEW_SMOKE
        require(app.smoke!.profiles == 1 && app.smoke!.engines == 1 && app.smoke!.before == 1)
        #endif
        let stopped=PreviewApp();stopped.stopping=true
        await stopped.exercise()
        require(stopped.engine.configurations.isEmpty, "Stopped launch reached child admission")
        require(hostEnvironment == ProcessInfo.processInfo.environment, "Host environment changed")
        print("Complete actual start captured fresh/retry environments; no native, provider, profile or engine side effects")
    }
}
'''


@unittest.skipUnless(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'Apple Silicon Swift control')
class RecordingLaunchConfigurationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = None
        if ARTIFACTS is None:
            cls.temporary = tempfile.TemporaryDirectory(prefix='nac-recording-launch-inert-')
            cls.output = Path(cls.temporary.name)
        else:
            cls.output = ARTIFACTS
            cls.output.mkdir(parents=True, exist_ok=False)
        app = (SOURCE_ROOT / 'PreviewApp.swift').read_text()
        engine = (SOURCE_ROOT / 'PreviewEngine.swift').read_text()
        # Keep the entire current owner, including launch/save/retry/stopping and
        # build conditionals. Replace only its collaborators with inert captures.
        start = '    private func start(retryConfiguration:' + app.split(
            '    private func start(retryConfiguration:', 1)[1].split('    private func load(', 1)[0]
        helper = '    static func recordingEnvironment(' + engine.split(
            '    static func recordingEnvironment(', 1)[1].split('    #endif', 1)[0]
        harness = HARNESS.replace('__START__', start).replace('__HELPER__', helper)
        source = cls.output / 'RecordingLaunchInert.swift'
        source.write_text(harness)
        cls.receipt = {
            'actual_owner_sha256': hashlib.sha256(app.encode()).hexdigest(),
            'actual_helper_file_sha256': hashlib.sha256(engine.encode()).hexdigest(),
            'harness_sha256': hashlib.sha256(harness.encode()).hexdigest(),
            'native_provider_profile_engine_operations': False,
            'commands': [],
        }
        for mode, defines in [('smoke', ['-D', 'PREVIEW_SMOKE']), ('ordinary', [])]:
            result = cls.command(['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5',
                                  '-target', 'arm64-apple-macosx14.0', '-O', *defines,
                                  str(source), '-o', str(cls.output / mode)], timeout=60)
            if result.returncode:
                raise RuntimeError('Inert source compilation failed; see retained command receipt')

    @classmethod
    def tearDownClass(cls):
        if cls.temporary is not None:
            cls.temporary.cleanup()

    @classmethod
    def command(cls, argv, timeout=5):
        before = time.monotonic()
        result = subprocess.run(argv, text=True, capture_output=True, timeout=timeout)
        cls.receipt['commands'].append({
            'argv': argv, 'exit': result.returncode, 'seconds': time.monotonic() - before,
            'stdout': result.stdout, 'stderr': result.stderr,
        })
        (cls.output / 'receipt.json').write_text(json.dumps(cls.receipt, indent=2) + '\n')
        return result

    def check(self, mode, arguments):
        result = self.command([str(self.output / mode), *arguments])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Complete actual start captured fresh/retry environments', result.stdout)

    def test_recording_fresh_retry_stopped(self):
        self.check('smoke', ['--smoke-scenario', 'external-navigation-recording'])

    def test_other_missing_near_match_and_duplicate_scenarios(self):
        for arguments in [
            [], ['--smoke-scenario'], ['--smoke-scenario', 'normal'],
            ['--smoke-scenario', 'stale-launch'], ['--smoke-scenario', 'external-auth'],
            ['--smoke-scenario', 'external-navigation-recording-extra'],
            ['--smoke-scenario', 'external-navigation-recording', '--smoke-scenario', 'normal'],
            ['--smoke-scenario', 'normal', '--smoke-scenario', 'external-navigation-recording'],
        ]:
            with self.subTest(arguments=arguments):
                self.check('smoke', arguments)

    def test_ordinary_preview_ignores_recording_arguments(self):
        self.check('ordinary', ['--smoke-scenario', 'external-navigation-recording'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--artifacts', type=Path)
    options, remaining = parser.parse_known_args()
    if options.source_root:
        SOURCE_ROOT = options.source_root.resolve()
    ARTIFACTS = options.artifacts.resolve() if options.artifacts else None
    unittest.main(argv=[__file__, *remaining])
