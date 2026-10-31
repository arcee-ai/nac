#if PREVIEW_SMOKE && TERMINAL_SMOKE
import AppKit

extension TerminalSmoke {
    func outputJourney() async throws {
        checks["exact-value-masking"] = ["status": "unavailable", "detail": "Unmanaged preview has no injected command-environment redaction snapshot; provider model keys are outside that policy. Core masking tests are supplier evidence, not this WK qualification"]
        await check("unicode-osc") {
            try await self.screen("WK-OSC-DONE")
            try await self.require("Unicode, split text or OSC policy failed", #"""
            const text=document.querySelector('.xterm-accessibility-tree').textContent;
            return text.includes('WK-UNICODE: Ω中🙂') && text.includes('WK-SPLIT:literal-fixture-only') &&
              __terminal352.clipboardWrites===0 && __terminal352.inputPosts===0;
            """#)
            try await self.snapshot("initial-output")
            return "Current xterm accessibility screen decoded UTF-8 and split literal output; OSC52/query replies caused zero clipboard write attempts or input POSTs. Visible paint remains separate"
        }
        await check("synthetic-input-denied") {
            _ = try await self.js(#"""
            const t=document.querySelector('.xterm-helper-textarea'); t.focus();
            t.dispatchEvent(new KeyboardEvent('keydown',{key:'x',code:'KeyX',bubbles:true}));
            t.dispatchEvent(new CompositionEvent('compositionstart',{data:'中',bubbles:true}));
            t.value='中';t.dispatchEvent(new InputEvent('input',{data:'中',inputType:'insertCompositionText',bubbles:true}));
            t.dispatchEvent(new CompositionEvent('compositionend',{data:'中',bubbles:true}));
            const data=new DataTransfer();data.setData('text/plain','MUST-NOT-WRITE');
            t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
            return true;
            """#)
            // A scheduled task drains composition timers; no trusted event is manufactured.
            try await Task.sleep(nanoseconds: 100_000_000)
            try await self.require("Synthetic input acquired authority", "return __terminal352.inputPosts===0 && __terminal352.events.length>=4 && __terminal352.events.every(e=>!e.trusted);")
            self.record(["input_provenance": try await self.js("return __terminal352.events;")])
            return "Synthetic keyboard/paste/composition caused zero input POSTs; native trust gates unchanged"
        }
        await check("alternate-screen-output") {
            defer { try? self.trigger("normal") }
            try self.trigger("alternate")
            try await self.acknowledged("WK-ALT-SCREEN")
            try self.trigger("normal")
            try await self.acknowledged("WK-NORMAL-SCREEN")
            self.checks["alternate-parser-completion"] = ["status": "pass", "detail": "Actual WK xterm consumed the alternate and restored-screen marker frames before the production client sent their accepted cursor ACKs"]
            try self.requirePainting("Alternate-screen display")
            // Re-enter only after the first parser roundtrip and require the
            // current accessible screen, never its historical live region.
            try self.trigger("alternate")
            try await self.screen("WK-ALT-SCREEN")
            try await self.snapshot("alternate-screen")
            try self.trigger("normal")
            try await self.screen("WK-NORMAL-SCREEN")
            try await self.require("Primary screen lost", "return document.querySelector('.xterm-accessibility-tree').textContent.includes('WK-UNICODE:');")
            return "Owned shell output entered and left alternate screen; this is parser output evidence, not full-screen keyboard qualification"
        }
        await check("view-lifetime-retention") {
            for _ in 0..<4 {
                try await self.button("Hide panel")
                try await self.button("Show panel")
                try await self.navigate("files")
                try await self.waitJS("terminal unmounted", "return !document.querySelector('.xterm-helper-textarea');")
                try await self.navigate("terminal")
                try await self.screen("WK-UNICODE:")
            }
            try await self.require("View replacement replayed input", "return __terminal352.inputPosts===0;")
            return "Four hide/reopen and full route unmount/remount cycles retained shell output with zero input POSTs"
        }
        await check("controller-replacement") {
            try await self.button("Terminal options")
            try await self.button("Give Agent Control")
            try await self.waitJS("agent control", "return document.querySelector('[aria-label=\"Input controller\"]')?.textContent==='Input: Agent';")
            try await self.navigate("files")
            try await self.navigate("terminal")
            try await self.screen("WK-UNICODE:")
            try await self.button("Terminal options")
            try await self.button("Reclaim Input")
            try await self.waitJS("human control", "return document.querySelector('[aria-label=\"Input controller\"]')?.textContent==='Input: Human';")
            try await self.require("Control transition injected bytes", "return __terminal352.controls===2 && __terminal352.inputPosts===0;")
            return "Explicit production Give/Reclaim actions across controller replacement sent no input bytes"
        }
        await check("overflow-gap-reset") {
            try await self.navigate("files")
            try await self.waitJS("observer unmounted", "return !document.querySelector('.xterm-helper-textarea');")
            try self.trigger("overflow")
            let profile = self.app.profile!
            let end = Date().addingTimeInterval(30)
            while !FileManager.default.fileExists(atPath: profile.workspace.appendingPathComponent("wk-overflow.done").path) && Date() < end {
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            guard FileManager.default.fileExists(atPath: profile.workspace.appendingPathComponent("wk-overflow.done").path) else { throw PreviewError.message("Overflow producer did not complete") }
            try await self.navigate("terminal")
            try await self.acknowledged("WK-RETAINED-TAIL")
            try await self.require("Retention gap/reset not observed", "return document.body.innerText.includes('Earlier output was discarded') && __terminal352.gapFrames>0 && __terminal352.resetAcks>0 && __terminal352.maxFrameBytes<=32768;")
            try await self.require("Gap replay injected input", "return __terminal352.inputPosts===0;")
            self.record(["observer_frames": try await self.js("return __terminal352.frames;")])
            self.checks["parser-completion-backpressure"] = ["status": "pass", "detail": "Actual WK parser marker ACK after 12 MiB overflow; explicit gap/reset ACK and max 32768-byte frames; no input replay. This does not measure human input/cancel latency"]
            try self.requirePainting("Retained-tail display")
            try await self.screen("WK-RETAINED-TAIL")
            try await self.snapshot("retained-tail")
            return "12 MiB finite fixture overflow; explicit gap and reset acknowledgement precede retained tail, zero input replay"
        }
        // Always retain bounded content-free counters, including on failed rows.
        record(["transport_observations": try await js("return __terminal352;")])
    }

    func rendererFailure() async throws {
        try await screen("WK-OSC-DONE")
        // There is no public WKWebView crash primitive. Never terminate an
        // arbitrary shared WebContent process or call a private WebKit selector.
        checks["renderer-crash"] = ["status": "unavailable",
            "detail": "Preview has a native failure delegate but no public exact-owned WebContent crash seam; actual crash/recovery awaits owning lifecycle integration"]
        record(["checks": checks])
    }
}
#endif
