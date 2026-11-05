"""Execute the complete maintained fixture with inert reference/platform ports.

Only imports, time/scheduling ports and the constructor call adapter differ;
all production methods come from the selected complete InstanceSmoke source.
Compiler/execution must be separately admitted through the canonical gate.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

OWNER = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def between(source, start, end, offset=0):
    begin = source.index(start, offset)
    finish = source.index(end, begin) + len(end)
    return source[begin:finish]


def prepare(evidence, source_revision=None):
    evidence.mkdir(parents=True, exist_ok=False)

    def read(name):
        if source_revision:
            return subprocess.check_output(
                ['git', 'show', source_revision + ':desktop/macos/' + name],
                cwd=OWNER, text=True)
        return (OWNER / name).read_text()

    smoke, app = read('InstanceSmoke.swift'), read('PreviewApp.swift')
    template = (OWNER / 'InstanceCurrentViewFixture.swift').read_text()
    post = 'private let currentView:' in smoke
    transformed = smoke
    transformations = [
        ('import AppKit\n', ''), ('import WebKit\n', ''),
        ('ProcessInfo.processInfo.systemUptime', 'I1Clock.now'),
        ('Date().addingTimeInterval(timeout)', 'I1Clock.date.addingTimeInterval(timeout)'),
        ('while Date() < deadline', 'while I1Clock.date < deadline'),
        ('try await Task.sleep(nanoseconds:', 'try await I1Clock.sleep(nanoseconds:'),
        ('DispatchQueue.main.asyncAfter', 'I1Dispatch.main.asyncAfter'),
        ('RunLoop.main.perform', 'I1RunLoop.main.perform'),
    ]
    counts = {}
    for before, after in transformations:
        counts[before] = transformed.count(before)
        transformed = transformed.replace(before, after)
    initial = between(app, '        let configuration = WKWebViewConfiguration()',
                      '        window.contentView!.addSubview(webView)')
    has_replacement = '    func replaceWorkspace(' in app
    has_profile_drop = '                commands = nil' in app
    drop = (between(app, '                commands?.retire()', '                commands = nil',
                    app.index('    private func load(')) if has_profile_drop
            else 'webView.removeFromSuperview(); webView = nil')
    if has_replacement:
        replacement = between(app, '        let configuration = WKWebViewConfiguration()',
                              '        webView = replacement', app.index('    func replaceWorkspace('))
    else:
        # This lower prefix has no product replacement/retirement owner yet.
        # Controlled reference ports test InstanceSmoke against a successor;
        # they are never reported as actual PreviewApp construction paths.
        replacement = ('let configuration = WKWebViewConfiguration()\n'
                       + 'let replacement = WKWebView(frame: window.contentView!.bounds, configuration: configuration)\n'
                       + ('InstanceSmoke.configure(replacement)\n' if post else '')
                       + 'webView = replacement')
    common = ('engine: app.engine, conflicts: app.conflicts, retryButton: { [weak app] in app?.button }, '
              'baseURL: { [weak app] in app?.engine.receipt?.endpoint.flatMap { URL(string: $0) } }, '
              'failure: { [weak app] in app?.error }, requestQuit: { [weak app] in app?.quits += 1 })')
    if post:
        constructor = ('return InstanceSmoke(window: app.window, currentView: { [weak app] in app?.webView }, '
                       'documentGeneration: { [weak app] in app?.recovery.documentGeneration ?? -1 }, ' + common)
    else:
        legacy_common = common.replace(', requestQuit: { [weak app] in app?.quits += 1 }', '')
        constructor = 'return InstanceSmoke(window: app.window, webView: app.webView, ' + legacy_common
    if has_replacement:
        retirement = read('WorkspaceRetirement.swift').replace('import AppKit\n', '').replace('import WebKit\n', '')
        retirement = retirement.replace('ProcessInfo.processInfo.systemUptime', 'I1Clock.now')
        retirement = retirement.replace('try await Task.sleep(nanoseconds:', 'try await I1Clock.sleep(nanoseconds:')
        retirement = retirement.replace('DispatchQueue.main.asyncAfter', 'I1Dispatch.main.asyncAfter')
    else:
        retirement = ("@MainActor struct WorkspaceRetirement {\n"
                      "init(view: WKWebView?, commands: NativeCommands?, dropOwner: () -> Void) { dropOwner() }\n"
                      "func wait() async throws { try Task.checkCancellation() }\n}\n")
        template = template.replace('actual-retirement-weak-release', 'retirement-reference-port-weak-release')
    callback = ''
    if post:
        callback = between(smoke, '            RunLoop.main.perform(inModes: [.common])',
                           '\n            }', smoke.index('guard let finishBinding'))
        # Caller names only adapt the already-pinned token and callback receiver.
        callback = callback.replace('finishBinding', 'binding').replace('[self]', '[probe]')
        callback = callback.replace('requireCurrentView(binding)', 'probe.requireCurrentView(binding)')
        callback = callback.replace('requestQuit()', 'probe.requestQuit()').replace('RunLoop.main.perform', 'I1RunLoop.main.perform')
    # Extract the actual start failure catch and finish gate. The initial
    # pre-I1 source has no operation gate; its unchanged catch remains semantic
    # baseline evidence, rather than a missing-symbol compilation failure.
    catch_start = smoke.index('            } catch {', smoke.index('    func start()'))
    catch_body_start = catch_start + len('            } catch {\n')
    catch_end = smoke.index('\n            }', catch_body_start)
    failure_catch = smoke[catch_body_start:catch_end].replace('return }', 'return false }')
    if post:
        failure_finish = between(smoke, '            guard let finishBinding', '\n            }', catch_end)
        failure_finish = failure_finish.replace('return }', 'return false }', 1).replace('RunLoop.main.perform', 'I1RunLoop.main.perform')
    else:
        failure_finish = ''
    generated = template.replace('// INSTANCE_OWNER', transformed).replace('// RETIREMENT_OWNER', retirement)
    generated = generated.replace('// APP_INITIAL_CREATION', initial)
    generated = generated.replace('// APP_PROFILE_DROP', drop)
    generated = generated.replace('// APP_REPLACEMENT_CREATION', replacement)
    generated = generated.replace('// INITIALIZER_ADAPTER', constructor)
    generated = generated.replace('// QUEUED_QUIT_CALLBACK', callback)
    generated = generated.replace('// FAILURE_CATCH_BODY', failure_catch)
    generated = generated.replace('// FAILURE_FINISH_OWNER', failure_finish)
    path = evidence / 'InstanceCurrentView.generated.swift'
    path.write_text(generated)
    inputs = {}
    for name in ['EngineProtocol.swift', 'EngineFailure.swift', 'StoreConflict.swift']:
        raw = read(name)
        target = evidence / name
        target.write_text(raw)
        inputs[name] = digest(raw.encode())
    proof = dict(source_revision=source_revision or 'working-candidate', post=post,
                 whole_smoke_sha256=digest(smoke.encode()), whole_app_sha256=digest(app.encode()),
                 template_sha256=digest(template.encode()), generated_sha256=digest(generated.encode()),
                 whole_smoke_methods_verbatim_except_declared_ports=True,
                 transformations=counts, initial_creation_sha256=digest(initial.encode()),
                 profile_drop_sha256=digest(drop.encode()), replacement_creation_sha256=digest(replacement.encode()),
                 queued_quit_callback_sha256=digest(callback.encode()),
                 failure_catch_sha256=digest(failure_catch.encode()),
                 failure_finish_sha256=digest(failure_finish.encode()), inputs=inputs,
                 no_copied_lifecycle_or_readiness_controller=True, native_acceptance=False,
                 actual_app_replacement_source=has_replacement,
                 actual_retirement_owner_source=has_replacement,
                 actual_profile_drop_source=has_profile_drop,
                 initial_creation_source=True)
    (evidence / 'source-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    return path, proof


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--source-revision')
    args = parser.parse_args()
    path, proof = prepare(args.evidence, args.source_revision)
    print(json.dumps(dict(source=str(path), proof=proof), indent=2))


if __name__ == '__main__':
    main()
