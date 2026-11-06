import Foundation

/// Foundation-only component probe; never starts an app, server or WebView.
@main
struct ProfileEnvironmentProbe {
    static func main() throws {
        let profile = try PreviewProfile()
        let environment = profile.environment
        let root = profile.root
        let value = environment["NAC_ORCHESTRATION"]
        let validValue = value == "0" || value == "1"
        let privatePaths = ["HOME": "home", "NAC_HOME": "nac-home", "XDG_CONFIG_HOME": "xdg", "TMPDIR": "tmp"]
            .allSatisfy { key, child in environment[key] == root.appendingPathComponent(child).path }
        let ownStore = profile.store.deletingLastPathComponent().path == root.path
        // Remove exactly the disposable profile created by the actual class.
        try profile.remove()
        let removed = !FileManager.default.fileExists(atPath: root.path)
        #if PREVIEW_SMOKE
        let smoke = true
        #else
        let smoke = false
        #endif
        let record: [String: Any] = [
            "compiled_smoke": smoke, "orchestration_enabled": value == "1",
            "valid_orchestration_value": validValue,
            "environment_names": environment.keys.sorted(),
            "private_profile_paths": privatePaths, "store_within_profile": ownStore,
            "owned_profile_root": root.path, "profile_removed": removed,
        ]
        let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}
