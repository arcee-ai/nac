import Foundation

/// Disposable test data only. Never resolves the user's NAC configuration.
final class PreviewProfile {
    let root: URL
    var workspace: URL { root.appendingPathComponent("workspace") }
    var store: URL { root.appendingPathComponent("store.db") }
    var environment: [String: String] {
        ["HOME": root.appendingPathComponent("home").path,
         "NAC_HOME": root.appendingPathComponent("nac-home").path,
         "XDG_CONFIG_HOME": root.appendingPathComponent("xdg").path,
         "TMPDIR": root.appendingPathComponent("tmp").path,
         "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8",
         "BROWSER": "none", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
         "NAC_TELEMETRY": "disabled", "NAC_ORCHESTRATION": "0"]
    }

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("nac-mac-preview-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        do {
            for name in ["home", "nac-home", "xdg", "tmp", "workspace"] {
                try FileManager.default.createDirectory(at: root.appendingPathComponent(name),
                    withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            }
            // Bound snapshots to the fixture rather than any enclosing source checkout.
            try git(["init", "--quiet", "--initial-branch=main"])
            try git(["-c", "user.name=NAC disposable preview",
                     "-c", "user.email=preview@example.test", "-c", "commit.gpgsign=false",
                     "commit", "--quiet", "--allow-empty", "-m", "fixture baseline"])
        } catch {
            try? remove()
            throw error
        }
    }

    private func git(_ arguments: [String]) throws {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        task.arguments = ["-C", workspace.path] + arguments
        task.environment = environment
        task.standardInput = FileHandle.nullDevice
        try task.run()
        task.waitUntilExit()
        guard task.terminationStatus == 0 else { throw PreviewError.message("Fixture Git setup failed") }
    }

    func remove() throws { try FileManager.default.removeItem(at: root) }
}
