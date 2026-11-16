import Foundation
import WebKit
import CryptoKit
import Darwin

/// Non-GUI owner characterization. Each phase is a fresh bounded process; the
/// external case controller owns the unique root and always runs typed cleanup.
@main
enum WorkspaceStorageRecoveryTests {
    @MainActor
    static func main() async {
        do {
            guard CommandLine.arguments.count == 4 else { throw failed("arguments") }
            let phase = CommandLine.arguments[1]
            let root = URL(fileURLWithPath: CommandLine.arguments[2]).resolvingSymlinksInPath()
            let output = URL(fileURLWithPath: CommandLine.arguments[3])
            guard root.lastPathComponent.hasPrefix("nac-all349-a0-"), getuid() != 0 else { throw failed("isolation") }
            guard ["fault", "same-fault", "restored", "cleanup"].contains(phase),
                  output.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL,
                  output.lastPathComponent == "\(phase).json" else { throw failed("output") }
            var rootStatus = stat()
            guard lstat(root.path, &rootStatus) == 0, rootStatus.st_uid == getuid(),
                  rootStatus.st_mode & S_IFMT == S_IFDIR,
                  rootStatus.st_mode & 0o077 == 0 else { throw failed("owned-root") }
            let home = root.appendingPathComponent("home")
            if phase == "fault" {
                try FileManager.default.createDirectory(at: home, withIntermediateDirectories: false,
                    attributes: [.posixPermissions: 0o700])
            }
            let configuration = EngineLaunchConfiguration(cwd: home, store: home.appendingPathComponent("fixture.db"),
                environment: ["HOME": home.path])
            let receipt = EngineReceipt(kind: "ready", version: 1, incarnation: UUID().uuidString,
                endpoint: "http://127.0.0.1:41001", identity: EngineIdentity(product_version: "owner-fixture",
                    build_id: "owner-fixture", source_revision: "owner-fixture", track: "dev"),
                store: configuration.store.path, schema: 1, stage: nil, code: nil, message: nil)
            guard let profile = WorkspaceStorageProfile(receipt: receipt, configuration: configuration) else { throw failed("profile") }
            let directory = profile.home.appendingPathComponent("Library/Application Support/NAC/Presentation/dev/\(profile.digest)")
            let checkpoint = directory.appendingPathComponent("checkpoint.json")
            var facts: [String: Any] = ["phase": phase, "pid": getpid(), "uid": getuid(),
                "profile": profile.digest, "websiteStore": profile.identifier.uuidString,
                "root": root.path, "directory": directory.path]
            if phase == "cleanup" {
                // Standalone cleanup has not constructed WorkspaceStorage. Set
                // up WebKit through an ephemeral object before its static API.
                let initialization = WKWebsiteDataStore.nonPersistent()
                let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if fd >= 0 {
                    defer { close(fd) }
                    var status = stat()
                    guard fstat(fd, &status) == 0, status.st_uid == getuid() else { throw failed("cleanup-owner") }
                    guard fchmod(fd, 0o700) == 0 else { throw failed("cleanup-mode") }
                    facts["modeRestored"] = true
                } else if errno != ENOENT { throw failed("cleanup-directory") }
                do {
                    try await WKWebsiteDataStore.remove(forIdentifier: profile.identifier)
                    facts["websiteStoreRemoved"] = true
                } catch {
                    facts["websiteStoreRemoved"] = false
                    facts["cleanupError"] = "owned website store removal failed"
                }
                facts["nonpersistentInitializationRetained"] = !initialization.isPersistent
                try emit(facts, to: output)
                return
            }
            if phase == "restored" {
                let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard fd >= 0 else { throw failed("restore-open") }
                defer { close(fd) }
                var status = stat()
                guard fstat(fd, &status) == 0, status.st_uid == getuid(), fchmod(fd, 0o700) == 0 else { throw failed("restore-mode") }
            }
            guard let storage = await WorkspaceStorage.open(receipt: receipt, configuration: configuration) else { throw failed("open-storage") }
            if phase == "fault" {
                let fields = ["owner", "profile", "organization", "host", "store", "track"]
                let draft: [String: Any] = ["version": 2, "binding": fields.map { profile.binding[$0]! },
                    "drafts": [["session", "already-accepted-or-cleared-A"]]]
                let raw = String(decoding: try JSONSerialization.data(withJSONObject: draft, options: [.withoutEscapingSlashes]), as: UTF8.self)
                let seeded: Bool = await withCheckedContinuation { continuation in
                    let admitted = storage.write(namespace: "drafts", key: profile.draftKey, value: raw) {
                        continuation.resume(returning: $0)
                    }
                    if !admitted { continuation.resume(returning: false) }
                }
                guard seeded else { throw failed("seed-write") }
                let before = try Data(contentsOf: checkpoint)
                facts["seedSHA256"] = digest(before)
                facts["seedBytes"] = before.count
                let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard fd >= 0 else { throw failed("fault-directory") }
                defer { close(fd) }
                var status = stat()
                guard fstat(fd, &status) == 0, status.st_uid == getuid(), status.st_mode & 0o777 == 0o700 else { throw failed("fault-owner-mode") }
                facts["directoryDevice"] = status.st_dev
                facts["directoryInode"] = status.st_ino
                try emit(facts.merging(["faultAboutToApply": true]) { _, new in new }, to: output)
                guard fchmod(fd, 0o500) == 0 else { throw failed("fault-mode") }
                let durable: Bool = await withCheckedContinuation { continuation in
                    let admitted = storage.write(namespace: "drafts", key: profile.draftKey, value: nil) {
                        continuation.resume(returning: $0)
                    }
                    if !admitted { continuation.resume(returning: false) }
                }
                facts["productionClearDurable"] = durable
                facts["faultApplied"] = true
                facts["snapshot"] = await storage.snapshot()
                // These are explicitly separate diagnostic calls under identical
                // unchanged uid/mode. Baseline production exports Bool, not errno.
                let probe = openat(fd, ".owned-permission-probe", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
                facts["diagnosticOpenatResult"] = probe
                facts["diagnosticOpenatErrno"] = probe < 0 ? errno : 0
                if probe >= 0 { close(probe); unlinkat(fd, ".owned-permission-probe", 0) }
                let deletion = unlinkat(fd, "checkpoint.json", 0)
                facts["diagnosticUnlinkatResult"] = deletion
                facts["diagnosticUnlinkatErrno"] = deletion < 0 ? errno : 0
                let after = try Data(contentsOf: checkpoint)
                facts["retainedSHA256"] = digest(after)
                facts["oldBytesRetained"] = before == after
                facts["renameObservation"] = "not reached: temp creation denied; no production-thread errno export"
            } else {
                guard phase == "same-fault" || phase == "restored" else { throw failed("phase") }
                facts["snapshot"] = await storage.snapshot()
                facts["retainedSHA256"] = digest(try Data(contentsOf: checkpoint))
            }
            facts["binding"] = profile.binding
            facts["draftKey"] = profile.draftKey
            facts["completed"] = true
            try emit(facts, to: output)
        } catch {
            fputs("Workspace storage owner fixture failed: \(error.localizedDescription)\n", stderr)
            exit(2)
        }
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    private static func emit(_ facts: [String: Any], to output: URL) throws {
        try JSONSerialization.data(withJSONObject: facts, options: [.prettyPrinted, .sortedKeys]).write(to: output, options: .atomic)
    }
    private static func failed(_ stage: String) -> Error {
        NSError(domain: "NACStorageOwnerFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Unavailable owner fixture stage: \(stage)"])
    }
}
