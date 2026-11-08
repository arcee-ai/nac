import AppKit
import WebKit

/// One actual document's disposal. This object never retains its WKWebView.
/// A JavaScript acknowledgement is useful; actual weak release is the barrier.
@MainActor
final class WorkspaceRetirement {
    private weak var view: WKWebView?
    private var released = false
    private let dropOwner: () -> Void
    private let deadline: TimeInterval
    private(set) var acknowledged = false

    init(view: WKWebView?, commands: NativeCommands?, dropOwner: @escaping () -> Void) {
        self.view = view
        self.dropOwner = dropOwner
        deadline = ProcessInfo.processInfo.systemUptime + 3.75
        commands?.retire { [weak self] acknowledged in
            guard let self else { return }
            self.acknowledged = acknowledged
            self.release()
        }
        if commands == nil { release() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) { [weak self] in self?.release() }
    }

    private func release() {
        guard !released else { return }
        released = true
        view?.navigationDelegate = nil
        view?.uiDelegate = nil
        view?.window?.makeFirstResponder(nil)
        view?.stopLoading()
        view?.removeFromSuperview()
        dropOwner()
    }

    func wait() async throws {
        while !released || view != nil {
            try Task.checkCancellation()
            guard ProcessInfo.processInfo.systemUptime < deadline else {
                throw PreviewError.message("The previous workspace is still retiring. Its controls remain disabled.")
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
    }
}
