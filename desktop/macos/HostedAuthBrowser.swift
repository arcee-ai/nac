import AppKit
import Foundation

/// Read-only host observation. Never launches, configures or terminates a browser.
@main
struct HostedAuthBrowser {
    @MainActor static func main() throws {
        let workspace = NSWorkspace.shared
        guard let url = workspace.urlForApplication(toOpen: URL(string: "https://example.invalid/")!),
              let bundle = Bundle(url: url), let identifier = bundle.bundleIdentifier,
              ["com.apple.Safari", "com.google.Chrome"].contains(identifier) else {
            throw NSError(domain: "HostedAuthBrowser", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Unsupported default browser; no launch attempted"])
        }
        let browsers = workspace.runningApplications.filter {
            !$0.isTerminated && ["com.apple.Safari", "com.google.Chrome", "org.mozilla.firefox",
                                "com.microsoft.edgemac", "com.google.Chrome.forTesting"].contains($0.bundleIdentifier ?? "")
        }.map { ["bundle": $0.bundleIdentifier ?? "", "pid": $0.processIdentifier] as [String: Any] }
        let value: [String: Any] = ["browser": url.resolvingSymlinksInPath().path,
            "identifier": identifier, "running_browsers": browsers,
            "os_major": ProcessInfo.processInfo.operatingSystemVersion.majorVersion]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
        FileHandle.standardOutput.write(Data([10]))
    }
}
