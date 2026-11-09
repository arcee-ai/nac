import Foundation
import CoreFoundation
import CoreGraphics
import Darwin

struct StartupAXDeclaration: Codable, Equatable {
    let path, nonce, helper_path, helper_sha256: String
    let support_sha256: [String: String]
    let owner_pid: Int32
    let deadline_ns: String
}

struct StartupAXProcess: Codable, Equatable {
    let pid, parent, uid: Int32
    let start_seconds, start_microseconds: Int64
    let executable: String
    var valid: Bool {
        pid > 0 && parent > 0 && uid == Int32(getuid()) && start_seconds > 0
            && (0..<1_000_000).contains(start_microseconds)
    }
}

struct StartupAXFocus: Codable {
    let pid: Int32
    let role: String
    let focused, attached: Bool
    let frame: [Double]
    let value: String
}

struct StartupAXSurface: Codable {
    let surface, root_id: String
    let panel_id, go_to_id: String?
    let root_frame: [Double]
    let focus: StartupAXFocus?
}

struct StartupAXReceipt: Codable {
    let schema, nonce, configuration_sha256, helper_sha256: String
    let support_sha256: [String: String]
    let trusted: Bool
    let helper, target: StartupAXProcess
    let app_launch_epoch: Double
    let window_number: Int
    let sequence, refusal_generation, began_ns, ended_ns: String
    let status: String
    let case_deadline_ns: String
    let observation: StartupAXSurface?
    // Closed diagnostic facts only; never the private field value.
    let refusal_stage: String?
    let refusal: Data?
}

enum StartupAXReceiptError: Error { case missing, invalid, refused, expired }

