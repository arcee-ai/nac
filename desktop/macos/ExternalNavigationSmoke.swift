#if PREVIEW_SMOKE && !LOCAL_APP
import AppKit
import WebKit

/// Actual app/system-WK delegate characterization with an explicit recording
/// opener. No OS input is synthesized and no external browser is invoked.
@MainActor
final class ExternalNavigationSmoke {
    private unowned let app: PreviewApp
    private let checkpoint: () -> Void
    init(app: PreviewApp, checkpoint: @escaping () -> Void) { self.app = app; self.checkpoint = checkpoint }

    func run() async throws -> [String: Any] {
        try await wait("verified loaded workspace") { self.app.commands.currentDocument(in: self.app.webView) != nil }
        try await wait("production create-chat control") {
            try await self.js("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Create chat'&&!b.disabled)") as? Bool == true
        }
        _ = try await js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Create chat').click();return true")
        try await wait("current live document") { self.app.commands.currentDocument(in: self.app.webView) != nil }
        let expected = app.commands.currentDocument(in: app.webView)!
        let origin = app.baseURL!
        guard app.webView.configuration.preferences.javaScriptCanOpenWindowsAutomatically == false,
              app.commands.smokeExternalNavigation["recording_only"] as? Bool == true else {
            throw PreviewError.message("Recording fixture did not retain the user-interaction popup gate")
        }
        let foreign = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        guard app.commands.currentDocument(in: foreign) == nil else {
            throw PreviewError.message("Read-only document accessor accepted a foreign view")
        }

        try await link(target: "_self")
        try await wait("one external main-frame action recorded") { self.actions.count == 1 }
        guard actions[0]["popup"] as? Bool == false,
              actions[0]["navigation_type"] as? Int == WKNavigationType.linkActivated.rawValue else {
            throw PreviewError.message("Activated external link did not retain its WK navigation classification")
        }
        let blocked = try await js("return window.open('https://example.invalid/automatic') === null") as? Bool
        guard blocked == true else { throw PreviewError.message("Automatic JavaScript popup was not blocked") }
        _ = try await js("location.assign('https://example.invalid/script');return true")
        _ = try await js(#"""
        await new Promise(resolve=>{
          const frame=document.createElement('iframe');
          frame.srcdoc='<a href="https://example.invalid/subframe" target="_top">child</a>';
          frame.onload=()=>{frame.contentDocument.querySelector('a').click();frame.remove();resolve()};
          document.body.append(frame);
        }); return true;
        """#)
        try await link(target: "_self")
        try await wait("positive control after script and subframe negatives") { self.actions.count >= 2 }
        guard actions.count == 2, app.commands.currentDocument(in: app.webView) == expected,
              app.webView.url?.host == origin.host, app.webView.url?.port == origin.port else {
            throw PreviewError.message("Rejected navigation altered the live document or external-opener observations")
        }

        // A synthetic target=_blank click may be blocked by WebKit's gesture
        // gate. Record what the real WK does without claiming physical intent.
        try await link(target: "_blank")
        _ = try await js("return document.readyState")
        let popupCount = actions.filter { $0["popup"] as? Bool == true }.count
        let beforeReload = expected
        let invalidations = app.commands.smokeDocumentInvalidations
        app.webView.reload()
        return try await finish(beforeReload: beforeReload, popupCount: popupCount, invalidations: invalidations)
    }

    private func finish(beforeReload: NativeDocumentBinding, popupCount: Int, invalidations: Int) async throws -> [String: Any] {
        try await wait("replacement document") {
            guard let binding = self.app.commands.currentDocument(in: self.app.webView) else { return false }
            return binding.document != beforeReload.document
        }
        let replacement = app.commands.currentDocument(in: app.webView)!
        guard replacement.launch == beforeReload.launch, replacement.view == beforeReload.view,
              app.commands.smokeDocumentInvalidations > invalidations else {
            throw PreviewError.message("Reload changed launch/view correlation")
        }
        let final = app.commands.smokeExternalNavigation
        guard actions.allSatisfy({ $0["system_opener_invoked"] as? Bool == false }) else {
            throw PreviewError.message("Recording fixture invoked a system browser")
        }
        app.commands.retire()
        guard app.commands.currentDocument(in: app.webView) == nil else { throw PreviewError.message("Retirement retained current document") }
        return ["scope": "actual-app/system-WK; recording-opener-only", "system_browser_qualified": false,
                "physical_input_qualified": false, "automatic_popup_blocked": true,
                "main_frame_link_recorded": true, "subframe_and_script_rejected": true,
                "synthetic_popup_observations": popupCount, "reload_rebound_document": true,
                "foreign_view_rejected": true, "retirement_current_document_nil": true, "navigation": final]
    }

    private var actions: [[String: Any]] { app.commands.smokeExternalNavigation["actions"] as? [[String: Any]] ?? [] }

    private func link(target: String) async throws {
        _ = try await js("const a=document.createElement('a');a.href='https://example.invalid/auth?state=local-fixture';a.target=target;document.body.append(a);a.click();a.remove();return true", arguments: ["target": target])
    }

    private func js(_ script: String, arguments: [String: Any] = [:]) async throws -> Any {
        checkpoint()
        return try await withCheckedThrowingContinuation { continuation in
            var resolved = false
            let timeout = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled, !resolved else { return }
                resolved = true
                continuation.resume(throwing: PreviewError.message("Recording WK fixture evaluation timed out"))
            }
            app.webView.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { result in
                guard !resolved else { return }
                resolved = true
                timeout.cancel()
                switch result {
                case .success(let value): continuation.resume(returning: value)
                case .failure: continuation.resume(throwing: PreviewError.message("Recording WK fixture evaluation failed"))
                }
            }
        }
    }

    private func wait(_ label: String, _ condition: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            checkpoint()
            if let failure = app.failure { throw PreviewError.message(failure) }
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw PreviewError.message("Timed out waiting for \(label)")
    }
}
#endif
