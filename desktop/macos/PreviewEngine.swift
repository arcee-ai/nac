import Darwin
import Foundation

/// Each run owns all descriptors, sources, timers and its reserved process group.
/// A callback from a previous run cannot signal or publish a successor.
final class PreviewEngine {
    #if PREVIEW_SMOKE
    var holdHello = false
    #endif
    private var run: EngineRun?
    var pid: pid_t { run?.pid ?? 0 }
    var log: String { run?.log ?? "" }
    var receipt: EngineReceipt? { run?.protocolState.ready }
    var onReady: ((URL) -> Void)?
    var onExit: ((Int32) -> Void)?
    var onFailure: ((String) -> Void)?

    func launch(executable: URL, profile: PreviewProfile, provider: FixtureProvider) throws {
        guard run == nil || run?.pid == 0 else { throw PreviewError.message("The previous engine is still stopping.") }
        let identityURL = executable.deletingLastPathComponent().appendingPathComponent("engine-identity.json")
        let identity = try JSONDecoder().decode(EngineIdentity.self, from: Data(contentsOf: identityURL))
        let next = EngineRun(identity: identity, profile: profile)
        #if PREVIEW_SMOKE
        next.holdHello = holdHello
        #endif
        run = next
        next.onReady = { [weak self, weak next] url in
            guard let self, self.run === next else { return }
            self.onReady?(url)
        }
        next.onExit = { [weak self, weak next] status in
            guard let self, self.run === next else { return }
            self.onExit?(status)
        }
        next.onFailure = { [weak self, weak next] message in
            guard let self, self.run === next else { return }
            self.onFailure?(message)
        }
        try next.launch(executable: executable, profile: profile, provider: provider)
    }

    func stop(completion: @escaping () -> Void) {
        guard let run else { DispatchQueue.main.async(execute: completion); return }
        run.stop(completion: completion)
    }

    #if PREVIEW_SMOKE
    func loseChannel() { run?.loseChannel() }
    #endif
}

private final class EngineRun {
    #if PREVIEW_SMOKE
    var holdHello = false
    #endif
    private(set) var pid: pid_t = 0
    let protocolState: EngineProtocol
    private(set) var log = ""
    private var output: DispatchSourceRead?
    private var channel: DispatchSourceRead?
    private var exitSource: DispatchSourceProcess?
    private var channelFD: Int32 = -1
    private var stopCompletions: [() -> Void] = []
    private var stopping = false
    private var failed = false
    var onReady: ((URL) -> Void)?
    var onExit: ((Int32) -> Void)?
    var onFailure: ((String) -> Void)?

    init(identity: EngineIdentity, profile: PreviewProfile) {
        protocolState = EngineProtocol(identity: identity, store: profile.store)
    }

