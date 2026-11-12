import Foundation
import Darwin

@main
struct CommandInputDriverTests {
    static func main() throws {
        typealias Driver = CommandInputDriver
        let identity = Driver.Identity(source: String(repeating: "a", count: 40),
                                       native: String(repeating: "b", count: 64),
                                       engine: String(repeating: "c", count: 64))
        let episode = UUID().uuidString
        func row(_ index: Int) -> [String: Any] {
            ["version": 1, "episode": episode, "pid": 123, "window": 456,
             "launch": "launch", "view": "view", "document": "document",
             "source": identity.source, "native_sha256": identity.native,
             "engine_sha256": identity.engine, "sequence": index + 1,
             "phase": Driver.phases[index], "verified_phases": Array(Driver.phases.prefix(index)),
             "kind": "ready"]
        }
        func rejects(_ value: [String: Any], at index: Int) {
            do {
                _ = try Driver.validate(value, index: index, expected: identity)
                preconditionFailure("Unsafe external command phase accepted")
            } catch {}
        }
        let first = try Driver.validate(row(0), index: 0, expected: identity)
        precondition(first.pid == 123 && first.window == 456 && first.episode == episode)
        for index in Driver.phases.indices {
            let actual = try Driver.validate(row(index), index: index, expected: identity)
            precondition(actual == first)
        }
        for (key, bad) in [("version", true as Any), ("sequence", 2),
                           ("phase", "copy"), ("source", "different"),
                           ("native_sha256", "different"), ("engine_sha256", "different"),
                           ("pid", 0), ("window", 0), ("kind", "settled"),
                           ("verified_phases", ["type-fixture"])] {
            var changed = row(0)
            changed[key] = bad
            rejects(changed, at: 0)
        }
        var extra = row(0)
        extra["command"] = "unbounded"
        rejects(extra, at: 0)
        var missing = row(0)
        missing.removeValue(forKey: "episode")
        rejects(missing, at: 0)
        var wrongPrevious = row(1)
        wrongPrevious["verified_phases"] = []
        rejects(wrongPrevious, at: 1)

        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nac-command-driver-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        let descriptor = open(root.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        precondition(descriptor >= 0)
        defer { close(descriptor) }
        try Driver.write(descriptor, name: "commands-input-phase.json", value: row(0))
        let read = try Driver.read(descriptor, name: "commands-input-phase.json")
        precondition(read?["phase"] as? String == "type-fixture")
        try FileManager.default.removeItem(at: root.appendingPathComponent("commands-input-phase.json"))
        let sentinel = root.appendingPathComponent("sentinel")
        try Data("untouched".utf8).write(to: sentinel)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("commands-input-phase.json"),
                                                    withDestinationURL: sentinel)
        do {
            _ = try Driver.read(descriptor, name: "commands-input-phase.json")
            preconditionFailure("Symlink phase accepted")
        } catch {}
        let preserved = try Data(contentsOf: sentinel)
        precondition(preserved == Data("untouched".utf8))
        print("External command phase identity, ordering, bounds and no-follow controls passed; no OS event was posted")
    }
}
