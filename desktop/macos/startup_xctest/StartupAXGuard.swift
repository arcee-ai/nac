import Foundation
import CoreFoundation
import CoreGraphics
import ApplicationServices
import Darwin

// BEGIN NATIVE FOLDER POLICY (compiled verbatim with inert projections)
enum StartupNativeFolderPolicy {
    enum Surface: String { case form, panel, goTo }

    static func surface(_ expected: Surface, windows: Int, rootSheets: Int,
                        nestedSheets: Int, allSheets: Int) -> Bool {
        guard windows == 1 else { return false }
        switch expected {
        case .form: return rootSheets == 0 && nestedSheets == 0 && allSheets == 0
        case .panel: return rootSheets == 1 && nestedSheets == 0 && allSheets == 1
        case .goTo: return rootSheets == 1 && nestedSheets == 1 && allSheets == 2
        }
    }

    // Opaque public AX identities in the actor, inert scalar identities in tests.
    // Accepted identities never rebind, even after a panel disappears.
    struct Binding<Token: Equatable> {
        private var root: Token?
        private var panel: Token?
        private var goTo: Token?

        mutating func accept(_ surface: Surface, root candidateRoot: Token,
                             panel candidatePanel: Token?, goTo candidateGoTo: Token?) -> Bool {
            guard root == nil || root == candidateRoot else { return false }
            switch surface {
            case .form:
                guard candidatePanel == nil && candidateGoTo == nil else { return false }
            case .panel:
                guard root != nil, let candidatePanel, candidateGoTo == nil,
                      panel == nil || panel == candidatePanel else { return false }
            case .goTo:
                guard let candidatePanel, let candidateGoTo, panel == candidatePanel,
                      goTo == nil || goTo == candidateGoTo else { return false }
            }
            root = candidateRoot
            if let candidatePanel { panel = candidatePanel }
            if let candidateGoTo { goTo = candidateGoTo }
            return true
        }
    }

    // Attachment stays valid while a Go to Folder sub-sheet obscures its parent.
    // Interaction state is checked separately by usable, not by this geometry guard.
    static func attached(exists: Bool, frame: CGRect, owner: CGRect) -> Bool {
        let numbers = [frame.minX, frame.minY, frame.width, frame.height,
                       owner.minX, owner.minY, owner.width, owner.height]
        return exists && numbers.allSatisfy { $0.isFinite }
            && !frame.isInfinite && !owner.isInfinite
            && frame.size.width > 0 && frame.size.height > 0 && owner.size.width > 0 && owner.size.height > 0
            && frame.intersects(owner)
    }

    static func usable(exists: Bool, enabled: Bool, hittable: Bool,
                       frame: CGRect, owner: CGRect) -> Bool {
        enabled && hittable && attached(exists: exists, frame: frame, owner: owner)
    }

    static func focused(pid: Int32, expectedPID: Int32, role: String, focused: Bool,
                        frame: CGRect, expectedFrame: CGRect, value: String,
                        expectedValue: String) -> Bool {
        pid > 0 && pid == expectedPID && role == "AXTextField" && focused
            && usable(exists: true, enabled: true, hittable: true, frame: frame, owner: expectedFrame)
            && frame == expectedFrame && value == expectedValue
    }

    static func selected(_ label: String, workspace: String) -> Bool {
        label == "Choose Working Folder: " + workspace
    }
}
// END NATIVE FOLDER POLICY

