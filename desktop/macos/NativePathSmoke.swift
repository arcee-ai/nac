#if PREVIEW_SMOKE && !LOCAL_APP
import AppKit
import WebKit

/// Fixed app-owned fixture transitions around public XCTest input. This owns
/// only fresh preview-profile fixtures, never a normal user's folders or store.
@MainActor
final class NativePathSmoke {
    private unowned let app: PreviewApp
    private let paths: NativePathBridge
    private var inputDeadline = Date.distantFuture
    init(app: PreviewApp, paths: NativePathBridge) { self.app = app; self.paths = paths }

    private struct Scope {
        let run: String
        let identity: EngineIdentity
        let enginePID: pid_t
        let window: Int
        let initial: NativeDocumentBinding
        let origin: String
        let root: String
    }
    private struct RevealEvent: Codable, Equatable {
        let sequence: Int
        let run: String
        let document: String
        let href: String
    }
    private struct RevealObservation: Codable, Equatable {
        let version: Int
        let run: String
        let source: String
        let app_pid: Int
        let launch: String
        let view: String
        let document: String
        let origin: String
        let installed: Bool
        let current_document: Bool
        let count: Int
        let event: RevealEvent?
    }

    func run(failure: Bool = false, publish: @escaping ([String: Any]) -> Void) async throws -> [String: Any] {
        inputDeadline = Date().addingTimeInterval(240)
        try await wait("current shared workspace and path bridge") {
            self.app.baseURL != nil && self.paths.smokeSnapshot["installed"] as? Bool == true &&
                self.app.commands.currentDocument(in: self.app.webView) != nil &&
                (self.paths.smokeSnapshot["documents"] as? Int ?? 0) > 0
        }
        guard let profile = app.profile, let receipt = app.engine.receipt, let identity = receipt.identity,
              let binding = app.commands.currentDocument(in: app.webView),
              let endpoint = receipt.endpoint, let url = URL(string: endpoint),
              let scheme = url.scheme, let host = url.host, let port = url.port else {
            throw PreviewError.message("Disposable path fixture identity unavailable")
        }
        let runID = UUID().uuidString.lowercased()
        let revealLeaf = "reveal me 日本語 \(runID)"
        let folder = profile.root.appendingPathComponent("Folder with spaces 日本語 \(runID)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        try Data("ALL347_REVEAL_FIXTURE\n".utf8).write(to: folder.appendingPathComponent(revealLeaf))
        try FileManager.default.createSymbolicLink(at: folder.appendingPathComponent("outside-link"), withDestinationURL: profile.workspace)
        for arguments in [["init", "--quiet", "--initial-branch=main"], ["add", revealLeaf],
                          ["-c", "user.name=NAC disposable preview", "-c", "user.email=preview@example.test",
                           "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "path fixture"]] {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = ["-C", folder.path] + arguments
            process.environment = profile.environment
            process.standardInput = FileHandle.nullDevice
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw PreviewError.message("Path fixture repository setup failed") }
        }
        guard let root = canonical(folder.path) else { throw PreviewError.message("Fixture root unavailable") }
        let scope = Scope(run: runID, identity: identity, enginePID: app.engine.pid,
                          window: app.window.windowNumber, initial: binding,
                          origin: "\(scheme)://\(host):\(port)", root: root)
        let operation = failure ? "pending-engine-failure" : "select-reload-create-reveal"
        let order = failure ? ["ready", "failure-panel-observed"] :
            ["ready", "document-reloaded", "folder-moved", "folder-restored", "reveal-observed"]
        var sequence = -1
        func phase(_ name: String, _ current: NativeDocumentBinding, fields: [String: Any] = [:]) throws {
            guard sequence + 1 < order.count, order[sequence + 1] == name else {
                throw PreviewError.message("Unexpected path fixture phase")
            }
            try requireCurrent(scope, current)
            sequence += 1
            var record = fields
            record["paths_phase"] = ["version": 1, "name": name, "sequence": sequence,
                "run": runID, "source": identity.source_revision, "app_pid": Int(getpid()),
                "window": scope.window, "engine_pid": Int(scope.enginePID), "operation": operation,
                "launch": current.launch, "view": current.view, "document": current.document]
            publish(record)
        }
        let initialObserver = try await installObserver(scope, binding)
        try phase("ready", binding, fields: ["paths_xctest_ready": true, "app_pid": getpid(), "target_window_number": scope.window,
                 "initial_parent": profile.root.path, "selection_path": folder.path,
                 "engine_pid": scope.enginePID, "profile": profile.root.path,
                 "path_fixture_run": runID, "reveal_leaf": revealLeaf, "paths_operation": operation,
                 "paths_listener_initial": try object(initialObserver)])
        if failure {
            try await wait("first actual panel navigated to the unique owned folder", timeout: 90) {
                try self.panelAtFolder(scope, binding, choices: 1)
            }
            guard try await readObserver(scope, binding).count == 0 else {
                throw PreviewError.message("Unexpected reveal before the failure transition")
            }
            let before = paths.smokeSnapshot
            try phase("failure-panel-observed", binding)
            app.engine.loseChannel()
            try await wait("real engine failure retiring the panel and path handler", expectingEngineFailure: true) {
                self.app.failure != nil && self.app.engine.receipt == nil &&
                    self.paths.smokeSnapshot["installed"] as? Bool == false &&
                    self.paths.smokeSnapshot["pending"] as? Bool == false && self.app.window.attachedSheet == nil
            }
            return ["pending_panel_before_failure": before, "path_bridge_after_failure": paths.smokeSnapshot,
                    "actual_failure": app.failure ?? "", "launch_identity_retired": app.engine.receipt == nil]
        }
        try await wait("second actual panel navigated after real cancellation", timeout: 90) {
            try self.panelAtFolder(scope, binding, choices: 2) &&
                (self.paths.smokeSnapshot["cancellations"] as? Int ?? 0) >= 1
        }
        guard try await readObserver(scope, binding).count == 0 else {
            throw PreviewError.message("Unexpected reveal before document replacement")
        }
        let before = paths.smokeSnapshot["documents"] as? Int ?? 0
        app.webView.reload()
        try await wait("successor document with old sheet cancelled") {
            guard let next = self.app.commands.currentDocument(in: self.app.webView) else { return false }
            return next.launch == binding.launch && next.view == binding.view && next.document != binding.document &&
                (self.paths.smokeSnapshot["documents"] as? Int ?? 0) > before &&
                self.paths.smokeSnapshot["pending"] as? Bool == false && self.app.window.attachedSheet == nil
        }
        guard let current = app.commands.currentDocument(in: app.webView) else {
            throw PreviewError.message("Successor document unavailable")
        }
        let successorObserver = try await installObserver(scope, current)
        publish(["paths_listener_successor": try object(successorObserver)])
        try phase("document-reloaded", current)
        try await wait("first actual selection reaching an enabled normal project form", timeout: 60) {
            try self.requireCurrent(scope, current)
            let selections = self.paths.smokeSnapshot["selections"] as? [String] ?? []
            guard selections.count <= 1 else { throw PreviewError.message("Unexpected selection before move") }
            guard let selected = selections.first, self.canonical(selected) == scope.root,
                  self.paths.smokeSnapshot["pending"] as? Bool == false, self.app.window.attachedSheet == nil else { return false }
            return try await self.projectForm(scope, current, folder: folder.path, missing: false)
        }
        let moved = profile.root.appendingPathComponent(folder.lastPathComponent + ".moved")
        guard canonical(folder.path) == scope.root, !FileManager.default.fileExists(atPath: moved.path) else {
            throw PreviewError.message("Owned fixture rename precondition failed")
        }
        try FileManager.default.moveItem(at: folder, to: moved)
        try phase("folder-moved", current)
        try await wait("normal server missing-folder rejection") {
            try await self.projectForm(scope, current, folder: folder.path, missing: true)
        }
        try requireCurrent(scope, current)
        guard !FileManager.default.fileExists(atPath: folder.path), canonical(moved.path) != nil else {
            throw PreviewError.message("Owned fixture restore precondition failed")
        }
        try FileManager.default.moveItem(at: moved, to: folder)
        try phase("folder-restored", current)
        var reveal: RevealObservation?
        try await wait("explicit trusted reveal in the successor document", timeout: 90) {
            let observation = try await self.readObserver(scope, current)
            if observation.count == 1 { reveal = observation; return true }
            return false
        }
        guard let reveal else { throw PreviewError.message("Actual reveal observation unavailable") }
        let graceEnds = Date().addingTimeInterval(45)
        try phase("reveal-observed", current)
        let state = paths.smokeSnapshot
        let selections = state["selections"] as? [String] ?? []
        guard selections.count == 2, selections.allSatisfy({ canonical($0) == scope.root }),
              state["pending"] as? Bool == false, app.window.attachedSheet == nil else {
            throw PreviewError.message("Actual native panel did not settle exactly two explicit selections")
        }
        let target = try await verifySession(scope, current, revealLeaf: revealLeaf)
        // Time only preserves an observation window. It grants no Finder pass.
        // The actual XCTest result/selection attachments are independently required.
        while Date() < graceEnds {
            guard try await readObserver(scope, current) == reveal else {
                throw PreviewError.message("Reveal event changed or replayed during Finder observation")
            }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        guard !FileManager.default.fileExists(atPath: folder.appendingPathComponent("missing").path) else {
            throw PreviewError.message("Rejected Finder path created a missing directory")
        }
        return ["native_panel": state, "created_session": target, "reveal_observation": try object(reveal),
                "finder_observation_grace_seconds": 45, "input_driver": "public-XCTest; no driver filesystem control",
                "finder_assertion_owner": "independent actual XCTest result and selection attachments required",
                "finder_cleanup_residual": "Revealed window left open; stable OS window identity/close authority unqualified"]
    }

    private func requireCurrent(_ scope: Scope, _ binding: NativeDocumentBinding) throws {
        guard app.failure == nil, app.engine.pid == scope.enginePID,
              app.engine.receipt?.identity == scope.identity, app.engine.receipt?.incarnation == scope.initial.launch,
              app.window.windowNumber == scope.window, binding.launch == scope.initial.launch,
              binding.view == scope.initial.view, app.commands.currentDocument(in: app.webView) == binding,
              paths.smokeSnapshot["installed"] as? Bool == true else {
            throw PreviewError.message("Path fixture source/launch/window/document retired or replaced")
        }
    }
    private func panelAtFolder(_ scope: Scope, _ binding: NativeDocumentBinding, choices: Int) throws -> Bool {
        try requireCurrent(scope, binding)
        let state = paths.smokeSnapshot
        guard (state["choices"] as? Int ?? 0) <= choices,
              (state["selections"] as? [String] ?? []).isEmpty else {
            throw PreviewError.message("Unexpected panel input before the fixed fixture transition")
        }
        guard state["choices"] as? Int == choices, state["pending"] as? Bool == true,
              let panel = app.window.attachedSheet as? NSOpenPanel, let directory = panel.directoryURL else { return false }
        return canonical(directory.path) == scope.root
    }
    private func script(_ source: String, arguments: [String: Any], scope: Scope,
                        binding: NativeDocumentBinding) async throws -> Any? {
        try requireCurrent(scope, binding)
        let value = try await app.webView.callAsyncJavaScript(source, arguments: arguments, in: nil, contentWorld: .page)
        try requireCurrent(scope, binding)
        return value
    }
    private func projectForm(_ scope: Scope, _ binding: NativeDocumentBinding, folder: String, missing: Bool) async throws -> Bool {
        try await script(#"""
        const selected = [...document.querySelectorAll('button')].some(button =>
          button.getAttribute('aria-label') === 'Choose Working Folder: ' + folder && button.getClientRects().length);
        const create = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Create Project');
        const error = [...document.querySelectorAll('p')].some(item => item.getClientRects().length &&
          item.textContent.includes(folder) && item.textContent.includes('does not exist'));
        return selected && !!create && (missing ? error : !create.disabled);
        """#, arguments: ["folder": folder, "missing": missing], scope: scope, binding: binding) as? Bool == true
    }

    // Fixture-only observation: a read closure and event listener, no commands,
    // fetch replacement, UI changes or caller-supplied control operations.
    private static let observerScript = #"""
    if (location.origin !== origin || Object.hasOwn(window, '__nac347Fixture')) throw new Error('Fixture observer already installed or wrong origin');
    const installedDocument = document;
    const identity = Object.freeze({version:1, run, source, app_pid, launch, view, document:documentID, origin});
    let count = 0;
    let event = null;
    const read = () => {
      if (document !== installedDocument || location.origin !== origin) throw new Error('Stale fixture document');
      if (count > 1) throw new Error('Replayed reveal event');
      return {...identity, installed:true, current_document:true, count, event:event && {...event}};
    };
    document.addEventListener('click', input => {
      const button = input.target instanceof Element ? input.target.closest('button') : null;
      if (!input.isTrusted || !button || button.disabled || button.textContent.trim() !== 'Reveal in Finder') return;
      count += 1;
      event = Object.freeze({sequence:count, run, document:documentID, href:location.href});
    }, true);
    Object.defineProperty(window, '__nac347Fixture', {value:read, writable:false, configurable:false});
    return read();
    """#
    private func installObserver(_ scope: Scope, _ binding: NativeDocumentBinding) async throws -> RevealObservation {
        let value = try await script(Self.observerScript, arguments: ["origin": scope.origin, "run": scope.run,
            "source": scope.identity.source_revision, "app_pid": Int(getpid()), "launch": binding.launch,
            "view": binding.view, "documentID": binding.document], scope: scope, binding: binding)
        let observation = try decodeObservation(value, scope, binding)
        guard observation.count == 0 else { throw PreviewError.message("Fixture observer installed after reveal") }
        return observation
    }
    private func readObserver(_ scope: Scope, _ binding: NativeDocumentBinding) async throws -> RevealObservation {
        let value = try await script("if (typeof window.__nac347Fixture !== 'function') throw new Error('Missing fixture observer'); return window.__nac347Fixture();",
                                     arguments: [:], scope: scope, binding: binding)
        return try decodeObservation(value, scope, binding)
    }
    private func decodeObservation(_ value: Any?, _ scope: Scope, _ binding: NativeDocumentBinding) throws -> RevealObservation {
        guard let value else { throw PreviewError.message("Missing reveal observation") }
        let observation = try JSONDecoder().decode(RevealObservation.self, from: JSONSerialization.data(withJSONObject: value))
        guard observation.version == 1, observation.run == scope.run, observation.source == scope.identity.source_revision,
              observation.app_pid == Int(getpid()), observation.launch == binding.launch, observation.view == binding.view,
              observation.document == binding.document, observation.origin == scope.origin, observation.installed,
              observation.current_document, (0...1).contains(observation.count) else {
            throw PreviewError.message("Missing, stale or replayed reveal observation")
        }
        if observation.count == 0 {
            guard observation.event == nil else { throw PreviewError.message("Unexpected early reveal event") }
        } else {
            guard let event = observation.event, event.sequence == 1, event.run == scope.run,
                  event.document == binding.document, URL(string: event.href) == app.webView.url,
                  URL(string: event.href)?.fragment?.hasPrefix("/session/") == true else {
                throw PreviewError.message("Reveal event belongs to another route or document")
            }
        }
        return observation
    }
    private func verifySession(_ scope: Scope, _ binding: NativeDocumentBinding, revealLeaf: String) async throws -> [String: Any] {
        let target = try await script(#"""
        const id = location.hash.match(/^#\/session\/([^/]+)/)?.[1];
        if (!id) throw new Error('Normal project flow did not open its first chat');
        const response = await fetch('/sessions/' + encodeURIComponent(id));
        if (!response.ok) throw new Error('Current session unavailable');
        const snapshot = await response.json();
        const root = snapshot.metadata.workspace_host_path;
        const denials = [];
        for (const [path, expected] of [
          ['../outside', root], ['/tmp/absolute', root], ['missing/child', root],
          ['outside-link', root], [revealLeaf, root + '/stale'], ['file:///tmp/not-a-target', root]
        ]) {
          const result = await fetch('/sessions/' + encodeURIComponent(id) + '/workspace/reveal', {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path, expected_workspace_root:expected})
          });
          if (result.status !== 400) throw new Error('Unsafe Finder target was not rejected: ' + path);
          denials.push({path, status:result.status});
        }
        const projects = await (await fetch('/projects')).json();
        const matching = projects.projects.filter(project => project.cwd === root);
        if (matching.length !== 1) throw new Error('Missing-folder retry duplicated or lost the project');
        return {session:id, root, sandbox:snapshot.metadata.sandbox_status, denials, matching_projects:matching.length};
        """#, arguments: ["revealLeaf": revealLeaf], scope: scope, binding: binding) as? [String: Any]
        guard let target, let root = target["root"] as? String, canonical(root) == scope.root,
              target["sandbox"] as? String == "off" else {
            throw PreviewError.message("Created chat did not retain the selected Local workspace")
        }
        return target
    }
    private func object<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }
    private func canonical(_ path: String) -> String? {
        guard let resolved = realpath(path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }
    private func wait(_ label: String, timeout: TimeInterval = 30, expectingEngineFailure: Bool = false,
                      _ condition: () async throws -> Bool) async throws {
        let deadline = min(Date().addingTimeInterval(timeout), inputDeadline)
        while Date() < deadline {
            if !expectingEngineFailure, let failure = app.failure { throw PreviewError.message(failure) }
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }
}
#endif
