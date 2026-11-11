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

// One closed, ephemeral interaction request on the existing private file port.
struct StartupAXInteractionRequest: Codable, Equatable {
    let schema, nonce, configuration_sha256, id, root_id: String
    let entered_ns, deadline_ns, baseline_sequence, refusal_generation: String
    let surface, kind, label: String
    let keyboard: Bool
    let point, anchor_frame, root_frame: [Double]
    let value: String?

    func validate(diagnostic: StartupFailureEvidence? = nil) throws {
        diagnostic?.step = .request_schema
        try StartupAXFiles.need(schema == "nac342-ax-interaction-v1")
        diagnostic?.step = .request_id
        try StartupAXFiles.need(UUID(uuidString: id) != nil)
        diagnostic?.step = .request_root_id
        try StartupAXFiles.need(UUID(uuidString: root_id) != nil)
        diagnostic?.step = .request_surface
        try StartupAXFiles.need(["form", "panel", "goTo"].contains(surface))
        diagnostic?.step = .request_kind
        try StartupAXFiles.need(["button", "message", "panel", "field"].contains(kind))
        diagnostic?.step = .request_label_size
        try StartupAXFiles.need(label.utf8.count <= 1024)
        diagnostic?.step = .request_label_required
        try StartupAXFiles.need(!["button", "message"].contains(kind) || !label.isEmpty)
        diagnostic?.step = .request_point_count
        try StartupAXFiles.need(point.count == 2)
        diagnostic?.step = .request_point_x_finite
        try StartupAXFiles.need(point[0].isFinite)
        diagnostic?.step = .request_point_x_float
        try StartupAXFiles.need(Double(Float(point[0])) == point[0])
        diagnostic?.step = .request_point_y_finite
        try StartupAXFiles.need(point[1].isFinite)
        diagnostic?.step = .request_point_y_float
        try StartupAXFiles.need(Double(Float(point[1])) == point[1])
        if let value {
            diagnostic?.step = .request_value_keyboard
            try StartupAXFiles.need(keyboard)
            diagnostic?.step = .request_value_kind
            try StartupAXFiles.need(["message", "field"].contains(kind))
            diagnostic?.step = .request_value_size
            try StartupAXFiles.need(value.utf8.count <= 4096)
        }
        diagnostic?.step = .request_anchor_frame
        let anchor = try StartupAXFiles.frame(anchor_frame)
        diagnostic?.step = .request_root_frame
        let root = try StartupAXFiles.frame(root_frame)
        diagnostic?.step = .request_containment
        try StartupAXFiles.need(anchor.contains(CGPoint(x: point[0], y: point[1])) && anchor.intersects(root)
            && (kind != "field" || (keyboard && surface == "goTo" && value != nil))
            && (kind != "message" || !keyboard || value != nil))
        diagnostic?.step = .request_deadline
        let entered = try StartupAXFiles.number(entered_ns), deadline = try StartupAXFiles.number(deadline_ns)
        try StartupAXFiles.need(deadline > entered && deadline - entered <= 30_000_000_000)
        diagnostic?.step = .request_counters
        _ = try StartupAXFiles.number(baseline_sequence); _ = try StartupAXFiles.number(refusal_generation)
    }
    static func read(_ path: String) throws -> Self {
        let data = try StartupAXFiles.read(path)
        try StartupAXFiles.uniqueKeys(data)
        let body = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let keys: Set<String> = ["schema", "nonce", "configuration_sha256", "id", "root_id", "entered_ns",
            "deadline_ns", "baseline_sequence", "refusal_generation", "surface", "kind", "keyboard",
            "point", "anchor_frame", "root_frame", "label"]
        try StartupAXFiles.need(body.map { keys.isSubset(of: Set($0.keys)) && Set($0.keys).isSubset(of: keys.union(["value"])) } == true)
        let result = try JSONDecoder().decode(Self.self, from: data)
        try result.validate()
        return result
    }
}