// BEGIN INTERACTION POLICY (same algorithm, inert value ports in controls)
enum StartupInteractionPolicy {
    struct Binding<Token: Equatable> {
        private var id: String?
        private var target: Token?
        mutating func accept(_ request: String, target candidate: Token) -> Bool {
            guard id != request || target == candidate else { return false }
            id = request; target = candidate; return true
        }
    }
    struct Targets<Token: Equatable> {
        private var values: [String: Token] = [:]
        mutating func accept(_ key: String, target: Token) -> Bool {
            guard values.count < 11 || values[key] != nil, values[key] == nil || values[key] == target else { return false }
            values[key] = target; return true
        }
    }
    static func unchanged(point: CGPoint, expected: CGPoint, anchor: CGRect, expectedAnchor: CGRect,
                          root: CGRect, expectedRoot: CGRect) -> Bool {
        [point.x, point.y].allSatisfy { $0.isFinite } && point == expected
            && anchor == expectedAnchor && root == expectedRoot && anchor.contains(point)
    }
    static func target<Token: Equatable>(hit: Token, owner: Token, pid: Int32, anchor: CGRect,
        roles: Set<String>, label: String?, project: (Token) throws -> (Int32, String, CGRect, String?),
        parent: (Token) throws -> Token?) throws -> Token {
        var node = hit, visited: [Token] = [], matches: [Token] = []
        for _ in 0..<32 {
            try StartupAXFiles.need(!visited.contains(node)); visited.append(node)
            let fact = try project(node)
            try StartupAXFiles.need(fact.0 == pid && pid > 0)
            if roles.contains(fact.1) && fact.2 == anchor && (label == nil || fact.3 == label) { matches.append(node) }
            if node == owner {
                try StartupAXFiles.need(matches.count == 1)
                return matches[0]
            }
            guard let next = try parent(node) else { throw StartupAXReceiptError.refused }
            node = next
        }
        throw StartupAXReceiptError.refused
    }
}
// END INTERACTION POLICY

// BEGIN AX REFUSAL (inert extracted-source controls; never grants acceptance)
struct StartupAXRefusal {
    private(set) var first: [String: Any]?
    private(set) var terminal: [String: Any]?

    private func geometry(_ frame: CGRect) -> [Any] {
        [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height].map {
            $0.isFinite ? NSNumber(value: Double($0)) : NSNull()
        }
    }

    mutating func note(_ stage: String, attribute: String? = nil, code: Int32? = nil,
                       count: Int? = nil, frame: CGRect? = nil, expected: CGRect? = nil) {
        guard first == nil else { return }
        var fact: [String: Any] = ["stage": stage]
        if let attribute { fact["attribute"] = attribute }
        if let code { fact["api_code"] = Int(code) }
        if let count { fact["count"] = count }
        if let frame { fact["frame"] = geometry(frame) }
        if let expected { fact["expected_frame"] = geometry(expected) }
        first = fact
    }

    mutating func stop(_ stage: String, count: Int? = nil) {
        note(stage, count: count)
        guard terminal == nil else { return }
        terminal = ["stage": stage]
        if let count { terminal?["count"] = count }
    }

    func record(binding: [String: Any]) -> [String: Any]? {
        guard let first, let terminal else { return nil }
        var result = binding
        result["schema"] = "nac342-ax-refusal-v1"
        result["first_observed_refusal"] = first
        result["terminal_refusal"] = terminal
        result["acceptance"] = false
        guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
              data.count <= 8192 else { return nil }
        return result
    }
}
// END AX REFUSAL

// BEGIN AX IDENTITY
struct StartupAXIdentity: Equatable {
    let element: CFTypeRef
    static func == (left: Self, right: Self) -> Bool { CFEqual(left.element, right.element) }
}
// END AX IDENTITY

final class StartupAXReader {
    private typealias AXIdentity = StartupAXIdentity

    private var axRefusal = StartupAXRefusal()
    private var readDeadline: UInt64 = UInt64.max
    private var persistent = StartupNativeFolderPolicy.Binding<AXIdentity>()
    private let rootID = UUID().uuidString, panelID = UUID().uuidString, goToID = UUID().uuidString
    private var projected: (StartupNativeFolderPolicy.Surface, AXUIElement, AXUIElement?, AXUIElement?)?
    var failureData: Data? { axRefusal.record(binding: [:]).flatMap { try? JSONSerialization.data(withJSONObject: $0) } }
    private func timeout(_ element: AXUIElement) -> AXError {
        let stamp = DispatchTime.now().uptimeNanoseconds
        guard stamp < readDeadline else { return .cannotComplete }
        return AXUIElementSetMessagingTimeout(element, min(1, Float(readDeadline - stamp) / 1e9))
    }

    private func axRead(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let timeout = timeout(element)
        guard timeout == .success else {
            axRefusal.note("attribute_timeout", attribute: name, code: timeout.rawValue); return nil
        }
        let status = AXUIElementCopyAttributeValue(element, name as CFString, &value)
        guard status == .success else {
            axRefusal.note("attribute_error", attribute: name, code: status.rawValue); return nil
        }
        guard DispatchTime.now().uptimeNanoseconds < readDeadline else {
            axRefusal.note("attribute_timeout", attribute: name, code: AXError.cannotComplete.rawValue); return nil
        }
        if value == nil { axRefusal.note("attribute_missing", attribute: name) }
        return value
    }

