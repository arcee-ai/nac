import Foundation

/// Actual Foundation-to-Rust preflight only: no app, browser or serving lease.
@main
enum NativeAuthStartupTests {
    static func main() async throws {
        let args = CommandLine.arguments
        precondition(args.count == 4)
        let executable = URL(fileURLWithPath: args[1])
        let task = Process(), output = Pipe()
        task.executableURL = executable
        task.arguments = ["__desktop-identity"]
        task.standardOutput = output
        try task.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        precondition(task.terminationStatus == 0)
        let identity = try JSONDecoder().decode(EngineIdentity.self, from: data)
        precondition(identity.matchesShellBuild && identity.isNativeAuthFixture)
        let selected = try await DesktopStartup.select(executable: executable, identity: identity,
            options: try DesktopStartup.Options(arguments: ["--directory", args[2], "--store-path", args[3]]),
            inherited: ProcessInfo.processInfo.environment)
        precondition(selected.cwd.path == args[2] && selected.store.path == args[3])
        print("Exact fixture Foundation/Rust startup selection passed; no serving launch.")
    }
}
