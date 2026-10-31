#if PREVIEW_SMOKE && !LOCAL_APP
import AppKit
import WebKit

/// Read-only UI observer around the public external XCTest actions. This owns
/// only fresh preview-profile fixtures, never a normal user's folders or store.
@MainActor
final class NativePathSmoke {
    private unowned let app: PreviewApp
    private let paths: NativePathBridge
    init(app: PreviewApp, paths: NativePathBridge) { self.app = app; self.paths = paths }

    func run(publish: @escaping ([String: Any]) -> Void) async throws -> [String: Any] {
        try await wait("current shared workspace and path bridge") {
            self.app.baseURL != nil && self.paths.smokeSnapshot["installed"] as? Bool == true &&
                self.app.commands.smokeSnapshot["ready"] as? Bool == true
        }
        guard let profile = app.profile else { throw PreviewError.message("Disposable path profile unavailable") }
        let folder = profile.root.appendingPathComponent("Folder with spaces 日本語")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        try Data("ALL347_REVEAL_FIXTURE\n".utf8).write(to: folder.appendingPathComponent("reveal me.txt"))
        for arguments in [["init", "--quiet", "--initial-branch=main"], ["add", "reveal me.txt"],
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
        let complete = profile.root.appendingPathComponent("all347-xctest-complete")
        publish(["paths_xctest_ready": true, "app_pid": getpid(),
                 "target_window_number": app.window.windowNumber, "initial_parent": profile.root.path,
                 "selection_path": folder.path, "engine_pid": app.engine.pid, "profile": profile.root.path])
        try await wait("external native folder/create/Finder journey", timeout: 150) {
            FileManager.default.fileExists(atPath: complete.path)
        }
        guard try String(contentsOf: complete, encoding: .utf8) == "ALL347_XCTEST_COMPLETE" else {
            throw PreviewError.message("Unexpected external path journey receipt")
        }
        let state = paths.smokeSnapshot
        guard let expectedRoot = canonical(folder.path),
              (state["cancellations"] as? Int ?? 0) >= 1,
              let selected = (state["selections"] as? [String])?.last,
              canonical(selected) == expectedRoot,
              state["pending"] as? Bool == false else {
            throw PreviewError.message("Actual native panel did not cancel/select/settle its initiating form")
        }
        let target = try await app.webView.callAsyncJavaScript(#"""
        const id = location.hash.match(/^#\/session\/([^/]+)/)?.[1];
        if (!id) throw new Error('Normal project flow did not open its first chat');
        const response = await fetch('/sessions/' + encodeURIComponent(id));
        if (!response.ok) throw new Error('Current session unavailable');
        const snapshot = await response.json();
        return {session: id, root: snapshot.metadata.workspace_host_path,
                sandbox: snapshot.metadata.sandbox_status};
        """#, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        guard let root = target?["root"] as? String, canonical(root) == expectedRoot,
              target?["sandbox"] as? String == "off" else {
            throw PreviewError.message("Created chat did not retain the selected Local workspace")
        }
        return ["native_panel": state, "created_session": target ?? [:],
                "external_xctest_receipt": complete.lastPathComponent,
                "input_driver": "public-XCTest; ASCII parent navigation and Unicode folder selection",
                "finder_assertion_owner": "external XCTest result, not this receipt"]
    }

    private func canonical(_ path: String) -> String? {
        guard let resolved = realpath(path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    private func wait(_ label: String, timeout: TimeInterval = 30,
                      _ condition: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let failure = app.failure { throw PreviewError.message(failure) }
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }
}
#endif
