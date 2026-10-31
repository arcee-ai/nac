#if PREVIEW_SMOKE && !LOCAL_APP
import AppKit
import WebKit

/// Actual app/system-WK delegate characterization with an explicit recording
/// opener. No OS input is synthesized and no external browser is invoked.
@MainActor
final class ExternalNavigationSmoke {
    private unowned let app: PreviewApp
    private let checkpoint: () -> Void
    private var diagnostics: [[String: Any]] = []
    init(app: PreviewApp, checkpoint: @escaping () -> Void) { self.app = app; self.checkpoint = checkpoint }

    static func installObserver(in view: WKWebView) {
        let source = #"""
        (()=>{
          const state=window.__nacPagePopupObservation={installed:true,requested:false,done:false,calls:0,
            supported:!!navigator.userActivation,activeAtFire:null,stickyAtFire:null,returnedNull:null};
          addEventListener('nac-recording-page-popup',()=>{
            if(state.requested)return;state.requested=true;
            let observations=0;
            const attempt=()=>{
              const activation=navigator.userActivation;
              if(!activation || observations++>=200){state.done=true;return}
              if(activation.isActive){setTimeout(attempt,25);return}
              state.activeAtFire=activation.isActive;state.stickyAtFire=activation.hasBeenActive;
              state.calls++;state.returnedNull=window.open('https://example.invalid/page-owned-popup')===null;
              state.done=true;
            };
            // The popup executes on a page-owned timer, outside the native API
            // evaluation stack. Inactivity is observed, never assumed from time.
            setTimeout(attempt,0);
          });
        })();
        """#
        view.configuration.userContentController.addUserScript(WKUserScript(
            source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }

    func run() async throws -> [String: Any] {
        try await wait("verified loaded workspace") { self.app.commands.currentDocument(in: self.app.webView) != nil }
        try await wait("production create-chat control") {
            try await self.js("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Create chat'&&!b.disabled)") as? Bool == true
        }
        _ = try await js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Create chat').click();return true")
        _ = try await js("document.querySelector('[role=dialog] button[aria-label=Close]')?.click();return true")
        try await wait("closed initial create-chat dialog") {
            try await self.js("return !document.querySelector('[role=dialog]')") as? Bool == true
        }
        try await wait("current live document") { self.app.commands.currentDocument(in: self.app.webView) != nil }
        let expected = app.commands.currentDocument(in: app.webView)!
        let origin = app.baseURL!
        try record("loaded", expected: expected, origin: origin)
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
        try record("first-main-link", expected: expected, origin: origin)
        let beforeNativePopup = actions.count
        let beforeNativeEvaluations = otherPopupEvaluations.count
        let nativeContext = try await js("const a=navigator.userActivation;return {supported:!!a,isActive:a?.isActive??null,hasBeenActive:a?.hasBeenActive??null,returnedNull:window.open('https://example.invalid/native-api-popup')===null}") as? [String: Any] ?? [:]
        try await wait("native API-context popup delivered to policy") {
            self.otherPopupEvaluations.count > beforeNativeEvaluations
        }
        try record("native-api-popup-context", expected: expected, origin: origin, activation: nativeContext)
        guard actions.count == beforeNativePopup,
              otherPopupEvaluations.dropFirst(beforeNativeEvaluations).allSatisfy({ $0["admitted"] as? Bool == false }) else {
            throw PreviewError.message("Native API-context other popup reached the opener")
        }
        let beforePagePopup = actions.count
        let beforePageEvaluations = otherPopupEvaluations.count
        _ = try await js("if(!window.__nacPagePopupObservation?.installed)throw new Error('observer');dispatchEvent(new Event('nac-recording-page-popup'));return true")
        try await wait("page-owned popup observation") {
            try await self.js("return window.__nacPagePopupObservation.done") as? Bool == true
        }
        let pageContext = try await js("const s=window.__nacPagePopupObservation;return {supported:s.supported,isActive:s.activeAtFire,hasBeenActive:s.stickyAtFire,calls:s.calls,returnedNull:s.returnedNull}") as? [String: Any] ?? [:]
        try record("page-owned-popup-observation", expected: expected, origin: origin, activation: pageContext)
        guard pageContext["supported"] as? Bool == true, pageContext["isActive"] as? Bool == false,
              pageContext["calls"] as? Int == 1 else {
            throw PreviewError.message("Page-owned nonactivated popup negative coverage unavailable")
        }
        try await wait("page-owned inactive popup delivered to policy") {
            self.otherPopupEvaluations.count > beforePageEvaluations
        }
        try record("page-owned-popup-context", expected: expected, origin: origin, activation: pageContext)
        guard actions.count == beforePagePopup,
              otherPopupEvaluations.dropFirst(beforePageEvaluations).allSatisfy({ $0["admitted"] as? Bool == false }) else {
            throw PreviewError.message("Page-owned inactive other popup reached the opener")
        }
        _ = try await js("location.assign('https://example.invalid/script');return true")
        _ = try await js(#"""
        const frame=document.createElement('iframe');frame.id='external-navigation-child-fixture';
        document.body.append(frame);
        if(frame.contentWindow.origin!==window.origin)throw new Error('Child fixture has wrong origin');
        frame.contentWindow.eval("const a=document.createElement('a');a.href='https://example.invalid/subframe';a.target='_top';document.body.append(a);a.click()");
        return true;
        """#)
        let mainLinks = actions.filter { $0["popup"] as? Bool == false }.count
        try await link(target: "_self")
        try await wait("positive control after script and subframe negatives") {
            self.actions.filter { $0["popup"] as? Bool == false }.count > mainLinks
        }
        let evaluations = app.commands.smokeExternalNavigation["evaluations"] as? [[String: Any]] ?? []
        guard evaluations.contains(where: { $0["source_main_frame"] as? Bool == false &&
            $0["navigation_type"] as? Int == WKNavigationType.linkActivated.rawValue && $0["admitted"] as? Bool == false }) else {
            throw PreviewError.message("Actual child-frame navigation did not reach the rejection policy")
        }
        _ = try await js("document.getElementById('external-navigation-child-fixture').remove();return true")
        try record("post-negative", expected: expected, origin: origin)
        guard actions.count == beforePagePopup + 1 else {
            throw PreviewError.message("Page-owned/script/subframe negative admitted an extra external action")
        }
        guard app.commands.currentDocument(in: app.webView) == expected else {
            throw PreviewError.message("Post-negative current-document correlation differed")
        }
        guard app.webView.url?.scheme == origin.scheme, app.webView.url?.host == origin.host,
              app.webView.url?.port == origin.port else { throw PreviewError.message("Post-negative origin differed") }

        // Exercise the real shared header anchor. DOM driving establishes a
        // navigation category, never trusted physical input.
        let beforeBlank = actions.count
        _ = try await js("document.querySelector('button[aria-label=\"Open the menu\"]')?.click();return true")
        try await wait("rendered shared external anchor") {
            try await self.js("const a=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='See docs');return !!a&&a.target==='_blank'&&a.getBoundingClientRect().width>0&&a.getBoundingClientRect().height>0") as? Bool == true
        }
        _ = try await js("[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='See docs').click();return true")
        try await wait("one rendered target-blank link action") { self.actions.count > beforeBlank }
        try record("rendered-target-blank-link", expected: expected, origin: origin)
        guard actions.count == beforeBlank + 1, actions.last?["popup"] as? Bool == true,
              actions.last?["navigation_type"] as? Int == WKNavigationType.linkActivated.rawValue else {
            throw PreviewError.message("Rendered target-blank link did not open exactly once")
        }
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
                "physical_input_qualified": false, "page_owned_nonactivated_popup_blocked": true,
                "native_api_other_popup_delivered_and_blocked": true, "rendered_target_blank_link_recorded": true,
                "main_frame_link_recorded": true, "subframe_and_script_rejected": true,
                "synthetic_popup_observations": popupCount, "reload_rebound_document": true,
                "foreign_view_rejected": true, "retirement_current_document_nil": true, "navigation": final]
    }

    private var actions: [[String: Any]] { app.commands.smokeExternalNavigation["actions"] as? [[String: Any]] ?? [] }
    private var otherPopupEvaluations: [[String: Any]] {
        let values = app.commands.smokeExternalNavigation["evaluations"] as? [[String: Any]] ?? []
        return values.filter { $0["popup"] as? Bool == true && $0["source_main_frame"] as? Bool == true &&
            $0["navigation_type"] as? Int == WKNavigationType.other.rawValue }
    }

    /// Only fixed labels, bounded native classifications and booleans leave
    /// this fixture. No document contents, destinations or callback values.
    private func record(_ phase: String, expected: NativeDocumentBinding, origin: URL, activation: [String: Any] = [:]) throws {
        let binding = app.commands.currentDocument(in: app.webView)
        let value: [String: Any] = ["phase": phase, "action_count": actions.count,
            "current_document_present": binding != nil, "same_document": binding == expected,
            "same_scheme": app.webView.url?.scheme == origin.scheme,
            "same_host": app.webView.url?.host == origin.host, "same_port": app.webView.url?.port == origin.port,
            "application_active": NSApp.isActive, "window_key": app.window.isKeyWindow,
            "window_visible": app.window.isVisible, "window_minimized": app.window.isMiniaturized,
            "webview_hidden": app.webView.isHidden, "navigation": app.commands.smokeExternalNavigation,
            "system_browser_qualified": false, "physical_input_qualified": false, "public_activation": activation]
        guard diagnostics.count < 16 else { throw PreviewError.message("Recording fixture diagnostic bound exceeded") }
        diagnostics.append(value)
        let args = CommandLine.arguments
        guard let index = args.firstIndex(of: "--smoke-output"), index + 1 < args.count else {
            throw PreviewError.message("Recording fixture output unavailable")
        }
        let output = URL(fileURLWithPath: args[index + 1]).deletingLastPathComponent()
            .appendingPathComponent("external-navigation-diagnostics.json")
        try JSONSerialization.data(withJSONObject: ["stages": diagnostics], options: [.prettyPrinted, .sortedKeys])
            .write(to: output, options: .atomic)
    }

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