enum StartupAXFiles {
    static let limit = 8192
    static func need(_ value: Bool) throws {
        if !value { throw StartupAXReceiptError.invalid }
    }
    static func canonical(_ path: String) -> Bool {
        guard path.hasPrefix("/"), path.utf8.count <= 4096,
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let resolved = realpath(path, nil) else { return false }
        defer { free(resolved) }
        return String(cString: resolved) == path
    }
    static func parent(_ path: String) throws {
        let directory = (path as NSString).deletingLastPathComponent
        var info = stat()
        try need(canonical(directory) && lstat(directory, &info) == 0
            && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
            && info.st_uid == getuid() && info.st_mode & 0o777 == 0o700)
    }
    static func read(_ path: String) throws -> Data {
        try parent(path)
        let fd = open(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        if fd < 0 && errno == ENOENT { throw StartupAXReceiptError.missing }
        try need(fd >= 0)
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        try need(fstat(fd, &info) == 0 && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && info.st_uid == getuid() && info.st_nlink == 1 && info.st_mode & 0o777 == 0o400
            && info.st_size > 0 && info.st_size <= limit)
        let data = handle.readData(ofLength: limit + 1)
        try need(data.count == Int(info.st_size) && data.count <= limit)
        return data
    }
    static func publish(_ receipt: StartupAXReceipt, to path: String) throws {
        try parent(path)
        let data = try JSONEncoder().encode(receipt)
        try need(data.count <= limit)
        let temporary = path + "." + UUID().uuidString
        let fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        try need(fd >= 0)
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { _ = unlink(temporary) }
        try handle.write(contentsOf: data)
        try need(fchmod(fd, 0o400) == 0)
        try handle.close()
        try need(rename(temporary, path) == 0)
    }
    static func uniqueKeys(_ data: Data) throws {
        let bytes = [UInt8](data)
        var stack: [Set<String>?] = [], index = 0
        while index < bytes.count {
            switch bytes[index] {
            case 123: stack.append(Set<String>())
            case 91: stack.append(nil)
            case 125, 93: try need(!stack.isEmpty); stack.removeLast()
            case 34:
                let start = index
                index += 1
                while index < bytes.count && bytes[index] != 34 {
                    if bytes[index] == 92 { index += 1 }
                    index += 1
                }
                try need(index < bytes.count)
                var after = index + 1
                while after < bytes.count && [9, 10, 13, 32].contains(bytes[after]) { after += 1 }
                if after < bytes.count && bytes[after] == 58 {
                    guard !stack.isEmpty, var keys = stack[stack.count - 1],
                          let key = try JSONSerialization.jsonObject(with: Data(bytes[start...index]), options: [.fragmentsAllowed]) as? String
                    else { throw StartupAXReceiptError.invalid }
                    try need(keys.insert(key).inserted)
                    stack[stack.count - 1] = keys
                }
            default: break
            }
            try need(stack.count <= 16)
            index += 1
        }
        try need(stack.isEmpty)
    }
    static func decode(_ data: Data) throws -> StartupAXReceipt {
        try need(data.count <= limit)
        try uniqueKeys(data)
        let body = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let required: Set<String> = ["schema", "nonce", "configuration_sha256", "helper_sha256", "support_sha256",
            "helper", "target", "trusted", "app_launch_epoch", "window_number", "sequence", "refusal_generation",
            "began_ns", "ended_ns", "status", "case_deadline_ns"]
        let optional: Set<String> = ["observation", "refusal_stage", "refusal"]
        guard let body else { throw StartupAXReceiptError.invalid }
        try need(required.isSubset(of: Set(body.keys)) && Set(body.keys).isSubset(of: required.union(optional)))
        let processKeys: Set<String> = ["pid", "parent", "uid", "start_seconds", "start_microseconds", "executable"]
        for key in ["helper", "target"] {
            try need((body[key] as? [String: Any]).map { Set($0.keys) == processKeys } == true)
        }
        if let observation = body["observation"] as? [String: Any] {
            let keys: Set<String> = ["surface", "root_id", "root_frame"]
            try need(keys.isSubset(of: Set(observation.keys))
                && Set(observation.keys).isSubset(of: keys.union(["panel_id", "go_to_id", "focus"])))
            if let focus = observation["focus"] as? [String: Any] {
                try need(Set(focus.keys) == ["pid", "role", "focused", "attached", "frame", "value"])
            }
        }
        return try JSONDecoder().decode(StartupAXReceipt.self, from: data)
    }
    static func number(_ text: String) throws -> UInt64 {
        guard let value = UInt64(text), String(value) == text else { throw StartupAXReceiptError.invalid }
        return value
    }
    static func frame(_ values: [Double]) throws -> CGRect {
        try need(values.count == 4 && values.allSatisfy { $0.isFinite })
        let value = CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
        try need(StartupNativeFolderPolicy.attached(exists: true, frame: value, owner: value))
        return value
    }
}

final class StartupAXClient {
    struct Ticket { let sequence, refusal, entered, deadline: UInt64 }
    struct Evidence: Codable {
        let sequence, began_ns, ended_ns, entered_ns, consumed_ns: String
        let surface, root_id: String
        let panel_id, go_to_id: String?
        let focus_checked: Bool
    }
    let declaration: StartupAXDeclaration
    let configurationSHA: String
    let pid: Int32
    let launch: Double
    let window: Int
    let executable: String
    let now: () -> UInt64
    let pause: () -> Void
    let load: () throws -> Data
    private var portLost = false
    private var helper: StartupAXProcess?
    private var target: StartupAXProcess?
    private var lastTime: UInt64 = 0
    private var lastSequence: UInt64 = 0
    private var observedSequence: UInt64?
    private var observedBytes: Data?
    private var observedRefusal: UInt64 = 0
    private var observedEnd: UInt64 = 0
    private var caseDeadline: UInt64?
    private var folderBinding = StartupNativeFolderPolicy.Binding<String>()
    private(set) var evidence: [Evidence] = []
    private(set) var failureData: Data?
    private(set) var refusalStage = "external_witness_unavailable"

