import AppKit

/// Only INSTANCE_SMOKE includes this adapter. No Darwin listener belongs to T:
/// H owns wake hints and the capture actor; T only consumes exact private release
/// records. A retained request permits initial scans/rehints without edge counts.
@MainActor
final class InstanceCaptureNative {
    private let window: NSWindow
    private let files: CaptureDirectory
    private let state: InstanceCaptureProtocol
    private var activeOrdinal: Int?
    private var closed = false
    static let identifier = "nac343.capture.phase"

    static func configure(window: NSWindow, arguments: [String]) throws -> InstanceCaptureNative? {
        let names = ["--instance-capture-directory", "--instance-capture-sha256"]
        guard names.contains(where: arguments.contains) else { return nil }
        var values: [String] = []
        for name in names {
            guard arguments.filter({ $0 == name }).count == 1,
                  let index = arguments.firstIndex(of: name), index + 1 < arguments.count else {
                throw InstanceCaptureError.invalid("capture arguments")
            }
            values.append(arguments[index + 1])
        }
        return try InstanceCaptureNative(window: window, directory: values[0], digest: values[1])
    }

    private init(window: NSWindow, directory: String, digest: String) throws {
        self.window = window
        files = try CaptureDirectory(directory)
        let data = try files.read("configuration.json")!
        state = try InstanceCaptureProtocol(configuration: data, expectedDigest: digest)
        guard try capturePhysicalPath(Bundle.main.bundleURL.path) == state.configuration.context["bundle"] else {
            throw InstanceCaptureError.invalid("native bundle differs from configuration")
        }
    }

    func hold(name: String, before: [String: String], current: () throws -> [String: String]) async throws {
        let request = try state.begin(name: name, state: before)
        let ordinal = state.configuration.frames[state.index].ordinal
        activeOrdinal = ordinal
        let suffix = String(format: "%02d", ordinal)
        var released = false
        defer {
            clearPhase()
            if !released {
                try? files.writeNew("retired-" + suffix + ".json", data: captureJSON([
                    "schema": "nac343-capture-retired-v1", "ordinal": ordinal,
                    "run_nonce": state.configuration.run_nonce, "configuration_sha256": state.configurationDigest]))
                state.retire()
            }
            activeOrdinal = nil
            if closed { files.closeDirectory() }
        }
        try state.requireState(current())
        try files.writeNew("request-" + suffix + ".json", data: request)
        // Window metadata only: no text, layout, colors or new UI surface.
        window.setAccessibilityIdentifier(Self.identifier)
        window.setAccessibilityValue(try state.publicPhase())
        // Existing Python stage deadline is50s. Stay below it; no budget grows.
        let deadline = ProcessInfo.processInfo.systemUptime + 45
        while ProcessInfo.processInfo.systemUptime < deadline {
            try Task.checkCancellation()
            guard !closed else { throw InstanceCaptureError.invalid("native fixture retired") }
            try state.requireState(current())
            guard let config = try files.read("configuration.json"), captureDigest(config) == state.configurationDigest else {
                throw InstanceCaptureError.invalid("configuration changed during hold")
            }
            if try files.read("retirement.json", optional: true) != nil {
                throw InstanceCaptureError.invalid("host fixture retired")
            }
            if let release = try files.read("provisional-release-" + suffix + ".json", optional: true) {
                let fence = try state.release(release, state: current())
                // Revoke the public phase before publishing a private fence or
                // returning to a journey. No late image can match an active phase.
                clearPhase()
                try files.writeNew("fence-" + suffix + ".json", data: fence)
                try state.finishRelease()
                released = true
                return
            }
            // Bounded control-record polling, not a paint delay or notification count.
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw InstanceCaptureError.invalid("provisional release deadline exceeded")
    }

    private func clearPhase() {
        window.setAccessibilityValue(nil)
        window.setAccessibilityIdentifier(nil)
    }

    func retire() {
        guard !closed else { return }
        closed = true
        clearPhase()
        state.retire()
        if activeOrdinal == nil { files.closeDirectory() }
    }
}