    private func axElements(_ element: AXUIElement, _ name: String) -> [AXUIElement]? {
        guard let raw = axRead(element, name) else { return nil }
        guard let values = raw as? [AnyObject] else {
            axRefusal.note("elements_type", attribute: name); return nil
        }
        guard values.count <= 128 else {
            axRefusal.note("elements_count", attribute: name, count: values.count); return nil
        }
        guard values.allSatisfy({ CFGetTypeID($0) == AXUIElementGetTypeID() }) else {
            axRefusal.note("elements_member_type", attribute: name); return nil
        }
        return values.map { $0 as! AXUIElement }
    }

    private func axFrame(_ element: AXUIElement) -> CGRect? {
        guard let position = axRead(element, kAXPositionAttribute), let size = axRead(element, kAXSizeAttribute) else { return nil }
        guard CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else {
            axRefusal.note("frame_value_type"); return nil
        }
        let p = position as! AXValue, s = size as! AXValue
        var point = CGPoint.zero, dimensions = CGSize.zero
        guard AXValueGetType(p) == .cgPoint, AXValueGetType(s) == .cgSize else {
            axRefusal.note("frame_encoding"); return nil
        }
        guard AXValueGetValue(p, .cgPoint, &point) else {
            axRefusal.note("frame_position_decode"); return nil
        }
        guard AXValueGetValue(s, .cgSize, &dimensions) else {
            axRefusal.note("frame_size_decode"); return nil
        }
        return CGRect(origin: point, size: dimensions)
    }

    // Select the exact root, then only its direct public AXSheet children.
    // Public AX handles pin sheet incarnations; a fresh same-shaped panel is
    // not a continuation of this picker. Unsupported hierarchy fails closed.
    // Diagnostics use only these original reads; no post-refusal AX polling.
    private func axSurface(_ surface: StartupNativeFolderPolicy.Surface?, pid: pid_t, frame: CGRect,
                           binding: inout StartupNativeFolderPolicy.Binding<AXIdentity>) -> AXUIElement? {
        axRefusal = StartupAXRefusal()
        let app = AXUIElementCreateApplication(pid)
        let timeout = timeout(app)
        guard timeout == .success else {
            axRefusal.note("application_timeout", code: timeout.rawValue)
            axRefusal.stop("application_timeout"); return nil
        }
        guard let windows = axElements(app, kAXWindowsAttribute) else {
            axRefusal.stop("windows_unavailable"); return nil
        }
        let roots = windows.filter {
            guard axRead($0, kAXRoleAttribute) as? String == "AXWindow" else {
                axRefusal.note("root_role_or_type"); return false
            }
            guard let observed = axFrame($0) else { return false }
            guard observed == frame else {
                axRefusal.note("root_frame_mismatch", frame: observed, expected: frame); return false
            }
            return true
        }
        guard roots.count == 1 else {
            axRefusal.stop("root_matches", count: roots.count); return nil
        }
        let root = roots[0]
        func sheets(_ owner: AXUIElement) -> [AXUIElement]? {
            guard let children = axElements(owner, kAXChildrenAttribute) else { return nil }
            var result: [AXUIElement] = []
            for child in children {
                guard let role = axRead(child, kAXRoleAttribute) as? String else {
                    axRefusal.note("child_role_type"); return nil
                }
                if role == "AXSheet" { result.append(child) }
            }
            return result
        }
        guard let rootSheets = sheets(root) else { axRefusal.stop("root_children"); return nil }
        guard rootSheets.count <= 1 && (surface == nil || rootSheets.count == (surface == .form ? 0 : 1)) else {
            axRefusal.stop("root_sheet_count", count: rootSheets.count); return nil
        }
        let panel = rootSheets.first
        let nested: [AXUIElement]
        if let panel {
            guard let children = sheets(panel) else { axRefusal.stop("panel_children"); return nil }
            nested = children
        } else { nested = [] }
        guard nested.count <= 1 && (surface == nil || nested.count == (surface == .goTo ? 1 : 0)) else {
            axRefusal.stop("nested_sheet_count", count: nested.count); return nil
        }
        let goTo = nested.first
        let allowed = [root, panel, goTo].compactMap { $0 }
        for element in allowed {
            var owner: pid_t = 0
            let status = AXUIElementGetPid(element, &owner)
            guard status == .success && owner == pid else {
                axRefusal.note(status == .success ? "pid_mismatch" : "pid_error", code: status.rawValue)
                axRefusal.stop("owned_pid"); return nil
            }
        }
        guard windows.allSatisfy({ window in allowed.contains { CFEqual(window, $0) } }) else {
            axRefusal.stop("foreign_window"); return nil
        }
        let actual = surface ?? (panel == nil ? .form : goTo == nil ? .panel : .goTo)
        guard binding.accept(actual, root: AXIdentity(element: root),
            panel: panel.map { AXIdentity(element: $0) }, goTo: goTo.map { AXIdentity(element: $0) }) else {
            axRefusal.stop("incarnation_binding"); return nil
        }
        projected = (actual, root, panel, goTo)
        return goTo ?? panel ?? root
    }

