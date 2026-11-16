import Foundation

@main
enum CommandEnvironmentTests {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nac command paths \(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let commands = root.appendingPathComponent("custom tools")
        try FileManager.default.createDirectory(at: commands, withIntermediateDirectories: false)
        let fixture = commands.appendingPathComponent("fixture-mcp")
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: fixture)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: fixture.path)
        let inherited = ["HOME": root.path, "NAC_HOME": "relative nac", "NAC_ORCHESTRATION": "01",
                         "PATH": "custom tools:/usr/bin:/bin", "FIXTURE_SECRET": "memory-only-canary"]
        let resolved = try CommandEnvironment.resolve(inherited, cwd: root)
        precondition(CommandEnvironment.executable("fixture-mcp", in: resolved) == fixture)
        precondition(resolved["HOME"] == inherited["HOME"] && resolved["NAC_HOME"] == "relative nac")
        precondition(resolved["NAC_ORCHESTRATION"] == "01")
        precondition(resolved["FIXTURE_SECRET"] == inherited["FIXTURE_SECRET"])
        precondition(CommandEnvironment.executable("missing-fixture-mcp", in: resolved) == nil)
        let finder = try CommandEnvironment.resolve(["HOME": root.path], cwd: root)
        precondition(finder["PATH"] == CommandEnvironment.systemPath + ":" + CommandEnvironment.additions.joined(separator: ":"))
        let explicit = try CommandEnvironment.resolve(["PATH": "/bin"], cwd: root, extraPaths: [commands.path])
        precondition(explicit["PATH"]!.hasPrefix(commands.path + ":/bin:"))
        for path in [String(repeating: "x", count: 32769), String(repeating: ":", count: 256), "bad\0path"] {
            do { _ = try CommandEnvironment.resolve(["PATH": path], cwd: root); preconditionFailure("invalid PATH accepted") }
            catch is CommandEnvironmentError {}
        }
        print("Command environment contracts passed (no shell executed).")
    }
}
