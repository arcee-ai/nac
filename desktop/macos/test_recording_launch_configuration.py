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
    #if PREVIEW_SMOKE
    var offline: OfflineProviderPolicy?
    static var failNext=false
    static var stops=0
    static var stoppedAfterRetirement=true
    static var failSettlement=false
    static var settlementDeadlines: [TimeInterval]=[]
    func awaitOfflineControlStop(deadline: TimeInterval) async throws {
        Self.settlementDeadlines.append(deadline)
        if Self.failSettlement { throw EngineFailure() }
    }
    func stop() { Self.stops += 1; Self.stoppedAfterRetirement = Self.stoppedAfterRetirement && offline?.retired == true }
    #endif
    func start() async throws {
        starts += 1
        #if PREVIEW_SMOKE
        if Self.failNext { Self.failNext=false; throw EngineFailure() }
        #endif
    }
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
    #if PREVIEW_SMOKE
    @MainActor static func offlinePolicyControls() async {
        func rejects(_ action: () throws -> Void) { do { try action(); require(false,"Expected refusal") } catch {} }
        require(OfflineProviderPolicy.selected(["x","--smoke-scenario","offline-api-key"]))
        for args in [[String](),["--smoke-scenario"],["--smoke-scenario","offline-api-key-extra"],
                     ["--smoke-scenario","offline-api-key","--smoke-scenario","normal"]] { require(!OfflineProviderPolicy.selected(args)) }
        do {
            _ = try OfflineProviderPolicy.loopback(URL(string:"http://127.0.0.1:1234")!)
            for raw in ["http://localhost:1234","https://127.0.0.1:1234","http://user@127.0.0.1:1234","http://127.0.0.1:1234/?key=x","http://127.0.0.1:1234/path"] {
                rejects { _ = try OfflineProviderPolicy.loopback(URL(string:raw)!) }
            }
            let p=OfflineProviderPolicy(); let token=try p.canary()
            require(p.directCanary("/offline-canary/unknown")==nil)
            require(p.directCanary("/offline-canary/"+token)==token)
            require(!p.authorize("GET /models HTTP/1.1",response:false))
            require(!p.authorize("GET /models HTTP/1.1\r\nAuthorization: Bearer wrong",response:false))
            require(!p.authorize("GET /models HTTP/1.1\r\nAuthorization: Bearer "+OfflineProviderPolicy.key+"\r\nAuthorization: Bearer "+OfflineProviderPolicy.key,response:false))
            require(p.authorize("POST /responses HTTP/1.1\r\nAuthorization: Bearer "+OfflineProviderPolicy.key,response:true))
            try p.begin("old",authority:"localhost:11001",request:.http(method:"GET",path:"/offline-canary/OLD"))
            p.reject("GET http://localhost:11001/offline-canary/OLD HTTP/1.1"); try p.finish("old")
            // OLD traffic cannot satisfy NEW; a reused authority is refused even
            // after failure, including when a CONNECT hides its path.
            try p.begin("new",authority:"localhost:11002",request:.http(method:"GET",path:"/offline-canary/NEW"))
            p.reject("GET http://localhost:11001/offline-canary/OLD HTTP/1.1")
            rejects { try p.finish("new") }
            rejects { try p.begin("same-authority",authority:"localhost:11001",request:.http(method:"GET",path:"/offline-canary/NEW")) }
            rejects { try p.begin("failed-authority",authority:"localhost:11002",request:.http(method:"GET",path:"/offline-canary/NEW")) }
            try p.begin("wrong-path",authority:"localhost:11003",request:.http(method:"GET",path:"/offline-canary/NEW"))
            p.reject("GET http://localhost:11003/offline-canary/OLD HTTP/1.1")
            rejects { try p.finish("wrong-path") }
            try p.begin("wrong-method",authority:"localhost:11004",request:.http(method:"POST",path:"/responses"))
            p.reject("GET http://localhost:11004/responses HTTP/1.1")
            rejects { try p.finish("wrong-method") }
            try p.begin("http-connect",authority:"localhost:11005",request:.http(method:"GET",path:"/offline-canary/NEW"))
            p.reject("CONNECT localhost:11005 HTTP/1.1"); try p.finish("http-connect")
            for (index,form) in ["GET https://nonconnect0.invalid/x HTTP/1.1","GET http://nonconnect1.invalid:443/x HTTP/1.1"].enumerated() {
                let label="nonconnect"+String(index)
                try p.begin(label,authority:label+".invalid:443",request:.httpsConnect)
                p.reject(form); rejects { try p.finish(label) }
            }
            try p.begin("old-tls",authority:"current.invalid:443",request:.httpsConnect)
            p.reject("CONNECT old.invalid:443 HTTP/1.1"); rejects { try p.finish("old-tls") }
            try p.begin("https",authority:"latest.invalid:443",request:.httpsConnect)
            p.reject("CONNECT latest.invalid:443 HTTP/1.1");try p.finish("https")
            try p.begin("fallback",authority:"localhost:11006",request:.http(method:"GET",path:"/"))
            p.reject("CONNECT localhost:11006 HTTP/1.1")
            rejects { try p.finish("fallback",directToken:token) }
            try p.begin("overflow",authority:"localhost:11007",request:.http(method:"GET",path:"/"))
            for _ in 0..<9 { p.reject("CONNECT localhost:11007 HTTP/1.1") }
            rejects { try p.finish("overflow") }; rejects { try p.finish("absent") }
            let text=String(decoding:try JSONSerialization.data(withJSONObject:p.snapshot),as:UTF8.self)
            require(!text.contains(OfflineProviderPolicy.key) && !text.contains("localhost") && !text.contains(".invalid"))
            require(p.receipts.count==3 && p.responseAccepted==1 && p.keyRejected==3)
            require(p.receipts[2]["request_class"] as? String == "https-connect")
            p.retire(); rejects { _ = try p.canary() }

            let target=OfflineHTTPControlTarget()
            let stops=FixtureProvider.stops
            FixtureProvider.failNext=true
            do { _ = try await target.open(); require(false,"Start failure accepted") } catch {}
            require(target.policy == nil && FixtureProvider.stops==stops+1)
            _ = try await target.open()
            let first=target.policy!
            do { _ = try await target.open(); require(false,"Second target opened") } catch {}
            require(target.policy === first, "Duplicate open lost owned target")
            do { try await target.finish(); require(false,"Missing baseline accepted") } catch {}
            require(target.policy == nil && first.retired)
            _ = try await target.open()
            let success=target.policy!, nonce=try success.canary()
            success.noteDirectRequest(); require(success.directCanary("/offline-canary/"+nonce)==nonce)
            try target.acceptBaseline(nonce); try await target.finish()
            require(target.policy == nil && success.retired)
            require(success.directCanary("/offline-canary/"+nonce)==nil, "Retired target served late callback")
            _ = try await target.open()
            let leaking=target.policy!, leak=try leaking.canary()
            leaking.noteDirectRequest(); _ = leaking.directCanary("/offline-canary/"+leak)
            try target.acceptBaseline(leak); leaking.noteDirectRequest()
            do { try await target.finish(); require(false,"Direct leak accepted") } catch {}
            require(target.policy == nil && leaking.retired, "Leak failure skipped target cleanup")
            _ = try await target.open()
            rejects { try target.acceptBaseline("unobserved") }
            target.close(); target.close(); try await target.settle()
            require(target.policy == nil && FixtureProvider.stops==stops+5 && FixtureProvider.stoppedAfterRetirement)
            _ = try await target.open()
            let uncertain=target.policy!
            FixtureProvider.failSettlement=true
            let attempts=FixtureProvider.settlementDeadlines.count
            do { try await target.finish(); require(false,"Unsettled target accepted") } catch {}
            require(target.policy === uncertain && uncertain.retired)
            do { _ = try await target.open(); require(false,"Successor opened before settlement") } catch {}
            do { try await target.settle(); require(false,"Settlement retried") } catch {}
            require(FixtureProvider.settlementDeadlines.count==attempts+1 && FixtureProvider.stops==stops+6)
            FixtureProvider.failSettlement=false
            print("Offline OLD/NEW/same-authority/class refusal and exact target success/start/leak/baseline cleanup controls passed")
        } catch { require(false,"Offline inert policy/target control threw unexpectedly") }
    }
    #endif
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
            if arguments[index+1]=="external-auth" {
                expected["NAC_TELEMETRY"]="stderr"
                expected["NAC_TELEMETRY_SCENARIO"]="native-external-auth"
            }
        }
        #endif
        if recording {
            for key in ["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY"] { expected[key]=app.provider.baseURL.absoluteString }
            expected["NO_PROXY"]="127.0.0.1,localhost,::1"
        }
        #if PREVIEW_SMOKE
        if arguments.filter({$0=="--smoke-scenario"}).count == 1,
           let index=arguments.firstIndex(of:"--smoke-scenario"),index+1<arguments.count,
           arguments[index+1]=="offline-api-key" {
            for key in ["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy"] { expected[key]=app.provider.baseURL.absoluteString }
            expected["NO_PROXY"]="127.0.0.1"; expected["no_proxy"]="127.0.0.1"
        }
        #endif
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
        #if PREVIEW_SMOKE
        await offlinePolicyControls()
        #endif
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
            'actual_target_owner_sha256': hashlib.sha256((SOURCE_ROOT / 'OfflineHTTPControlTarget.swift').read_bytes()).hexdigest(),
            'actual_offline_policy_sha256': hashlib.sha256((SOURCE_ROOT / 'OfflineProviderPolicy.swift').read_bytes()).hexdigest(),
            'harness_sha256': hashlib.sha256(harness.encode()).hexdigest(),
            'native_provider_profile_engine_operations': False,
            'commands': [],
        }
        for mode, defines in [('smoke', ['-D', 'PREVIEW_SMOKE']), ('ordinary', [])]:
            result = cls.command(['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5',
                                  '-target', 'arm64-apple-macosx14.0', '-O', *defines,
                                  str(source), str(SOURCE_ROOT / 'OfflineProviderPolicy.swift'), str(SOURCE_ROOT / 'OfflineHTTPControlTarget.swift'), '-o', str(cls.output / mode)], timeout=60)
            if result.returncode:
                raise RuntimeError('Inert source compilation failed; see retained command receipt')

    @classmethod
    def tearDownClass(cls):
        if cls.temporary is not None:
            cls.temporary.cleanup()

    @classmethod
    def command(cls, argv, timeout=5):
        before = time.monotonic()
        row = {'argv': argv, 'timeout_seconds': timeout, 'state': 'attempted'}
        cls.receipt['commands'].append(row)
        def retain():
            (cls.output / 'receipt.json').write_text(json.dumps(cls.receipt, indent=2) + '\n')
        retain()
        try:
            result = subprocess.run(argv, text=True, capture_output=True, timeout=timeout)
            row.update(exit=result.returncode, stdout=result.stdout, stderr=result.stderr, state='completed')
            return result
        except BaseException as error:
            row.update(state='failed', error=type(error).__name__)
            raise
        finally:
            row['seconds'] = time.monotonic() - before
            retain()

    def check(self, mode, arguments):
        result = self.command([str(self.output / mode), *arguments])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Complete actual start captured fresh/retry environments', result.stdout)

    def test_recording_fresh_retry_stopped(self):
        self.check('smoke', ['--smoke-scenario', 'external-navigation-recording'])

    def test_other_missing_near_match_and_duplicate_scenarios(self):
        for arguments in [
            [], ['--smoke-scenario'], ['--smoke-scenario', 'normal'],
            ['--smoke-scenario', 'offline-api-key-extra'],
            ['--smoke-scenario', 'offline-api-key', '--smoke-scenario', 'normal'],
            ['--smoke-scenario', 'stale-launch'], ['--smoke-scenario', 'external-auth'],
            ['--smoke-scenario', 'external-auth-extra'], ['--smoke-scenario=external-auth'],
            ['--smoke-scenario', 'external-auth', '--smoke-scenario', 'normal'],
            ['--smoke-scenario', 'normal', '--smoke-scenario', 'external-auth'],
            ['--smoke-scenario', 'external-auth', '--smoke-scenario', 'external-auth'],
            ['--smoke-scenario', 'external-navigation-recording-extra'],
            ['--smoke-scenario', 'external-navigation-recording', '--smoke-scenario', 'normal'],
            ['--smoke-scenario', 'normal', '--smoke-scenario', 'external-navigation-recording'],
        ]:
            with self.subTest(arguments=arguments):
                self.check('smoke', arguments)

    def test_offline_fresh_retry_stopped(self):
        self.check('smoke', ['--smoke-scenario', 'offline-api-key'])
        self.check('ordinary', ['--smoke-scenario', 'offline-api-key'])

    def test_ordinary_preview_ignores_recording_arguments(self):
        self.check('ordinary', ['--smoke-scenario', 'external-navigation-recording'])
        self.check('ordinary', ['--smoke-scenario', 'external-auth'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--artifacts', type=Path)
    options, remaining = parser.parse_known_args()
    if options.source_root:
        SOURCE_ROOT = options.source_root.resolve()
    ARTIFACTS = options.artifacts.resolve() if options.artifacts else None
    unittest.main(argv=[__file__, *remaining])
