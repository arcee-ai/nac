import Foundation

/// Composes command lookup without executing a shell or reading dotfiles.
/// Values live only in the child environment; no preferences persist secrets.
enum CommandEnvironment {
    static let systemPath = "/usr/bin:/bin:/usr/sbin:/sbin"
    static let additions = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"]
    #if PREVIEW_SMOKE
    // Model a machine without package-manager installations using only this
    // disposable app's command directories. Never changes system paths.
    static var isolatedFixturePaths = false
    #endif

    static func resolve(_ inherited: [String: String], cwd: URL, extraPaths: [String] = []) throws -> [String: String] {
        let path = inherited["PATH"] ?? systemPath
        guard path.utf8.count <= 32768, extraPaths.count <= 32 else { throw invalidPath() }
        let original = path.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard original.count <= 256 else { throw invalidPath() }
        var seen = Set<String>()
        var entries: [String] = []
        // Explicit app arguments win, then the launch environment, then known
        // package-manager locations. Never substitute a different backend.
        var automatic = additions
        #if PREVIEW_SMOKE
        if isolatedFixturePaths { automatic = [] }
        #endif
        for entry in extraPaths + original + automatic {
            guard !entry.contains("\0"), !entry.contains(":"), entry.utf8.count <= 4096 else { throw invalidPath() }
            let absolute = entry.hasPrefix("/") ? entry : cwd.appendingPathComponent(entry).path
            if seen.insert(absolute).inserted { entries.append(absolute) }
        }
        var environment = inherited
        environment["PATH"] = entries.joined(separator: ":")
        return environment
    }

    static func executable(_ name: String, in environment: [String: String]) -> URL? {
        guard !name.isEmpty, !name.contains("/") else { return nil }
        for directory in (environment["PATH"] ?? "").split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent(name)
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory),
               !isDirectory.boolValue, FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate }
        }
        return nil
    }

    private static func invalidPath() -> Error {
        CommandEnvironmentError.invalidPath
    }
}

enum CommandEnvironmentError: LocalizedError {
    case invalidPath
    var errorDescription: String? {
        "Command search paths are invalid or too large. Use a bounded PATH or pass --command-path with one directory per argument, then relaunch NAC."
    }
}