// Closed one-shot claim on the existing request child; ACK is readonly in proof parent.
struct StartupAXActionHandoff: Codable, Equatable {
    let schema, request_id, target_id, nonce, configuration_sha256, deadline_ns, input_ns: String
    var completed_ns: String? = nil
    func validate(_ request: StartupAXInteractionRequest, target: String, now: UInt64) throws {
        try StartupAXFiles.need(schema == "nac342-action-handoff-v1" && request_id == request.id
            && target_id == target && UUID(uuidString: target_id) != nil && nonce == request.nonce
            && configuration_sha256 == request.configuration_sha256 && deadline_ns == request.deadline_ns)
        let input = try StartupAXFiles.number(input_ns), cutoff = try StartupAXFiles.number(deadline_ns)
        try StartupAXFiles.need(input >= StartupAXFiles.number(request.entered_ns) && input <= now && now < cutoff)
        if let completed_ns {
            let completed = try StartupAXFiles.number(completed_ns)
            try StartupAXFiles.need(completed >= input && completed <= now && completed < cutoff)
        }
    }
    static func read(_ path: String) throws -> Self {
        let bytes = try StartupAXFiles.read(path)
        try StartupAXFiles.uniqueKeys(bytes)
        let body = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
        let required: Set<String> = ["schema", "request_id", "target_id", "nonce", "configuration_sha256", "deadline_ns", "input_ns"]
        try StartupAXFiles.need(body.map { required.isSubset(of: Set($0.keys))
            && Set($0.keys).isSubset(of: required.union(["completed_ns"])) } == true)
        return try JSONDecoder().decode(Self.self, from: bytes)
    }
}

// Both real producer and inert controls use this same state/intent predicate.
struct StartupAXActionLease {
    let request: StartupAXInteractionRequest
    let target: String
    private(set) var armed: StartupAXActionHandoff?
    private(set) var completed: StartupAXActionHandoff?
    mutating func arm(_ claim: StartupAXActionHandoff, now: UInt64) throws {
        try claim.validate(request, target: target, now: now)
        try StartupAXFiles.need(armed == nil && completed == nil && claim.completed_ns == nil)
        armed = claim
    }
    mutating func complete(_ claim: StartupAXActionHandoff, now: UInt64) throws {
        try claim.validate(request, target: target, now: now)
        var initial = claim; initial.completed_ns = nil
        try StartupAXFiles.need(armed == initial && completed == nil && claim.completed_ns != nil)
        completed = claim
    }
}

struct StartupAXInteraction: Codable, Equatable {
    let request_id, target_id: String
    let point, anchor_frame: [Double]
    let keyboard, focus_checked: Bool
}

struct StartupAXSurface: Codable {
    let surface, root_id: String
    let panel_id, go_to_id: String?
    let root_frame: [Double]
    let focus: StartupAXFocus?
    var interaction: StartupAXInteraction? = nil
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
    var action_handoff: StartupAXActionHandoff? = nil
}

enum StartupAXReceiptError: Error { case missing, invalid, refused, expired }

// First throwing journey step, published before its existing teardown defer.
// Passive evidence on the existing owned port; never receipt/input authority.
// Optional references mark original operations before they can throw. No errors,
// raw operands, or guard results are added to the closed seven-field record.
enum StartupFailureStep: String, Codable, CaseIterable {
    case startup_checks, before_guard, before_record, public_target, prepare_interaction
    case final_recheck, finish_interaction, input, after_guard, after_record, terminal
    case request_shape, request_anchor_frame, request_root_frame, request_containment
    case request_schema, request_id, request_root_id, request_surface
    case request_kind, request_label_size, request_label_required, request_point_count
    case request_point_x_finite, request_point_x_float, request_point_y_finite, request_point_y_float
    case request_value_keyboard, request_value_kind, request_value_size
    case request_deadline, request_counters, read_parent, read_open
    case read_metadata, read_bytes, publish_parent, publish_encode
    case publish_size, publish_open, publish_write, publish_mode
    case publish_open_access_denied, publish_open_not_permitted, publish_open_read_only
    case publish_open_exists, publish_open_resource, publish_open_path, publish_open_other
    case publish_close, publish_rename, decode_size, decode_keys
    case decode_json, decode_object, decode_fields, decode_process
    case decode_observation, decode_interaction, decode_focus, decode_types
    case clock_monotonic, read_declaration, read_port, read_load
    case read_numbers, read_clock, read_window, read_case_deadline
    case read_sample_order, read_sequence_bytes, read_binding, read_helper_identity
    case read_waiting, read_target_binding, read_target_identity, read_sequence
    case read_status, read_observation, read_folder_binding, prepare_state
    case prepare_ticket, prepare_publication, consume_deadline, consume_numbers
    case consume_refusal, consume_sample_numbers, consume_sample_window, consume_sequence
    case consume_observation, consume_surface_binding, consume_focus_presence, consume_focus
    case consume_no_focus, consume_proof_presence, consume_proof_binding, consume_freshness
    case consume_pending, consume_target_identity, consume_evidence_limit, read_cutoff
}

