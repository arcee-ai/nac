import Darwin
import Foundation

/// Supervises only the bundled child; readiness is taken from its private pipe.
/// This deliberately does not introduce the future versioned engine protocol.
final class PreviewEngine {
    private(set) var pid: pid_t = 0
    private var output: DispatchSourceRead?
    private var exitSource: DispatchSourceProcess?
    private var pending = Data()
    private(set) var log = ""
    private var stopCompletion: (() -> Void)?
    var onReady: ((URL) -> Void)?
    var onExit: ((Int32) -> Void)?
    private var reportedReady = false

    func launch(executable: URL, profile: PreviewProfile, provider: FixtureProvider) throws {
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw PreviewError.message("Bundled nac-web is missing or not executable. Rebuild the preview app.")
        }
        var descriptors: [Int32] = [0, 0]
        guard pipe(&descriptors) == 0 else { throw posixError("create child pipe") }
        let readFD = descriptors[0], writeFD = descriptors[1]
        guard fcntl(readFD, F_SETFL, O_NONBLOCK) == 0 else {
            close(readFD); close(writeFD)
            throw posixError("configure child pipe")
        }
        var actions: posix_spawn_file_actions_t?
        var attributes: posix_spawnattr_t?
        posix_spawn_file_actions_init(&actions)
        posix_spawnattr_init(&attributes)
        defer {
            posix_spawn_file_actions_destroy(&actions)
            posix_spawnattr_destroy(&attributes)
            close(writeFD)
        }
        posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_adddup2(&actions, writeFD, STDOUT_FILENO)
        posix_spawn_file_actions_adddup2(&actions, writeFD, STDERR_FILENO)
        posix_spawn_file_actions_addclose(&actions, readFD)
        posix_spawn_file_actions_addclose(&actions, writeFD)
        posix_spawn_file_actions_addchdir_np(&actions, profile.workspace.path)
        posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT))
        posix_spawnattr_setpgroup(&attributes, 0)
        var environment = profile.environment
        environment["MODELS_DEV_URL"] = provider.baseURL.appendingPathComponent("models-dev").absoluteString
        let arguments = [executable.path, "--bind", "127.0.0.1:0", "--directory", profile.workspace.path,
                         "--store-path", profile.store.path, "--worker-executable", executable.path, "--no-open"]
        let argv = arguments.map { strdup($0) } + [nil]
        let envp = environment.sorted(by: { $0.key < $1.key }).map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { argv.forEach { free($0) }; envp.forEach { free($0) } }
        let error = argv.withUnsafeBufferPointer { args in
            envp.withUnsafeBufferPointer { env in
                posix_spawn(&pid, executable.path, &actions, &attributes,
                            UnsafeMutablePointer(mutating: args.baseAddress!),
                            UnsafeMutablePointer(mutating: env.baseAddress!))
            }
        }
        guard error == 0 else { close(readFD); pid = 0; throw posixError("launch bundled nac-web", error) }
        let output = DispatchSource.makeReadSource(fileDescriptor: readFD, queue: .main)
        output.setEventHandler { [weak self] in self?.readOutput(readFD) }
        output.setCancelHandler { close(readFD) }
        self.output = output
        output.resume()
        let exitSource = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
        exitSource.setEventHandler { [weak self] in
            guard let self else { return }
            if self.output != nil { self.readOutput(readFD) }
            // The unreaped leader still reserves this process-group identity.
            // Kill any remaining fixture descendants before releasing that identity.
            kill(-self.pid, SIGKILL)
            var status: Int32 = 0
            waitpid(self.pid, &status, 0)
            self.pid = 0
            self.output?.cancel()
            self.exitSource?.cancel()
            if let completion = self.stopCompletion {
                self.stopCompletion = nil
                completion()
            } else { self.onExit?(status) }
        }
        self.exitSource = exitSource
        exitSource.resume()
    }

    func stop(completion: @escaping () -> Void) {
        guard pid > 0 else { DispatchQueue.main.async(execute: completion); return }
        stopCompletion = completion
        kill(-pid, SIGTERM)
        // The server's complete graceful-shutdown watchdog is 20 seconds.
        DispatchQueue.main.asyncAfter(deadline: .now() + 23) { [weak self] in
            guard let self, self.pid > 0 else { return }
            kill(-self.pid, SIGKILL)
        }
    }

    private func readOutput(_ fd: Int32) {
        var bytes = [UInt8](repeating: 0, count: 8192)
        while true {
            let count = read(fd, &bytes, bytes.count)
            if count == 0 { output?.cancel(); output = nil }
            guard count > 0 else { break }
            pending.append(contentsOf: bytes[..<count])
            log += String(decoding: bytes[..<count], as: UTF8.self)
            if log.utf8.count > 65536 { log = String(log.suffix(32768)) }
            // Bound even malformed/unterminated diagnostic output.
            if pending.count > 65536 { pending.removeAll() }
            while let newline = pending.firstIndex(of: 10) {
                let line = String(decoding: pending[..<newline], as: UTF8.self)
                pending.removeSubrange(...newline)
                let prefix = "nac-web listening on "
                guard !reportedReady, line.hasPrefix(prefix),
                      let url = URL(string: String(line.dropFirst(prefix.count))),
                      url.scheme == "http", url.host == "127.0.0.1", let port = url.port,
                      port > 0, url.user == nil, url.password == nil,
                      ["", "/"].contains(url.path), url.query == nil, url.fragment == nil else { continue }
                reportedReady = true
                onReady?(url)
            }
        }
    }

    private func posixError(_ action: String, _ code: Int32 = errno) -> Error {
        PreviewError.message("Could not \(action): \(String(cString: strerror(code)))")
    }
}
