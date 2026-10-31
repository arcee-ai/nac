import Foundation

@main
enum DesktopStartupTests {
    static func main() async throws {
        let executable = URL(fileURLWithPath: CommandLine.arguments[1])
        let identityTask = Process()
        let identityOutput = Pipe()
        identityTask.executableURL = executable
        identityTask.arguments = ["__desktop-identity"]
        identityTask.standardOutput = identityOutput
        try identityTask.run()
        let identityData = identityOutput.fileHandleForReading.readDataToEndOfFile()
        identityTask.waitUntilExit()
        let identity = try JSONDecoder().decode(EngineIdentity.self, from: identityData)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nac startup tests \(UUID().uuidString)")
        let home = root.appendingPathComponent("home with spaces")
        let nac = home.appendingPathComponent("custom nac")
        try FileManager.default.createDirectory(at: nac, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let config = nac.appendingPathComponent("config.toml")
        try Data("[storage]\nstore_path = 'selected store.db'\n".utf8).write(to: config)
        let options = try DesktopStartup.Options(arguments: ["--directory", home.path, "--command-path", "custom tools"])
        let inherited = ["HOME": home.path, "NAC_HOME": "custom nac", "NAC_ORCHESTRATION": "true"]
        let finder = try await DesktopStartup.select(executable: executable, identity: identity, options: options, inherited: inherited)
        let terminal = try await DesktopStartup.select(executable: executable, identity: identity, options: options,
            inherited: inherited.merging(["PATH": "/custom tools:/usr/bin:/bin"]) { _, new in new })
        precondition(finder.cwd == terminal.cwd && finder.store == terminal.store)
        precondition(finder.store.lastPathComponent == "selected store.db")
        precondition(finder.environment["NAC_ORCHESTRATION"] == "true")
        precondition(!FileManager.default.fileExists(atPath: finder.store.path))
        try Data("[storage]\nstore_path = [ private-canary\n".utf8).write(to: config)
        do {
            _ = try await DesktopStartup.select(executable: executable, identity: identity, options: options, inherited: inherited)
            preconditionFailure("Invalid config was accepted")
        } catch {
            precondition(error.localizedDescription.contains("config.toml"))
            precondition(!error.localizedDescription.contains("private-canary"))
        }
        for arguments in [["--directory"], ["--directory", home.path, "--directory", home.path], ["--unknown", "private-canary"]] {
            do { _ = try DesktopStartup.Options(arguments: arguments); preconditionFailure("Invalid arguments accepted") }
            catch { precondition(!error.localizedDescription.contains("private-canary")) }
        }
        print("Native startup selection contracts passed (AppKit acceptance is separate).")
    }
}