struct StartupFirstFailure: Encodable {
    let schema = "nac342-first-preflight-failure-v1"
    let acceptance = false
    let nonce, configuration_sha256: String
    let step: StartupFailureStep
    let operation_index: Int
    let error_family: String
}

final class StartupFailureEvidence {
    var step: StartupFailureStep = .startup_checks
    var operationIndex = 0
    private var retained = false
    private let declaration: StartupAXDeclaration?
    private let configurationSHA: String
    init(_ declaration: StartupAXDeclaration?, configurationSHA: String) {
        self.declaration = declaration; self.configurationSHA = configurationSHA
    }
    static func family(_ error: Error) -> String {
        if let error = error as? StartupAXReceiptError {
            switch error {
            case .missing: return "receipt_missing"
            case .invalid: return "receipt_invalid"
            case .refused: return "receipt_refused"
            case .expired: return "receipt_expired"
            }
        }
        if error is DecodingError { return "decoding" }
        if error is CocoaError { return "foundation" }
        return "other"
    }
    func capture(_ error: Error) -> StartupFirstFailure? {
        if !retained, let declaration {
            retained = true // First failure only, including publication failure.
            let record = StartupFirstFailure(nonce: declaration.nonce, configuration_sha256: configurationSHA,
                step: step, operation_index: operationIndex, error_family: Self.family(error))
            try? StartupAXFiles.publish(record, to: declaration.path + ".failure")
            return record // Independent attachment remains possible after file publication fails.
        }
        return nil // No second publication or attachment attempt.
    }
}

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
    // Fixed derived namespace; declaration and request payload remain unchanged.
    // Proof/stop/failure stay in the nonwritable parent. Both owners use this.
    static func requestPath(_ receiptPath: String, diagnostic: StartupFailureEvidence? = nil) throws -> String {
        diagnostic?.step = .publish_parent
        try parent(receiptPath)
        let proofDirectory = (receiptPath as NSString).deletingLastPathComponent
        let path = proofDirectory + "/requests/request.json"
        try parent(path)
        return path
    }
    static func read(_ path: String, diagnostic: StartupFailureEvidence? = nil) throws -> Data {
        diagnostic?.step = .read_parent
        try parent(path)
        diagnostic?.step = .read_open
        let fd = open(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        if fd < 0 && errno == ENOENT { throw StartupAXReceiptError.missing }
        try need(fd >= 0)
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        diagnostic?.step = .read_metadata
        try need(fstat(fd, &info) == 0 && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && info.st_uid == getuid() && (info.st_nlink == 0 || info.st_nlink == 1) && info.st_mode & 0o777 == 0o400
            && info.st_size > 0 && info.st_size <= limit)
        diagnostic?.step = .read_bytes
        let data = handle.readData(ofLength: limit + 1)
        try need(data.count == Int(info.st_size) && data.count <= limit)
        return data
    }
    static func publish<Value: Encodable>(_ receipt: Value, to path: String,
                                          diagnostic: StartupFailureEvidence? = nil) throws {
        diagnostic?.step = .publish_parent
        try parent(path)
        diagnostic?.step = .publish_encode
        let data = try JSONEncoder().encode(receipt)
        diagnostic?.step = .publish_size
        try need(data.count <= limit)
        let temporary = path + "." + UUID().uuidString
        diagnostic?.step = .publish_open
        let fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        if fd < 0 {
            let failureErrno = errno // Capture before any Foundation or diagnostic work.
            switch failureErrno {
            case EACCES: diagnostic?.step = .publish_open_access_denied
            case EPERM: diagnostic?.step = .publish_open_not_permitted
            case EROFS: diagnostic?.step = .publish_open_read_only
            case EEXIST: diagnostic?.step = .publish_open_exists
            case ENOSPC, EDQUOT, EMFILE, ENFILE, ENOMEM: diagnostic?.step = .publish_open_resource
            case ENOENT, ENOTDIR, ELOOP, ENAMETOOLONG: diagnostic?.step = .publish_open_path
            default: diagnostic?.step = .publish_open_other
            }
            throw StartupAXReceiptError.invalid
        }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { _ = unlink(temporary) }
        diagnostic?.step = .publish_write
        try handle.write(contentsOf: data)
        diagnostic?.step = .publish_mode
        try need(fchmod(fd, 0o400) == 0)
        diagnostic?.step = .publish_close
        try handle.close()
        diagnostic?.step = .publish_rename
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
    static func decode(_ data: Data, diagnostic: StartupFailureEvidence? = nil) throws -> StartupAXReceipt {
        diagnostic?.step = .decode_size
        try need(data.count <= limit)
        diagnostic?.step = .decode_keys
        try uniqueKeys(data)
        diagnostic?.step = .decode_json
        let body = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let required: Set<String> = ["schema", "nonce", "configuration_sha256", "helper_sha256", "support_sha256",
            "helper", "target", "trusted", "app_launch_epoch", "window_number", "sequence", "refusal_generation",
            "began_ns", "ended_ns", "status", "case_deadline_ns"]
        let optional: Set<String> = ["observation", "refusal_stage", "refusal", "action_handoff"]
        diagnostic?.step = .decode_object
        guard let body else { throw StartupAXReceiptError.invalid }
        diagnostic?.step = .decode_fields
        try need(required.isSubset(of: Set(body.keys)) && Set(body.keys).isSubset(of: required.union(optional)))
        if let handoff = body["action_handoff"] as? [String: Any] {
            let keys: Set<String> = ["schema", "request_id", "target_id", "nonce", "configuration_sha256", "deadline_ns", "input_ns"]
            try need(keys.isSubset(of: Set(handoff.keys)) && Set(handoff.keys).isSubset(of: keys.union(["completed_ns"])))
        }
        let processKeys: Set<String> = ["pid", "parent", "uid", "start_seconds", "start_microseconds", "executable"]
        for key in ["helper", "target"] {
            diagnostic?.step = .decode_process
            try need((body[key] as? [String: Any]).map { Set($0.keys) == processKeys } == true)
        }
        if let observation = body["observation"] as? [String: Any] {
            let keys: Set<String> = ["surface", "root_id", "root_frame"]
            diagnostic?.step = .decode_observation
            try need(keys.isSubset(of: Set(observation.keys))
                && Set(observation.keys).isSubset(of: keys.union(["panel_id", "go_to_id", "focus", "interaction"])))
            if let interaction = observation["interaction"] as? [String: Any] {
                diagnostic?.step = .decode_interaction
                try need(Set(interaction.keys) == ["request_id", "target_id", "point", "anchor_frame", "keyboard", "focus_checked"])
            }
            if let focus = observation["focus"] as? [String: Any] {
                diagnostic?.step = .decode_focus
                try need(Set(focus.keys) == ["pid", "role", "focused", "attached", "frame", "value"])
            }
        }
        diagnostic?.step = .decode_types
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
    let load: (() throws -> Data)?
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
    private var lastSurface: StartupAXSurface?
    private var pendingInteraction: StartupAXInteractionRequest?
    private var actionHandoff: StartupAXActionHandoff?
    private var actionCompleted = false
    private var outgoingPublication: Data?
    private var interactionProof: StartupAXInteraction?
    private var interactionTargets: [String: String] = [:]
    struct InteractionEvidence: Codable {
        let request_id, target_id, kind, surface: String
        let point, anchor_frame: [Double]
        let keyboard, focus_checked: Bool
        let sequence, began_ns, ended_ns, entered_ns, consumed_ns, deadline_ns: String
        var finalized_ns: String
    }
    private(set) var interactions: [InteractionEvidence] = []
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
        self.load = load
    }
    private func time(diagnostic: StartupFailureEvidence? = nil) throws -> UInt64 {
        diagnostic?.step = .clock_monotonic
        let value = now()
        try StartupAXFiles.need(value >= lastTime)
        lastTime = value
        return value
    }
    private func read(diagnostic: StartupFailureEvidence? = nil) throws -> StartupAXReceipt {
        let hex: (String) -> Bool = { $0.utf8.count == 64 && $0.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
        diagnostic?.step = .read_declaration
        try StartupAXFiles.need(hex(declaration.nonce) && hex(declaration.helper_sha256) && hex(configurationSHA)
            && Set(declaration.support_sha256.keys) == ["StartupAXGuard.swift", "StartupAXReceipt.swift"]
            && declaration.support_sha256.values.allSatisfy(hex))
        diagnostic?.step = .read_port
        try StartupAXFiles.need(!portLost)
        diagnostic?.step = .read_load
        let data: Data
        do { data = try load?() ?? StartupAXFiles.read(declaration.path, diagnostic: diagnostic) }
        catch { if target != nil { portLost = true }; throw error }
        let receipt = try StartupAXFiles.decode(data, diagnostic: diagnostic)
        diagnostic?.step = .read_numbers
        let incoming = try StartupAXFiles.number(receipt.sequence)
        let refusal = try StartupAXFiles.number(receipt.refusal_generation)
        let began = try StartupAXFiles.number(receipt.began_ns), ended = try StartupAXFiles.number(receipt.ended_ns)
        diagnostic?.step = .read_clock
        let stamp = try time(diagnostic: diagnostic)
        diagnostic?.step = .read_cutoff
        let cutoff = try StartupAXFiles.number(receipt.case_deadline_ns)
        diagnostic?.step = .read_window
        try StartupAXFiles.need(refusal >= observedRefusal && began <= ended && ended <= stamp
            && cutoff <= StartupAXFiles.number(declaration.deadline_ns) && stamp < cutoff)
        diagnostic?.step = .read_case_deadline
        if let caseDeadline { try StartupAXFiles.need(caseDeadline == cutoff) }
        diagnostic?.step = .read_sample_order
        if let previous = observedSequence, incoming > previous { try StartupAXFiles.need(began >= observedEnd) }
        observedRefusal = refusal; observedEnd = ended; caseDeadline = cutoff
        diagnostic?.step = .read_sequence_bytes
        if let previous = observedSequence {
            try StartupAXFiles.need(incoming >= previous && (incoming != previous || data == observedBytes))
        }
        observedSequence = incoming; observedBytes = data
        diagnostic?.step = .read_binding
        try StartupAXFiles.need(receipt.schema == "nac342-ax-witness-v1"
            && receipt.nonce == declaration.nonce && declaration.nonce.count == 64
            && receipt.configuration_sha256 == configurationSHA
            && receipt.helper_sha256 == declaration.helper_sha256
            && receipt.support_sha256 == declaration.support_sha256
            && receipt.helper.valid && receipt.helper.parent == declaration.owner_pid
            && receipt.helper.executable == declaration.helper_path)
        diagnostic?.step = .read_helper_identity
        if let helper { try StartupAXFiles.need(helper == receipt.helper) }
        helper = receipt.helper
        if receipt.status == "waiting" {
            diagnostic?.step = .read_waiting
            try StartupAXFiles.need(lastSequence == 0 && receipt.sequence == "0" && receipt.trusted)
            throw StartupAXReceiptError.missing
        }
        diagnostic?.step = .read_target_binding
        try StartupAXFiles.need(receipt.trusted && receipt.target.valid && receipt.target.pid == pid
            && receipt.target.executable == executable && receipt.app_launch_epoch == launch
            && launch.isFinite && launch > 0 && receipt.window_number == window && window > 0)
        diagnostic?.step = .read_target_identity
        if let target { try StartupAXFiles.need(target == receipt.target) }
        helper = receipt.helper; target = receipt.target
        diagnostic?.step = .read_sequence
        let sequence = try StartupAXFiles.number(receipt.sequence)
        try StartupAXFiles.need(sequence > 0 && sequence >= lastSequence)
        diagnostic?.step = .read_status
        if receipt.status != "ready" {
            failureData = receipt.refusal
            refusalStage = receipt.refusal_stage ?? "external_witness_refused"
            throw StartupAXReceiptError.refused
        }
        diagnostic?.step = .read_observation
        guard let observation = receipt.observation,
              let phase = StartupNativeFolderPolicy.Surface(rawValue: observation.surface) else { throw StartupAXReceiptError.invalid }
        diagnostic?.step = .read_folder_binding
        try StartupAXFiles.need(receipt.refusal_stage == nil && receipt.refusal == nil
            && UUID(uuidString: observation.root_id) != nil
            && folderBinding.accept(phase, root: observation.root_id, panel: observation.panel_id, goTo: observation.go_to_id))
        return receipt
    }
    func begin() throws -> Ticket {
        do {
        if let request = pendingInteraction {
            guard actionCompleted, let claim = actionHandoff, let completed = claim.completed_ns else {
                portLost = true; throw StartupAXReceiptError.invalid
            }
            let stamp = try time(), cutoff = try StartupAXFiles.number(request.deadline_ns)
            try StartupAXFiles.need(!portLost && stamp < cutoff)
            return Ticket(sequence: lastSequence, refusal: try StartupAXFiles.number(request.refusal_generation),
                entered: try StartupAXFiles.number(completed), deadline: cutoff)
        }
        let deadline = min(try StartupAXFiles.number(declaration.deadline_ns), try time() + 30_000_000_000)
        while true {
            do {
                let baseline = try read()
                try StartupAXFiles.need(baseline.action_handoff == nil || observedBytes == outgoingPublication)
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
        } catch { portLost = true; throw error }
    }
    func prepareInteraction(_ ticket: Ticket, point: CGPoint, anchor: CGRect, kind: String, label: String,
                            keyboard: Bool, value: String?, rootFrame: CGRect,
                            field: (CGRect, String)? = nil,
                            publish: ((StartupAXInteractionRequest) throws -> Void)? = nil,
                            diagnostic: StartupFailureEvidence? = nil) throws -> StartupAXInteractionRequest {
        do {
            diagnostic?.step = .prepare_state
            guard !portLost, let observed = lastSurface, pendingInteraction == nil else { throw StartupAXReceiptError.invalid }
            let entered = try time(diagnostic: diagnostic)
            let request = StartupAXInteractionRequest(schema: "nac342-ax-interaction-v1", nonce: declaration.nonce,
                configuration_sha256: configurationSHA, id: UUID().uuidString, root_id: observed.root_id,
                entered_ns: String(entered), deadline_ns: String(ticket.deadline), baseline_sequence: String(lastSequence),
                refusal_generation: String(ticket.refusal), surface: observed.surface, kind: kind, label: label, keyboard: keyboard,
                point: [point.x, point.y], anchor_frame: [anchor.minX, anchor.minY, anchor.width, anchor.height],
                root_frame: [rootFrame.minX, rootFrame.minY, rootFrame.width, rootFrame.height], value: value)
            try request.validate(diagnostic: diagnostic)
            diagnostic?.step = .prepare_ticket
            try StartupAXFiles.need(entered < ticket.deadline && observedRefusal == ticket.refusal)
            pendingInteraction = request
            diagnostic?.step = .prepare_publication
            if let publish { try publish(request) }
            else { try StartupAXFiles.publish(request, to: try StartupAXFiles.requestPath(declaration.path, diagnostic: diagnostic), diagnostic: diagnostic) }
            let fresh = Ticket(sequence: lastSequence, refusal: ticket.refusal, entered: entered, deadline: ticket.deadline)
            _ = try consume(fresh, surface: StartupNativeFolderPolicy.Surface(rawValue: observed.surface)!,
                rootFrame: rootFrame, field: field, request: request, diagnostic: diagnostic)
            return request
        } catch { portLost = true; throw error }
    }
    func finishInteraction(_ request: StartupAXInteractionRequest,
                           arm: ((StartupAXActionHandoff) throws -> Void)? = nil,
                           acknowledgment: (() throws -> StartupAXActionHandoff)? = nil,
                           recheck: () throws -> Void = {}) throws {
        do {
            try StartupAXFiles.need(!portLost && pendingInteraction == request && actionHandoff == nil)
            let entered = try time()
            let claim = StartupAXActionHandoff(schema: "nac342-action-handoff-v1", request_id: request.id,
                target_id: try { guard let proof = interactionProof else { throw StartupAXReceiptError.invalid }; return proof.target_id }(),
                nonce: request.nonce, configuration_sha256: request.configuration_sha256,
                deadline_ns: request.deadline_ns, input_ns: String(entered))
            try claim.validate(request, target: claim.target_id, now: entered)
            let before = try read(), initial = try time(), originalEnd = try StartupAXFiles.number(before.ended_ns)
            try StartupAXFiles.need(before.observation?.interaction == interactionProof
                && before.refusal_generation == request.refusal_generation && before.action_handoff == nil
                && initial >= originalEnd && initial - originalEnd <= 1_000_000_000
                && initial < StartupAXFiles.number(request.deadline_ns))
            if let arm { try arm(claim) }
            else {
                try StartupAXFiles.need(try StartupAXInteractionRequest.read(try StartupAXFiles.requestPath(declaration.path)) == request)
                try StartupAXFiles.publish(claim, to: try StartupAXFiles.requestPath(declaration.path) + ".handoff")
            }
            while true {
                // ACK never refreshes the held AX proof; every wait spends its original age.
                let stamp = try time()
                try StartupAXFiles.need(stamp >= originalEnd && stamp - originalEnd <= 1_000_000_000
                    && stamp < StartupAXFiles.number(request.deadline_ns))
                do {
                    let ack = try acknowledgment?() ?? StartupAXActionHandoff.read(declaration.path + ".handoff")
                    try StartupAXFiles.need(ack == claim)
                    break
                } catch StartupAXReceiptError.missing { pause() }
            }
            // Public query/point/focus/value rechecks happen AFTER ACK and before final proof.
            try recheck()
            if arm == nil {
                let path = try StartupAXFiles.requestPath(declaration.path)
                try StartupAXFiles.need(try StartupAXInteractionRequest.read(path) == request)
                try StartupAXFiles.need(try StartupAXActionHandoff.read(path + ".handoff") == claim)
                try StartupAXFiles.need(try StartupAXActionHandoff.read(declaration.path + ".handoff") == claim)
            }
            let final = try read(), finalized = try time(), ended = try StartupAXFiles.number(final.ended_ns)
            try StartupAXFiles.need(final.observation?.interaction == interactionProof
                && final.refusal_generation == request.refusal_generation && final.action_handoff == nil
                && finalized >= ended && finalized - ended <= 1_000_000_000
                && finalized < StartupAXFiles.number(request.deadline_ns))
            interactions[interactions.count - 1].finalized_ns = String(finalized)
            actionHandoff = claim
            outgoingPublication = observedBytes
        } catch { portLost = true; throw error }
    }
    func completeInteraction(_ request: StartupAXInteractionRequest,
                             publish: ((StartupAXActionHandoff) throws -> Void)? = nil) throws {
        do {
            guard !portLost, pendingInteraction == request, var claim = actionHandoff, !actionCompleted else { throw StartupAXReceiptError.invalid }
            claim.completed_ns = String(try time())
            try claim.validate(request, target: claim.target_id, now: try time())
            if let publish { try publish(claim) }
            else {
                let path = try StartupAXFiles.requestPath(declaration.path)
                try StartupAXFiles.need(try StartupAXInteractionRequest.read(path) == request)
                try StartupAXFiles.need(try StartupAXActionHandoff.read(path + ".handoff") == actionHandoff)
                try StartupAXFiles.publish(claim, to: path + ".handoff")
            }
            actionHandoff = claim; actionCompleted = true
        } catch { portLost = true; throw error }
    }
    func consume(_ ticket: Ticket, surface: StartupNativeFolderPolicy.Surface, rootFrame: CGRect,
                 field: (CGRect, String)? = nil, request: StartupAXInteractionRequest? = nil,
                 diagnostic: StartupFailureEvidence? = nil) throws -> StartupAXSurface {
        do { while true {
            let checkedTime = try time(diagnostic: diagnostic)
            diagnostic?.step = .consume_deadline
            if checkedTime >= ticket.deadline { throw StartupAXReceiptError.expired }
            let receipt = try read(diagnostic: diagnostic)
            let stamp = try time(diagnostic: diagnostic)
            diagnostic?.step = .consume_numbers
            let sequence = try StartupAXFiles.number(receipt.sequence)
            let refusal = try StartupAXFiles.number(receipt.refusal_generation)
            diagnostic?.step = .consume_refusal
            try StartupAXFiles.need(refusal == ticket.refusal)
            diagnostic?.step = .consume_sample_numbers
            let began = try StartupAXFiles.number(receipt.began_ns), ended = try StartupAXFiles.number(receipt.ended_ns)
            diagnostic?.step = .consume_sample_window
            try StartupAXFiles.need(began <= ended && ended <= stamp && ended - began <= 1_000_000_000)
            // Recognize only the exact already-validated outgoing publication.
            // Await its replacement; these bytes never satisfy the next phase.
            if observedBytes == outgoingPublication && sequence <= ticket.sequence {
                pause(); continue
            }
            if actionCompleted, let claim = actionHandoff {
                try StartupAXFiles.need(request == nil && receipt.action_handoff == claim
                    && began > StartupAXFiles.number(claim.completed_ns!)
                    && receipt.observation?.interaction == nil)
            } else { try StartupAXFiles.need(receipt.action_handoff == nil) }
            if sequence <= ticket.sequence || began <= ticket.entered {
                pause(); continue // Wait for a newly BEGUN sample, never a later positive after refusal.
            }
            diagnostic?.step = .consume_sequence
            try StartupAXFiles.need(sequence > lastSequence)
            let expiredPublication = stamp - ended > 1_000_000_000
            diagnostic?.step = .consume_observation
            guard let observed = receipt.observation else { throw StartupAXReceiptError.invalid }
            diagnostic?.step = .consume_surface_binding
            try StartupAXFiles.need(observed.surface == surface.rawValue
                && (try StartupAXFiles.frame(observed.root_frame)) == rootFrame
                && UUID(uuidString: observed.root_id) != nil
                && (observed.panel_id == nil || UUID(uuidString: observed.panel_id!) != nil)
                && (observed.go_to_id == nil || UUID(uuidString: observed.go_to_id!) != nil)
                && folderBinding.accept(surface, root: observed.root_id, panel: observed.panel_id, goTo: observed.go_to_id))
            if surface == .goTo {
                diagnostic?.step = .consume_focus_presence
                guard let focus = observed.focus, let field else { throw StartupAXReceiptError.invalid }
                diagnostic?.step = .consume_focus
                try StartupAXFiles.need(focus.attached && focus.value.utf8.count <= 4096
                    && StartupNativeFolderPolicy.focused(pid: focus.pid, expectedPID: pid, role: focus.role,
                        focused: focus.focused, frame: try StartupAXFiles.frame(focus.frame),
                        expectedFrame: field.0, value: focus.value, expectedValue: field.1))
            } else {
                diagnostic?.step = .consume_no_focus
                try StartupAXFiles.need(observed.focus == nil && field == nil)
            }
            if let request {
                if observed.interaction == nil { pause(); continue }
                diagnostic?.step = .consume_proof_presence
                guard let proof = observed.interaction else { throw StartupAXReceiptError.invalid }
                diagnostic?.step = .consume_proof_binding
                try StartupAXFiles.need(proof.request_id == request.id && UUID(uuidString: proof.target_id) != nil
                    && proof.point == request.point && proof.anchor_frame == request.anchor_frame
                    && proof.keyboard == request.keyboard && proof.focus_checked == request.keyboard
                    && began > StartupAXFiles.number(request.entered_ns))
            }
            if expiredPublication {
                if request != nil {
                    diagnostic?.step = .consume_freshness
                    throw StartupAXReceiptError.expired // A request-bound proof is held, never republished.
                }
                pause(); continue // Only an otherwise fully validated positive may await publication.
            }
            let consumed = try time(diagnostic: diagnostic)
            diagnostic?.step = .consume_freshness
            try StartupAXFiles.need(consumed < ticket.deadline && consumed >= ended && consumed - ended <= 1_000_000_000)
            lastSequence = sequence
            lastSurface = observed
            if let request {
                diagnostic?.step = .consume_pending
                try StartupAXFiles.need(pendingInteraction == request && interactions.count < 11)
                let proof = observed.interaction!
                let key = ["field", "message", "panel"].contains(request.kind) ? request.kind : request.kind + ":" + request.label
                diagnostic?.step = .consume_target_identity
                try StartupAXFiles.need(interactionTargets[key] == nil || interactionTargets[key] == proof.target_id)
                interactionTargets[key] = proof.target_id
                interactionProof = proof
                interactions.append(InteractionEvidence(request_id: proof.request_id, target_id: proof.target_id,
                    kind: request.kind, surface: observed.surface, point: proof.point, anchor_frame: proof.anchor_frame,
                    keyboard: proof.keyboard, focus_checked: proof.focus_checked, sequence: receipt.sequence,
                    began_ns: receipt.began_ns, ended_ns: receipt.ended_ns, entered_ns: request.entered_ns,
                    consumed_ns: String(consumed), deadline_ns: request.deadline_ns, finalized_ns: "0"))
                return observed
            }
            diagnostic?.step = .consume_evidence_limit
            try StartupAXFiles.need(evidence.count < 26)
            if actionCompleted {
                try StartupAXFiles.need(pendingInteraction != nil)
                let path = try StartupAXFiles.requestPath(declaration.path)
                try StartupAXFiles.need(try StartupAXInteractionRequest.read(path) == pendingInteraction)
                try StartupAXFiles.need(try StartupAXActionHandoff.read(path + ".handoff") == actionHandoff)
                try StartupAXFiles.need(unlink(path) == 0)
                var armed = actionHandoff!; armed.completed_ns = nil
                while true {
                    let drained = try StartupAXActionHandoff.read(declaration.path + ".handoff")
                    if drained == actionHandoff { break }
                    try StartupAXFiles.need(drained == armed)
                    let stamp = try time()
                    try StartupAXFiles.need(stamp < ticket.deadline && stamp >= ended && stamp - ended <= 1_000_000_000)
                    pause()
                }
                let acknowledged = try time()
                try StartupAXFiles.need(acknowledged < ticket.deadline && acknowledged >= ended && acknowledged - ended <= 1_000_000_000)
                try StartupAXFiles.need(try StartupAXActionHandoff.read(path + ".handoff") == actionHandoff)
                try StartupAXFiles.need(unlink(path + ".handoff") == 0)
                outgoingPublication = observedBytes
                pendingInteraction = nil; actionHandoff = nil; actionCompleted = false
            }
            evidence.append(Evidence(sequence: receipt.sequence, began_ns: receipt.began_ns,
                ended_ns: receipt.ended_ns, entered_ns: String(ticket.entered), consumed_ns: String(consumed),
                surface: observed.surface, root_id: observed.root_id, panel_id: observed.panel_id,
                go_to_id: observed.go_to_id, focus_checked: surface == .goTo))
            return observed
        } } catch { portLost = true; throw error }
    }
}
