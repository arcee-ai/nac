import AppKit

/// A cancellable sheet on the current workspace window. No bookmarks,
/// credential copies, directory creation or filesystem grants are produced.
@MainActor
final class NativeFolderPanel {
    private let selection = NativeFolderSelection()
    private var panel: NSOpenPanel?
    private var request: UUID?
    private var completion: ((String?) -> Void)?
    private var current: (() -> Bool)?

    @discardableResult
    func choose(in window: NSWindow, initialPath: String, current: @escaping () -> Bool,
                completion: @escaping (String?) -> Void) -> UUID? {
        cancel()
        guard current(), let token = selection.begin() else { return nil }
        let panel = NSOpenPanel()
        panel.title = "Select Working Folder"
        panel.prompt = "Select"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = false
        panel.allowsMultipleSelection = false
        panel.resolvesAliases = false
        if NativeFolderSelection.validPath(initialPath) {
            panel.directoryURL = URL(fileURLWithPath: initialPath, isDirectory: true)
        }
        self.panel = panel
        request = token
        self.completion = completion
        self.current = current
        panel.beginSheetModal(for: window) { [weak self, weak panel] response in
            self?.settle(token, url: response == .OK ? panel?.url : nil)
        }
        return token
    }

    private func settle(_ token: UUID, url: URL?) {
        guard selection.complete(token, current: true) else { return }
        let finish = completion
        let isCurrent = current
        completion = nil
        current = nil
        request = nil
        panel = nil
        guard isCurrent?() == true else { finish?(nil); return }
        guard let url, url.isFileURL, NativeFolderSelection.validPath(url.path) else { finish?(nil); return }
        // A moved/missing selection is reported as cancellation. Rust still
        // validates the path again when the user submits the project.
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &directory),
              directory.boolValue else { finish?(nil); return }
        finish?(url.path)
    }

    #if PREVIEW_SMOKE
    /// Startup smoke only: settles the real open sheet as a person choosing
    /// `path` in it, through the same currency, path and directory checks.
    /// XCTest's NativePathJourney covers clicks inside the panel itself.
    func smokeChoose(_ path: String) -> Bool {
        guard let request, let panel, panel.sheetParent != nil else { return false }
        settle(request, url: URL(fileURLWithPath: path, isDirectory: true))
        // The sheet's own handler then finds the request settled and returns.
        if let parent = panel.sheetParent { parent.endSheet(panel, returnCode: .cancel) }
        panel.orderOut(nil)
        return true
    }
    #endif

    func cancel(_ expected: UUID? = nil) {
        guard let request, expected == nil || expected == request else { return }
        selection.cancel(request)
        let panel = self.panel
        let finish = completion
        self.request = nil
        self.panel = nil
        completion = nil
        current = nil
        if let parent = panel?.sheetParent, let panel { parent.endSheet(panel, returnCode: .cancel) }
        panel?.orderOut(nil)
        finish?(nil)
    }

    func retire() { selection.retire(); cancel() }
}