    init(_ declaration: StartupAXDeclaration, configurationSHA: String, pid: Int32,
         launch: Double, window: Int, executable: String,
         now: @escaping () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
         pause: @escaping () -> Void = { Thread.sleep(forTimeInterval: 0.01) },
         load: (() throws -> Data)? = nil) {
        self.declaration = declaration; self.configurationSHA = configurationSHA
        self.pid = pid; self.launch = launch; self.window = window; self.executable = executable
        self.now = now; self.pause = pause
        self.load = load ?? { try StartupAXFiles.read(declaration.path) }
    }
    private func time() throws -> UInt64 {
        let value = now()
        try StartupAXFiles.need(value >= lastTime)
        lastTime = value
        return value
    }
    private func read() throws -> StartupAXReceipt {
        let hex: (String) -> Bool = { $0.utf8.count == 64 && $0.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
        try StartupAXFiles.need(hex(declaration.nonce) && hex(declaration.helper_sha256) && hex(configurationSHA)
            && Set(declaration.support_sha256.keys) == ["StartupAXGuard.swift", "StartupAXReceipt.swift"]
            && declaration.support_sha256.values.allSatisfy(hex))
        try StartupAXFiles.need(!portLost)
        let data: Data
        do { data = try load() }
        catch { if target != nil { portLost = true }; throw error }
        let receipt = try StartupAXFiles.decode(data)
        let incoming = try StartupAXFiles.number(receipt.sequence)
        let refusal = try StartupAXFiles.number(receipt.refusal_generation)
        let began = try StartupAXFiles.number(receipt.began_ns), ended = try StartupAXFiles.number(receipt.ended_ns)
        let stamp = try time(), cutoff = try StartupAXFiles.number(receipt.case_deadline_ns)
        try StartupAXFiles.need(refusal >= observedRefusal && began <= ended && ended <= stamp
            && cutoff <= StartupAXFiles.number(declaration.deadline_ns) && stamp < cutoff)
        if let caseDeadline { try StartupAXFiles.need(caseDeadline == cutoff) }
        if let previous = observedSequence, incoming > previous { try StartupAXFiles.need(began >= observedEnd) }
        observedRefusal = refusal; observedEnd = ended; caseDeadline = cutoff
        if let previous = observedSequence {
            try StartupAXFiles.need(incoming >= previous && (incoming != previous || data == observedBytes))
        }
        observedSequence = incoming; observedBytes = data
        try StartupAXFiles.need(receipt.schema == "nac342-ax-witness-v1"
            && receipt.nonce == declaration.nonce && declaration.nonce.count == 64
            && receipt.configuration_sha256 == configurationSHA
            && receipt.helper_sha256 == declaration.helper_sha256
            && receipt.support_sha256 == declaration.support_sha256
            && receipt.helper.valid && receipt.helper.parent == declaration.owner_pid
            && receipt.helper.executable == declaration.helper_path)
        if let helper { try StartupAXFiles.need(helper == receipt.helper) }
        helper = receipt.helper
        if receipt.status == "waiting" {
            try StartupAXFiles.need(lastSequence == 0 && receipt.sequence == "0" && receipt.trusted)
            throw StartupAXReceiptError.missing
        }
        try StartupAXFiles.need(receipt.trusted && receipt.target.valid && receipt.target.pid == pid
            && receipt.target.executable == executable && receipt.app_launch_epoch == launch
            && launch.isFinite && launch > 0 && receipt.window_number == window && window > 0)
        if let target { try StartupAXFiles.need(target == receipt.target) }
        helper = receipt.helper; target = receipt.target
        let sequence = try StartupAXFiles.number(receipt.sequence)
        try StartupAXFiles.need(sequence > 0 && sequence >= lastSequence)
        if receipt.status != "ready" {
            failureData = receipt.refusal
            refusalStage = receipt.refusal_stage ?? "external_witness_refused"
            throw StartupAXReceiptError.refused
        }
        guard let observation = receipt.observation,
              let phase = StartupNativeFolderPolicy.Surface(rawValue: observation.surface) else { throw StartupAXReceiptError.invalid }
        try StartupAXFiles.need(receipt.refusal_stage == nil && receipt.refusal == nil
            && UUID(uuidString: observation.root_id) != nil
            && folderBinding.accept(phase, root: observation.root_id, panel: observation.panel_id, goTo: observation.go_to_id))
        return receipt
    }
    func begin() throws -> Ticket {
        let deadline = min(try StartupAXFiles.number(declaration.deadline_ns), try time() + 30_000_000_000)
        while true {
            do {
                let baseline = try read()
                let entered = try time()
                if entered >= deadline { throw StartupAXReceiptError.expired }
                return Ticket(sequence: try StartupAXFiles.number(baseline.sequence),
                    refusal: try StartupAXFiles.number(baseline.refusal_generation), entered: entered, deadline: min(deadline, caseDeadline!))
            } catch StartupAXReceiptError.missing {
                if portLost { throw StartupAXReceiptError.missing }
                if try time() >= deadline { throw StartupAXReceiptError.expired }
                pause() // Initial publication only; malformed/refused never retries.
            }
        }
    }
    func consume(_ ticket: Ticket, surface: StartupNativeFolderPolicy.Surface, rootFrame: CGRect,
                 field: (CGRect, String)? = nil) throws -> StartupAXSurface {
        while true {
            if try time() >= ticket.deadline { throw StartupAXReceiptError.expired }
            let receipt = try read()
            let stamp = try time()
            let sequence = try StartupAXFiles.number(receipt.sequence)
            let refusal = try StartupAXFiles.number(receipt.refusal_generation)
            try StartupAXFiles.need(refusal == ticket.refusal)
            let began = try StartupAXFiles.number(receipt.began_ns), ended = try StartupAXFiles.number(receipt.ended_ns)
            try StartupAXFiles.need(began <= ended && ended <= stamp && ended - began <= 1_000_000_000)
            if sequence <= ticket.sequence || began <= ticket.entered {
                pause(); continue // Wait for a newly BEGUN sample, never a later positive after refusal.
            }
            try StartupAXFiles.need(sequence > lastSequence)
            let expiredPublication = stamp - ended > 1_000_000_000
            guard let observed = receipt.observation else { throw StartupAXReceiptError.invalid }
            try StartupAXFiles.need(observed.surface == surface.rawValue
                && (try StartupAXFiles.frame(observed.root_frame)) == rootFrame
                && UUID(uuidString: observed.root_id) != nil
                && (observed.panel_id == nil || UUID(uuidString: observed.panel_id!) != nil)
                && (observed.go_to_id == nil || UUID(uuidString: observed.go_to_id!) != nil)
                && folderBinding.accept(surface, root: observed.root_id, panel: observed.panel_id, goTo: observed.go_to_id))
            if surface == .goTo {
                guard let focus = observed.focus, let field else { throw StartupAXReceiptError.invalid }
                try StartupAXFiles.need(focus.attached && focus.value.utf8.count <= 4096
                    && StartupNativeFolderPolicy.focused(pid: focus.pid, expectedPID: pid, role: focus.role,
                        focused: focus.focused, frame: try StartupAXFiles.frame(focus.frame),
                        expectedFrame: field.0, value: focus.value, expectedValue: field.1))
            } else { try StartupAXFiles.need(observed.focus == nil && field == nil) }
            if expiredPublication {
                pause(); continue // Only an otherwise fully validated positive may await publication.
            }
            let consumed = try time()
            try StartupAXFiles.need(consumed < ticket.deadline && consumed >= ended && consumed - ended <= 1_000_000_000)
            lastSequence = sequence
            try StartupAXFiles.need(evidence.count < 26)
            evidence.append(Evidence(sequence: receipt.sequence, began_ns: receipt.began_ns,
                ended_ns: receipt.ended_ns, entered_ns: String(ticket.entered), consumed_ns: String(consumed),
                surface: observed.surface, root_id: observed.root_id, panel_id: observed.panel_id,
                go_to_id: observed.go_to_id, focus_checked: surface == .goTo))
            return observed
        }
    }
}
