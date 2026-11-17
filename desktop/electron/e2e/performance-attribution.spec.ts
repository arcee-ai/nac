import { test, expect, root } from "./fixture";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

// One opt-in diagnostic for the observed foreground frame gap. Profiling adds
// overhead; these results attribute cost and never replace primary timings.
if (process.env.NAC_ELECTRON_PERFORMANCE_ATTRIBUTION === "1") {
  test("attribute the unchanged retained-history workflow with CPU and layout evidence", async ({
    candidate: c,
  }) => {
    test.setTimeout(240000);
    const output = path.join(root, `target/electron-performance-attribution-${Date.now()}`);
    await fs.mkdir(output, { recursive: true });
    const probePath = path.join(root, "desktop/electron/performance/workspace-probe.cjs");
    const probe = require(probePath);
    const probeHash = createHash("sha256")
      .update(await fs.readFile(probePath))
      .digest("hex");
    const { PacedProvider } = require("../performance/paced-provider.cjs");
    const paced = new PacedProvider(c.provider.baseUrl);
    await paced.start();
    const session = await c.app.context().newCDPSession(c.page);
    let cpuStarted = false;
    let traceStarted = false;
    let nativeSample: Promise<any> | undefined;
    const nativeLayerMode = process.env.NAC_PERFORMANCE_NATIVE_LAYER === "1";
    let latestLayers: any[] = [];
    const layerCounts: { at: number; count: number }[] = [];
    if (nativeLayerMode) {
      session.on("LayerTree.layerTreeDidChange", (event) => {
        latestLayers = event.layers ?? [];
        if (layerCounts.length < 1000)
          layerCounts.push({ at: Date.now(), count: latestLayers.length });
      });
      await session.send("LayerTree.enable");
    }
    const sampler = path.join(root, "target/electron-performance-tools/process-sample");
    const birth = (pid: number) =>
      JSON.parse(execFileSync(sampler, [String(pid)], { encoding: "utf8" }))[0];
    let packet: any = {
      status: "not_admitted",
      fixture: c.directory,
      shared_probe_sha256: probeHash,
    };
    const native = async () =>
      c.app.evaluate(({ app, BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const display = screen.getDisplayMatching(window.getBounds());
        return {
          focused: window.isFocused(),
          visible: window.isVisible(),
          hidden: app.isHidden(),
          accessibilityEnabled: app.accessibilitySupportEnabled,
          rendererPid: window.webContents.getOSProcessId(),
          accessibilityEvents: (globalThis as any).__attributionAccessibilityEvents,
          minimized: window.isMinimized(),
          throttle: window.webContents.getBackgroundThrottling(),
          displayId: display.id,
          displayBounds: display.bounds,
          scaleFactor: display.scaleFactor,
          frequency: display.displayFrequency,
          contentBounds: window.getContentBounds(),
          counters: (globalThis as any).__attributionNativeFacts,
          disablingSwitches: [
            "disable-background-timer-throttling",
            "disable-renderer-backgrounding",
            "disable-frame-rate-limit",
          ].map((name) => [name, app.commandLine.hasSwitch(name)]),
        };
      });
    try {
      await session.send("Emulation.clearDeviceMetricsOverride");
      await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      await c.app.evaluate(({ app }) => {
        const events: { enabled: boolean; at: number }[] = [];
        (globalThis as any).__attributionAccessibilityEvents = events;
        app.on("accessibility-support-changed", (_event, enabled) =>
          events.push({ enabled, at: Date.now() }),
        );
      });
      packet.beforeActivation = await native();
      await c.app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        const window = BrowserWindow.getAllWindows()[0];
        window.show();
        window.focus();
      });
      const gate = path.join(c.directory, "attribution.go");
      await fs.writeFile(
        path.join(root, "target/electron-attribution-ready.json"),
        JSON.stringify({
          pid: c.app.process().pid,
          enginePid: c.enginePid,
          directory: c.directory,
          gate,
          endpoint: c.endpoint,
          bundle: process.env.NAC_ELECTRON_APP,
          output,
        }),
      );
      console.log(
        "Attribution foreground gate",
        JSON.stringify({ pid: c.app.process().pid, gate }),
      );
      await expect
        .poll(
          () =>
            fs
              .access(gate)
              .then(() => true)
              .catch(() => false),
          { timeout: 120000 },
        )
        .toBe(true);
      await expect.poll(async () => (await native()).focused).toBe(true);
      await expect
        .poll(() =>
          c.page.evaluate(() => document.hasFocus() && document.visibilityState === "visible"),
        )
        .toBe(true);
      await c.app.evaluate(({ BrowserWindow }) => {
        const facts = { blurs: 0, hides: 0 };
        (globalThis as any).__attributionNativeFacts = facts;
        const window = BrowserWindow.getAllWindows()[0];
        window.on("blur", () => facts.blurs++);
        window.on("hide", () => facts.hides++);
      });
      packet.nativeStart = await native();
      packet.rendererBirth = birth(packet.nativeStart.rendererPid);
      expect(packet.rendererBirth.valid).toBe(true);
      expect(packet.nativeStart.accessibilityEnabled).toBe(true);
      c.page.on("console", (message) => {
        if (message.text() !== "NAC_PERF_NATIVE_TYPING" || nativeSample) return;
        nativeSample = (async () => {
          const pid = await c.app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
          );
          expect(pid).toBe(packet.nativeStart.rendererPid);
          const before = birth(pid);
          expect(before.valid).toBe(true);
          for (const key of ["birth_sec", "birth_usec"])
            expect(before[key]).toBe(packet.rendererBirth[key]);
          const began = Date.now();
          if (nativeLayerMode) {
            const layers = latestLayers.slice(0, 200);
            packet.typingLayers = {
              total: latestLayers.length,
              retained: layers.length,
              layers: await Promise.all(
                layers.map(async (layer) => ({
                  ...layer,
                  reasons: await session
                    .send("LayerTree.compositingReasons", { layerId: layer.layerId })
                    .catch((error) => ({ error: String(error).slice(0, 300) })),
                })),
              ),
            };
          }
          const receipt = await promisify(execFile)(
            "/usr/bin/sample",
            [
              String(pid),
              "2",
              "1",
              ...(nativeLayerMode ? [] : ["-mayDie"]),
              "-file",
              path.join(output, "renderer-native-sample.txt"),
            ],
            { timeout: nativeLayerMode ? 60000 : 10000, maxBuffer: 1024 * 1024 },
          );
          const after = birth(pid);
          expect(after.valid).toBe(true);
          for (const key of ["birth_sec", "birth_usec"]) expect(after[key]).toBe(before[key]);
          return {
            status: "sampled",
            pid,
            before,
            after,
            began,
            ended: Date.now(),
            stdout: receipt.stdout.slice(0, 2000),
            stderr: receipt.stderr.slice(0, 2000),
          };
        })().catch((error) => ({
          status: "failed",
          error: String(error).slice(0, 2000),
          code: error.code,
          signal: error.signal,
          killed: error.killed,
        }));
      });
      expect(packet.nativeStart.throttle).toBe(true);
      expect(packet.nativeStart.disablingSwitches.every((entry: any[]) => !entry[1])).toBe(true);
      expect(await c.page.evaluate(() => devicePixelRatio)).toBe(packet.nativeStart.scaleFactor);
      await c.page.evaluate(() => {
        const facts = {
          longTasks: [] as { start: number; duration: number }[],
          inputEvents: 0,
          scrollEvents: 0,
        };
        (window as any).__attributionFacts = facts;
        performance.mark("NAC_PERF/observer-start");
        const observer = new PerformanceObserver((entries) => {
          for (const event of entries.getEntries()) {
            if (facts.longTasks.length < 2000)
              facts.longTasks.push({ start: event.startTime, duration: event.duration });
          }
        });
        observer.observe({ type: "longtask", buffered: false });
        const input = (event: Event) => {
          if (
            !(event.target instanceof HTMLTextAreaElement) ||
            !event.target.value.startsWith("bounded synthetic input ")
          )
            return;
          if (!facts.inputEvents) {
            performance.mark("NAC_PERF/typing-start");
            console.info("NAC_PERF_NATIVE_TYPING");
          }
          facts.inputEvents++;
          if (facts.inputEvents === 200) performance.mark("NAC_PERF/typing-event-200");
        };
        const scroll = () => {
          facts.scrollEvents++;
        };
        document.addEventListener("input", input, true);
        document.addEventListener("scroll", scroll, true);
        (window as any).__attributionDispose = () => {
          observer.disconnect();
          document.removeEventListener("input", input, true);
          document.removeEventListener("scroll", scroll, true);
          performance.mark("NAC_PERF/observer-end");
        };
      });
      c.provider.enqueue(
        "attribution-history",
        { token: "ELECTRON_PERF_HISTORY" },
        {
          kind: "text",
          stream: true,
          text:
            Array.from(
              { length: 2048 },
              (_, i) => `History ${i}: ${"bounded transcript rendering ".repeat(5)}\n`,
            ).join("") + "\nPERF_HISTORY_END",
        },
      );
      c.provider.enqueue(
        "attribution-stream",
        { token: "ELECTRON_PERF_STREAM" },
        {
          kind: "text",
          stream: true,
          text:
            "Streaming code and math: `const answer = 42` and $x^2$.\n".repeat(60) +
            "\nPERF_STREAM_END",
        },
      );
      await session.send("Performance.enable");
      packet.metricsBefore = await session.send("Performance.getMetrics");
      if (!nativeLayerMode) {
        await session.send("Profiler.enable");
        await session.send("Profiler.setSamplingInterval", { interval: 1000 });
        await session.send("Profiler.start");
        cpuStarted = true;
        await session.send("Tracing.start", {
          categories: "devtools.timeline,blink.user_timing",
          transferMode: "ReturnAsStream",
        });
        traceStarted = true;
      }
      packet.report = await c.page.evaluate(probe, {
        providerURL: paced.baseUrl,
        historyPrompt: "ELECTRON_PERF_HISTORY",
        historyMarker: "PERF_HISTORY_END",
        streamPrompt: "ELECTRON_PERF_STREAM",
        streamMarker: "PERF_STREAM_END",
        repeats: 5,
        inputEvents: 200,
      });
      packet.nativeEnd = await native();
      packet.nativeSample = nativeSample ? await nativeSample : { status: "not_started" };
      packet.metricsAfter = await session.send("Performance.getMetrics");
      packet.rendererFacts = await c.page.evaluate(() => {
        (window as any).__attributionDispose();
        return {
          ...(window as any).__attributionFacts,
          marks: performance
            .getEntriesByType("mark")
            .filter((entry) => entry.name.startsWith("NAC_PERF/"))
            .map((entry) => ({ name: entry.name, start: entry.startTime })),
        };
      });
      if (!nativeLayerMode) {
        const profile = await session.send("Profiler.stop");
        cpuStarted = false;
        await fs.writeFile(
          path.join(output, "renderer.cpuprofile"),
          JSON.stringify(profile.profile),
        );
        const complete = new Promise<any>((resolve) =>
          session.once("Tracing.tracingComplete", resolve),
        );
        await session.send("Tracing.end");
        traceStarted = false;
        const finished = await complete;
        const chunks: Buffer[] = [];
        let bytes = 0;
        while (true) {
          const part = await session.send("IO.read", { handle: finished.stream, size: 65536 });
          const chunk = Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8");
          bytes += chunk.length;
          if (bytes > 32 * 1024 * 1024)
            throw Error("Diagnostic trace exceeded32MiB; no truncated trace is admitted");
          chunks.push(chunk);
          if (part.eof) break;
        }
        await session.send("IO.close", { handle: finished.stream });
        await fs.writeFile(path.join(output, "renderer-trace.json"), Buffer.concat(chunks));
        packet.traceBytes = bytes;
      }
      packet.layerTreeCounts = layerCounts;
      packet.native_layer_mode = nativeLayerMode;
      packet.pacing = paced.receipts;
      expect(packet.nativeEnd.counters).toEqual({ blurs: 0, hides: 0 });
      expect(packet.nativeEnd.focused).toBe(true);
      expect(packet.nativeEnd.accessibilityEnabled).toBe(true);
      expect(packet.nativeSample.status).toBe("sampled");
      for (const key of [
        "displayId",
        "displayBounds",
        "scaleFactor",
        "contentBounds",
        "throttle",
      ]) {
        expect(packet.nativeEnd[key]).toEqual(packet.nativeStart[key]);
      }
      expect(packet.report.viewport).toEqual({
        innerWidth: 1280,
        innerHeight: 800,
        devicePixelRatio: packet.nativeStart.scaleFactor,
      });
      expect(packet.report.typing_focus_metadata.composer_focused).toBe(true);
      c.provider.assertConsumed();
      packet.status = "attribution_admitted_profiling_overhead_not_budget_data";
    } catch (error) {
      packet.error = String(error).slice(0, 4000);
      throw error;
    } finally {
      if (cpuStarted) await session.send("Profiler.stop").catch(() => {});
      if (traceStarted) await session.send("Tracing.end").catch(() => {});
      await fs.writeFile(path.join(output, "packet.json"), JSON.stringify(packet, null, 2));
      await session.detach();
      await paced.stop();
    }
  });
}
