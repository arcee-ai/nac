import Foundation

struct EngineLaunchConfiguration {
    let cwd: URL
    let store: URL
    let environment: [String: String]
}

/// Native launch choices. Rust owns config parsing, track/store selection,
/// credentials, backends and the shared settings/onboarding workflows.
enum DesktopStartup {
    struct Options {
        var directory: String?
        var store: String?
        var commandPaths: [String] = []

        init(arguments: [String]) throws {
            guard arguments.count <= 96 else { throw DesktopStartup.invalidArguments() }
            var index = 0
            while index < arguments.count {
                let name = arguments[index]
                if name.hasPrefix("-psn_") { index += 1; continue }
                guard index + 1 < arguments.count, arguments[index + 1].utf8.count <= 4096 else { throw DesktopStartup.invalidArguments() }
                let value = arguments[index + 1]
                switch name {
                case "--directory":
                    guard directory == nil else { throw DesktopStartup.invalidArguments() }
                    directory = value
                case "--store-path":
                    guard store == nil else { throw DesktopStartup.invalidArguments() }
                    store = value
                case "--command-path": commandPaths.append(value)
                default: throw DesktopStartup.invalidArguments()
                }
                index += 2
            }
        }
    }

    private struct Selection: Decodable {
        let version: Int
        let status: String
        let root_cwd: String?
        let store: String?
        let track: String?
        let code: String?
    }

    static func select(executable: URL, identity: EngineIdentity, options: Options,
                       inherited: [String: String]) async throws -> EngineLaunchConfiguration {
        let home = inherited["HOME"] ?? NSHomeDirectory()
        guard home.hasPrefix("/") || options.directory?.hasPrefix("/") == true else {
            throw DesktopStartupError.message("HOME is not an absolute directory. Pass --directory with an existing absolute path and relaunch NAC.")
        }
        let directory = options.directory ?? home
        let cwd = URL(fileURLWithPath: directory.hasPrefix("/") ? directory :
            URL(fileURLWithPath: home).appendingPathComponent(directory).path).resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: cwd.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw DesktopStartupError.message("The bootstrap directory is unavailable. Pass --directory with an existing directory and relaunch NAC.")
        }
        let environment = try CommandEnvironment.resolve(inherited, cwd: cwd, extraPaths: options.commandPaths)
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw DesktopStartupError.message("The bundled NAC engine is missing or not executable. Replace the complete app bundle and relaunch.")
        }
        let selection: Selection = try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let task = Process()
                    let output = Pipe()
                    task.executableURL = executable
                    task.currentDirectoryURL = cwd
                    task.environment = environment
                    task.arguments = ["__desktop-configuration", "--directory", cwd.path]
                    if let store = options.store { task.arguments! += ["--store-path", store] }
                    task.standardInput = FileHandle.nullDevice
                    task.standardOutput = output
                    task.standardError = FileHandle.nullDevice
                    try task.run()
                    var data = Data()
                    while let bytes = try output.fileHandleForReading.read(upToCount: 4096), !bytes.isEmpty {
                        data.append(bytes)
                        if data.count > 16384 { break }
                    }
                    try? output.fileHandleForReading.close()
                    // Rust bounds config waits to ten seconds and self-exits
                    // after parent loss. No shell or command tool is executed.
                    task.waitUntilExit()
                    guard task.terminationStatus == 0, data.count <= 16384 else {
                        throw DesktopStartupError.message("Configuration discovery failed or exceeded ten seconds. Finish any NAC configuration edit in another process, check directory access, then relaunch. Discovery did not open the selected store.")
                    }
                    continuation.resume(returning: try JSONDecoder().decode(Selection.self, from: data))
                } catch { continuation.resume(throwing: error) }
            }
        }
        try Task.checkCancellation()
        guard selection.version == 1 else { throw invalidSelection() }
        if selection.status == "failed" {
            // Never display arbitrary helper bytes, TOML diagnostics or values.
            switch selection.code {
            case "invalid_configuration":
                throw DesktopStartupError.message("NAC could not read its selected config.toml. Check NAC_HOME, XDG_CONFIG_HOME or HOME, repair the configuration and any pending MCP publication, then relaunch. Discovery did not open the selected store.")
            case "managed_configuration":
                throw DesktopStartupError.message("The local Mac app cannot launch a managed host. Remove NAC_MANAGED_CONFIG from this app's launch environment and relaunch; use the managed-host entry point for managed deployments.")
            case "bootstrap_directory":
                throw DesktopStartupError.message("The bootstrap directory is unavailable or inconsistent. Pass --directory with an existing absolute directory and relaunch NAC.")
            default: throw invalidSelection()
            }
        }
        guard selection.status == "selected", selection.track == identity.track,
              let root = selection.root_cwd, root.hasPrefix("/"),
              let store = selection.store, store.hasPrefix("/") else { throw invalidSelection() }
        return EngineLaunchConfiguration(cwd: URL(fileURLWithPath: root), store: URL(fileURLWithPath: store), environment: environment)
    }

    private static func invalidArguments() -> Error {
        DesktopStartupError.message("Unsupported app launch arguments. Use --directory, --store-path and repeated --command-path directory arguments, then relaunch NAC.")
    }
    private static func invalidSelection() -> Error {
        DesktopStartupError.message("The bundled engine returned invalid configuration identity. Replace the complete app bundle and relaunch NAC.")
    }
}

enum DesktopStartupError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