    func launch(executable: URL, profile: PreviewProfile, provider: FixtureProvider) throws {
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw PreviewError.message("Bundled nac-web is missing or not executable. Rebuild the preview app.")
        }
        var logs: [Int32] = [0, 0], sockets: [Int32] = [0, 0]
        guard pipe(&logs) == 0 else { throw posixError("create diagnostic pipe") }
        guard socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0 else {
            close(logs[0]); close(logs[1]); throw posixError("create launch channel")
        }
        var spawned = false
        defer {
            close(logs[1]); close(sockets[1])
            if !spawned { close(logs[0]); close(sockets[0]) }
        }
        for fd in logs + sockets {
            guard fcntl(fd, F_SETFD, FD_CLOEXEC) == 0 else { throw posixError("protect descriptor inheritance") }
        }
        for fd in [logs[0], sockets[0]] {
            guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else { throw posixError("configure asynchronous descriptor") }
        }
        var noSignal: Int32 = 1
        guard setsockopt(sockets[0], SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0 else {
            throw posixError("configure launch channel")
        }
        var actions: posix_spawn_file_actions_t?
        var attributes: posix_spawnattr_t?
        posix_spawn_file_actions_init(&actions)
        posix_spawnattr_init(&attributes)
        defer { posix_spawn_file_actions_destroy(&actions); posix_spawnattr_destroy(&attributes) }
        posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_adddup2(&actions, logs[1], STDOUT_FILENO)
        posix_spawn_file_actions_adddup2(&actions, logs[1], STDERR_FILENO)
        for fd in logs + [sockets[0]] { posix_spawn_file_actions_addclose(&actions, fd) }
        posix_spawn_file_actions_adddup2(&actions, sockets[1], 3)
        if sockets[1] != 3 { posix_spawn_file_actions_addclose(&actions, sockets[1]) }
        posix_spawn_file_actions_addchdir_np(&actions, profile.workspace.path)
        posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT))
        posix_spawnattr_setpgroup(&attributes, 0)
        var environment = profile.environment
        environment["NAC_DESKTOP_CHANNEL_FD"] = "3"
        environment["MODELS_DEV_URL"] = provider.baseURL.appendingPathComponent("models-dev").absoluteString
        let arguments = [executable.path, "--bind", "127.0.0.1:0", "--directory", profile.workspace.path,
                         "--store-path", profile.store.path, "--worker-executable", executable.path, "--no-open"]
        let argv = arguments.map { strdup($0) } + [nil]
        let envp = environment.sorted(by: { $0.key < $1.key }).map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { argv.forEach { free($0) }; envp.forEach { free($0) } }
        let error = argv.withUnsafeBufferPointer { args in
            envp.withUnsafeBufferPointer { env in
                posix_spawn(&pid, executable.path, &actions, &attributes,
                            UnsafeMutablePointer(mutating: args.baseAddress!), UnsafeMutablePointer(mutating: env.baseAddress!))
            }
        }
        guard error == 0 else { pid = 0; throw posixError("launch bundled nac-web", error) }
        spawned = true
        channelFD = sockets[0]
        output = source(logs[0], protocolInput: false)
        channel = source(sockets[0], protocolInput: true)
        let exitSource = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
        exitSource.setEventHandler { [self] in
            if output != nil { readAvailable(logs[0], protocolInput: false) }
            if channel != nil { readAvailable(sockets[0], protocolInput: true) }
            // The unreaped leader still reserves this group identity.
            kill(-pid, SIGKILL)
            var status: Int32 = 0
            waitpid(pid, &status, 0)
            pid = 0
            channelFD = -1
            output?.cancel(); output = nil
            channel?.cancel(); channel = nil
            self.exitSource?.cancel(); self.exitSource = nil
            let completions = stopCompletions
            stopCompletions.removeAll()
            if !completions.isEmpty { completions.forEach { $0() } }
            else { onExit?(status) }
        }
        self.exitSource = exitSource
        exitSource.resume()
        do {
            #if PREVIEW_SMOKE
            if !holdHello { try send(protocolState.hello()) }
            #else
            try send(protocolState.hello())
            #endif
        }
        catch { fail("Could not send the bundled engine launch request.") }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.pid > 0, !self.stopping, self.protocolState.ready == nil else { return }
            self.fail("The bundled engine did not become ready within 30 seconds.")
        }
    }

    private func source(_ fd: Int32, protocolInput: Bool) -> DispatchSourceRead {
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        source.setEventHandler { [weak self] in self?.readAvailable(fd, protocolInput: protocolInput) }
        source.setCancelHandler { close(fd) }
        source.resume()
        return source
    }

    func stop(completion: @escaping () -> Void) {
        guard pid > 0 else { DispatchQueue.main.async(execute: completion); return }
        stopCompletions.append(completion)
        guard !stopping else { return }
        stopping = true
        do { try send(protocolState.stop()) }
        catch {
            // EOF is the engine's startup/runtime shutdown request. SIGTERM
            // could arrive before the CLI has installed its signal handler.
            if channelFD >= 0 { shutdown(channelFD, SHUT_RDWR) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 23) { [weak self] in
            guard let self, self.pid > 0 else { return }
            kill(-self.pid, SIGKILL)
        }
    }

    private func send(_ data: Data) throws {
        let count = data.withUnsafeBytes { Darwin.write(channelFD, $0.baseAddress, $0.count) }
        guard count == data.count else { throw posixError("write launch channel") }
    }

    #if PREVIEW_SMOKE
    func loseChannel() {
        // shutdown affects only this launch's private socket, never a PID/store.
        if channelFD >= 0 { shutdown(channelFD, SHUT_RDWR) }
    }
    #endif

    private func readAvailable(_ fd: Int32, protocolInput: Bool) {
        var bytes = [UInt8](repeating: 0, count: 8192)
        var endpoint: URL?
        // Bound work per dispatch; stdout floods cannot starve channel/exit/UI.
        for _ in 0..<8 {
            let count = read(fd, &bytes, bytes.count)
            if count == 0 {
                if protocolInput && !stopping { fail("The bundled engine launch channel closed before shutdown.") }
                if protocolInput { channel?.cancel(); channel = nil; channelFD = -1 }
                else { output?.cancel(); output = nil }
                return
            }
            if count < 0 {
                if errno == EINTR { continue }
                if errno != EAGAIN && protocolInput && !stopping { fail("The bundled engine launch channel failed.") }
                break
            }
            let data = Data(bytes[..<count])
            if protocolInput {
                do { if let ready = try protocolState.receive(data) { endpoint = ready } }
                catch { fail(error.localizedDescription); return }
            } else {
                log += String(decoding: data, as: UTF8.self)
                if log.utf8.count > 65536 {
                    // Leave room for replacement scalars at a split UTF-8 boundary.
                    log = String(decoding: log.utf8.suffix(65528), as: UTF8.self)
                }
            }
        }
        if let endpoint, !failed, !stopping { onReady?(endpoint) }
    }

    private func fail(_ message: String) {
        guard !failed, !stopping else { return }
        failed = true
        onFailure?(message)
        stop {}
    }

    private func posixError(_ action: String, _ code: Int32 = errno) -> Error {
        PreviewError.message("Could not \(action): \(String(cString: strerror(code)))")
    }
}