    // Public, read-only AX probe scoped to the already admitted app PID. No
    // actions, attribute writes, trust prompts, KVC or private XCTest attributes.
    // macOS has no public XCUIElement.hasFocus property. Missing AX admission,
    // unsupported attributes or a different focused element fail closed.
    private func focusedGoToField(pid: pid_t, sheet: AXUIElement) -> StartupAXFocus? {
        let app = AXUIElementCreateApplication(pid)
        guard timeout(app) == .success,
              let value = axRead(app, kAXFocusedUIElementAttribute),
              CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        let focused = value as! AXUIElement
        var owner: pid_t = 0
        guard AXUIElementGetPid(focused, &owner) == .success,
              let role = axRead(focused, kAXRoleAttribute) as? String,
              let flag = axRead(focused, kAXFocusedAttribute) as? NSNumber,
              CFGetTypeID(flag) == CFBooleanGetTypeID(),
              let text = axRead(focused, kAXValueAttribute) as? String,
              let frame = axFrame(focused) else { return nil }
        var ancestor = focused, attached = false
        for _ in 0..<16 {
            if CFEqual(ancestor, sheet) { attached = true; break }
            guard let parent = axRead(ancestor, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
            let next = parent as! AXUIElement
            if CFEqual(next, ancestor) { break }
            ancestor = next
        }
        guard attached && text.utf8.count <= 4096,
              StartupNativeFolderPolicy.focused(pid: owner, expectedPID: pid, role: role,
                focused: flag.boolValue, frame: frame, expectedFrame: frame, value: text, expectedValue: text) else { return nil }
        return StartupAXFocus(pid: owner, role: role, focused: flag.boolValue, attached: attached,
            frame: [frame.minX, frame.minY, frame.width, frame.height], value: text)
    }

    private var inputTargets = StartupInteractionPolicy.Targets<AXIdentity>()
    private var interactionBinding = StartupInteractionPolicy.Binding<AXIdentity>()
    private var inputTargetIDs: [String: String] = [:]

    // Global z-order query, never app-scoped: foreign occluders must be seen.
    private func hitTarget(_ request: StartupAXInteractionRequest, pid: pid_t) throws -> AXUIElement {
        guard let projected, projected.0.rawValue == request.surface, request.root_id == rootID else {
            throw StartupAXReceiptError.refused
        }
        let rootFrame = try StartupAXFiles.frame(request.root_frame)
        guard axFrame(projected.1) == rootFrame else { throw StartupAXReceiptError.refused }
        let owner = projected.3 ?? projected.2 ?? projected.1
        let anchor = try StartupAXFiles.frame(request.anchor_frame)
        let point = CGPoint(x: request.point[0], y: request.point[1])
        let system = AXUIElementCreateSystemWide()
        guard timeout(system) == .success else { throw StartupAXReceiptError.refused }
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
              let hit else { throw StartupAXReceiptError.refused }
        let roles: [String: Set<String>] = ["button": ["AXButton"], "message": ["AXTextArea", "AXTextField"],
            "panel": ["AXSheet"], "field": ["AXTextField"]]
        let target = try StartupInteractionPolicy.target(hit: AXIdentity(element: hit),
            owner: AXIdentity(element: owner), pid: pid, anchor: anchor, roles: roles[request.kind]!,
            label: ["button", "message"].contains(request.kind) ? request.label : nil, project: { token in
                let node = token.element as! AXUIElement
                var actual: pid_t = 0
                guard AXUIElementGetPid(node, &actual) == .success,
                      let role = self.axRead(node, kAXRoleAttribute) as? String else { throw StartupAXReceiptError.refused }
                let frame = roles[request.kind]!.contains(role) ? self.axFrame(node) : CGRect.zero
                guard let frame else { throw StartupAXReceiptError.refused }
                var label: String?
                if roles[request.kind]!.contains(role) && ["button", "message"].contains(request.kind) {
                    let title = self.axRead(node, kAXTitleAttribute) as? String
                    label = title == request.label ? title : self.axRead(node, kAXDescriptionAttribute) as? String
                }
                return (actual, role, frame, label)
            }, parent: { token in
                guard let raw = self.axRead(token.element as! AXUIElement, kAXParentAttribute),
                      CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
                return AXIdentity(element: raw)
            }).element as! AXUIElement
        if request.keyboard {
            let app = AXUIElementCreateApplication(pid)
            guard let raw = axRead(app, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else {
                throw StartupAXReceiptError.refused
            }
            let focus = raw as! AXUIElement
            var focusedPID: pid_t = 0
            guard AXUIElementGetPid(focus, &focusedPID) == .success, focusedPID == pid,
                  let flag = axRead(focus, kAXFocusedAttribute) as? NSNumber,
                  CFGetTypeID(flag) == CFBooleanGetTypeID(), flag.boolValue else { throw StartupAXReceiptError.refused }
            if request.kind == "panel" {
                var ancestor = focus, attached = false
                for _ in 0..<16 {
                    var ancestorPID: pid_t = 0
                    guard AXUIElementGetPid(ancestor, &ancestorPID) == .success, ancestorPID == pid else { break }
                    if CFEqual(ancestor, target) { attached = true; break }
                    guard let raw = axRead(ancestor, kAXParentAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { break }
                    let next = raw as! AXUIElement
                    if CFEqual(next, ancestor) { break }
                    ancestor = next
                }
                guard attached else { throw StartupAXReceiptError.refused }
            } else {
                guard CFEqual(focus, target), let expected = request.value,
                      axRead(focus, kAXValueAttribute) as? String == expected else { throw StartupAXReceiptError.refused }
            }
        }
        guard DispatchTime.now().uptimeNanoseconds < readDeadline else { throw StartupAXReceiptError.expired }
        return target
    }
    func interaction(_ request: StartupAXInteractionRequest, pid: pid_t) throws -> StartupAXInteraction {
        try request.validate()
        let target = try hitTarget(request, pid: pid)
        let key = ["field", "message", "panel"].contains(request.kind) ? request.kind : request.kind + ":" + request.label
        guard inputTargets.accept(key, target: AXIdentity(element: target)),
              interactionBinding.accept(request.id, target: AXIdentity(element: target)) else { throw StartupAXReceiptError.refused }
        if inputTargetIDs[key] == nil { inputTargetIDs[key] = UUID().uuidString }
        return StartupAXInteraction(request_id: request.id, target_id: inputTargetIDs[key]!,
            point: request.point, anchor_frame: request.anchor_frame, keyboard: request.keyboard, focus_checked: request.keyboard)
    }

    func observe(pid: pid_t, frame: CGRect) throws -> StartupAXSurface {
        readDeadline = DispatchTime.now().uptimeNanoseconds + 1_000_000_000
        projected = nil
        var binding = persistent
        let selected = axSurface(nil, pid: pid, frame: frame, binding: &binding)
        persistent = binding
        guard let sheet = selected, let projected else {
            throw StartupAXReceiptError.refused
        }
        let focus = projected.0 == .goTo ? focusedGoToField(pid: pid, sheet: sheet) : nil
        guard (projected.0 != .goTo || focus != nil), DispatchTime.now().uptimeNanoseconds < readDeadline else {
            axRefusal.stop("focus_unavailable")
            throw StartupAXReceiptError.refused
        }
        return StartupAXSurface(surface: projected.0.rawValue, root_id: rootID,
            panel_id: projected.2 == nil ? nil : panelID, go_to_id: projected.3 == nil ? nil : goToID,
            root_frame: [frame.minX, frame.minY, frame.width, frame.height], focus: focus)
    }
}
