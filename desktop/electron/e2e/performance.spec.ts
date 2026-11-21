import { test, expect, root } from "./fixture";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
const probe = require("../performance/workspace-probe.cjs");
const { annotateFailure, statusClass, collectRendererFacts } = require("../performance/failure-projection.cjs");

function nativeDisplay({ screen, BrowserWindow }: any) {
  const window = BrowserWindow.getAllWindows()[0];
  const selected = screen.getDisplayMatching(window.getBounds());
  return {
    displayId: selected.id,
    displayFrequency: selected.displayFrequency,
    internal: selected.internal,
    scaleFactor: selected.scaleFactor,
    displayBounds: selected.bounds,
    contentBounds: window.getContentBounds(),
  };
}

const configuration = (providerURL: string) => ({
  providerURL,
  historyPrompt: "ELECTRON_PERF_HISTORY",
  historyMarker: "PERF_HISTORY_END",
  streamPrompt: "ELECTRON_PERF_STREAM",
  streamMarker: "PERF_STREAM_END",
  repeats: 5,
  inputEvents: 200,
});
function enqueue(provider: any, arm: string) {
  provider.enqueue(
    `${arm}-history`,
    { token: "ELECTRON_PERF_HISTORY" },
    {
      kind: "text",
      text:
        Array.from(
          { length: 2048 },
          (_, i) => `History ${i}: ${"bounded transcript rendering ".repeat(5)}\n`,
        ).join("") + "\nPERF_HISTORY_END",
      stream: true,
    },
  );
  provider.enqueue(
    `${arm}-stream`,
    { token: "ELECTRON_PERF_STREAM" },
    {
      kind: "text",
      text:
        "Streaming code and math: `const answer = 42` and $x^2$.\n".repeat(60) +
        "\nPERF_STREAM_END",
      stream: true,
    },
  );
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) };
}
test("bounded optimized workflow diagnostics retain long transcript streaming and terminal pressure", async ({
  candidate: c,
}, info) => {
  test.setTimeout(240000);
  const { PacedProvider } = require("../performance/paced-provider.cjs");
  const paced = new PacedProvider(c.provider.baseUrl);
  await paced.start();
  let layerSession: any;
  try {
    const accessibilityBefore = await c.app.evaluate(({ app }) => {
      const facts = {
        start: app.accessibilitySupportEnabled,
        events: [] as { enabled: boolean }[],
      };
      (globalThis as any).__workflowAccessibility = facts;
      app.on("accessibility-support-changed", (_event, enabled) => facts.events.push({ enabled }));
      return facts.start;
    });
    let display = await c.app.evaluate(nativeDisplay);
    const observation = await c.app.context().newCDPSession(c.page);
    await observation.send("Emulation.clearDeviceMetricsOverride");
    await observation.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    await observation.detach();
    await expect.poll(() => c.page.evaluate(() => devicePixelRatio)).toBe(display.scaleFactor);
    await c.app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    });
    if (process.env.NAC_ELECTRON_FOREGROUND_GATE === "1") {
      const gate = path.join(c.directory, "foreground.go");
      await fs.writeFile(
        path.join(root, "target/electron-foreground-ready.json"),
        JSON.stringify({
          pid: c.app.process().pid,
          enginePid: c.enginePid,
          directory: c.directory,
          gate,
          bundle: process.env.NAC_ELECTRON_APP,
        }),
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
    }
    await expect
      .poll(() =>
        c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
      )
      .toBe(true);
    await expect
      .poll(() =>
        c.page.evaluate(() => document.hasFocus() && document.visibilityState === "visible"),
      )
      .toBe(true);
    display = await c.app.evaluate(nativeDisplay);
    expect(await c.page.evaluate(() => devicePixelRatio)).toBe(display.scaleFactor);
    await c.app.evaluate(({ BrowserWindow }) => {
      const facts = { blurs: 0, hides: 0 };
      (globalThis as any).__workflowNativeFacts = facts;
      const window = BrowserWindow.getAllWindows()[0];
      window.on("blur", () => facts.blurs++);
      window.on("hide", () => facts.hides++);
    });
    const accessibilityStart = await c.app.evaluate(({ app }) => app.accessibilitySupportEnabled);
    const compositingControl = process.env.NAC_PERFORMANCE_COMPOSITING_CONTROL === "1";
    if (compositingControl) {
      await c.page.addStyleTag({
        content:
          ".chat-response { transform: none !important; backface-visibility: visible !important; }",
      });
    }
    const fillControl = process.env.NAC_PERFORMANCE_FILL_CONTROL === "1";
    let latestLayers: any[] = [];
    let typingLayers: Promise<any> | undefined;
    if (fillControl) {
      expect(compositingControl).toBe(false);
      await c.page.addStyleTag({
        content:
          ".chat-response.streaming :is(p,li,h1,h2,h3,h4,h5,h6) .streaming-chunk { opacity: 1; animation-fill-mode: none !important; }",
      });
      layerSession = await c.app.context().newCDPSession(c.page);
      layerSession.on("LayerTree.layerTreeDidChange", (event: any) => {
        latestLayers = event.layers ?? [];
      });
      await layerSession.send("LayerTree.enable");
      c.page.on("console", (message) => {
        if (message.text() !== "NAC_PERF_FILL_TYPING" || typingLayers) return;
        typingLayers = Promise.all(
          latestLayers.slice(0, 64).map(async (layer) => ({
            width: layer.width,
            height: layer.height,
            drawsContent: layer.drawsContent,
            scroll_rects: layer.scrollRects?.length ?? 0,
            reasons: await layerSession
              .send("LayerTree.compositingReasons", { layerId: layer.layerId })
              .catch(() => ({ unavailable: true })),
          })),
        );
      });
    }
    await c.page.evaluate(() => {
      document.addEventListener(
        "input",
        function observe(event) {
          if (
            !(event.target instanceof HTMLTextAreaElement) ||
            !event.target.value.startsWith("bounded synthetic input ")
          )
            return;
          document.removeEventListener("input", observe, true);
          (window as any).__fillFacts = [...document.querySelectorAll(".streaming-chunk")]
            .slice(0, 8)
            .map((node) => ({
              opacity: getComputedStyle(node).opacity,
              fill: getComputedStyle(node).animationFillMode,
              animation: getComputedStyle(node).animationName,
              duration: getComputedStyle(node).animationDuration,
              easing: getComputedStyle(node).animationTimingFunction,
              keyframes: [...document.styleSheets].flatMap((sheet) => {
                try {
                  return [...sheet.cssRules]
                    .filter((rule) => rule instanceof CSSKeyframesRule && rule.name === "fadeInOut")
                    .flatMap((rule) =>
                      [...(rule as CSSKeyframesRule).cssRules].map((frame) => ({
                        offset: frame.keyText,
                        opacity: frame.style.opacity,
                      })),
                    );
                } catch {
                  return [];
                }
              }),
              animations: node.getAnimations().map((animation) => ({
                state: animation.playState,
                currentTime: animation.currentTime,
                timing: animation.effect?.getTiming(),
                frames:
                  animation.effect instanceof KeyframeEffect
                    ? animation.effect
                        .getKeyframes()
                        .map((frame) => ({ opacity: frame.opacity, offset: frame.offset }))
                    : [],
              })),
            }));
          console.info("NAC_PERF_FILL_TYPING");
        },
        true,
      );
    });
    enqueue(c.provider, "electron");
    const runResponses: string[] = [];
    const observeResponse = (response: import("@playwright/test").Response) => {
      if (
        runResponses.length < 9 &&
        response.request().method() === "POST" &&
        /^\/sessions\/[^/]+\/runs$/.test(new URL(response.url()).pathname)
      ) {
        runResponses.push(statusClass(response.status()));
      }
    };
    c.page.on("response", observeResponse);
    let report: any;
    try {
      report = await c.page.evaluate(probe, configuration(paced.baseUrl));
    } catch (error) {
      // The existing CI reporter preserves bounded error text, not attachments.
      // Never collect raw renderer content or let diagnostics replace failure.
      let stage: unknown = "unknown";
      try {
        stage = await Promise.race([
          c.page.evaluate(() => (window as any).__nacPerformanceFailureStage),
          new Promise((resolve) => setTimeout(() => resolve("unknown"), 1000)),
        ]);
      } catch {
        // A closed or unresponsive renderer leaves the stage unknown.
      }
      let renderer: unknown = null;
      try {
        renderer = await Promise.race([
          c.page.evaluate(collectRendererFacts),
          new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
        ]);
      } catch {
        // A closed or unresponsive renderer leaves the facts unknown.
      }
      throw annotateFailure(error, stage, c.provider.requests, paced.receipts, runResponses, renderer);
    } finally {
      c.page.off("response", observeResponse);
    }
    report.settled_animation_state = await c.page.evaluate(() => (window as any).__fillFacts);
    if (fillControl)
      report.fill_control = {
        style: "base opacity1 + animation-fill-mode:none, unchanged150ms fade",
        typing_layers: typingLayers ? await typingLayers : null,
        typing_styles: report.settled_animation_state,
      };
    report.compositing_control = compositingControl
      ? "test-only .chat-response transform:none; backface-visibility:visible"
      : null;
    report.native_accessibility = await c.app.evaluate(({ app }) => ({
      before_activation: (globalThis as any).__workflowAccessibility.start,
      events: (globalThis as any).__workflowAccessibility.events,
      end: app.accessibilitySupportEnabled,
    }));
    report.native_accessibility.start = accessibilityStart;
    report.native_accessibility.observation_mode =
      process.env.NAC_ELECTRON_FOREGROUND_GATE === "1"
        ? "explicit native observer activation gate"
        : "native application focus without CUA attachment";
    report.native_focus = await c.app.evaluate(({ BrowserWindow }) => ({
      ...(globalThis as any).__workflowNativeFacts,
      focused: BrowserWindow.getAllWindows()[0].isFocused(),
    }));
    report.shared_probe_sha256 = createHash("sha256")
      .update(
        await fs.readFile(path.join(root, "desktop/electron/performance/workspace-probe.cjs")),
      )
      .digest("hex");
    report.observer = "optimized Electron via Playwright; DOM/rAF and HTTP proxies only";
    const endDisplay = await c.app.evaluate(nativeDisplay);
    report.native_display = { ...display, end: endDisplay };
    const packet = {
      arm: "electron",
      report,
      distributions: Object.fromEntries(
        [
          "typing_event_to_raf_ms",
          "history_open_to_dom_raf_ms",
          "scroll_frame_gaps_ms",
          "streaming_dom_mutation_gaps_ms",
        ].map((key) => [key, distribution(report[key])]),
      ),
      fixture: c.directory,
      store: path.join(c.directory, "store.db"),
      engine: JSON.parse(
        await fs.readFile(
          path.join(root, "target/electron-resources/engine-identity.json"),
          "utf8",
        ),
      ),
    };
    await fs.writeFile(
      path.join(root, "target/electron-workflow-performance.json"),
      JSON.stringify(packet, null, 2),
    );
    await info.attach("workflow-proxy-distributions", {
      body: JSON.stringify(packet, null, 2),
      contentType: "application/json",
    });
    console.log(
      "Electron diagnostic distributions",
      JSON.stringify(packet.distributions),
      JSON.stringify(report.terminal),
    );
    expect(report.errors).toEqual([]);
    expect(Array.isArray(report.settled_animation_state)).toBe(true);
    for (const element of report.settled_animation_state) {
      expect(element.opacity).toBe("1");
      expect(element.animations.every((animation: any) => animation.state !== "finished")).toBe(
        true,
      );
    }
    expect(report.native_accessibility.before_activation).toBe(accessibilityBefore);
    if (process.env.NAC_PERFORMANCE_EXPECT_AX === "false") {
      expect(report.native_accessibility.start).toBe(false);
      expect(report.native_accessibility.end).toBe(false);
      expect(report.native_accessibility.events).toEqual([]);
    }
    expect(report.native_focus).toEqual({ blurs: 0, hides: 0, focused: true });
    expect(endDisplay).toEqual(display);
    expect(report.terminal).toHaveLength(3);
    c.provider.assertConsumed();
  } finally {
    if (layerSession) await layerSession.detach();
    await paced.stop();
  }
});

// Opt-in matched Swift diagnostic fixture. Normal Swift builds contain no probe
// or automation bridge; absence here does not silently pass a comparison.
if (process.env.NAC_SWIFT_PERFORMANCE_APP) {
  test("same bounded workflow probe runs in optimized WKWebView fixture", async ({
    candidate: c,
  }, info) => {
    test.setTimeout(240000);
    const applicationProcess = c.app.process();
    await c.app.evaluate(({ app, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      app.quit();
    });
    await expect.poll(() => applicationProcess.exitCode !== null, { timeout: 30000 }).toBe(true);
    const { PacedProvider } = require("../performance/paced-provider.cjs");
    const paced = new PacedProvider(c.provider.baseUrl);
    await paced.start();
    const control = path.join(c.directory, "swift-control");
    await fs.mkdir(control);
    const config = path.join(c.directory, "swift-config.json");
    const output = path.join(c.directory, "swift-result.json");
    const gate = path.join(c.directory, "swift-foreground.go");
    const gateReady = path.join(c.directory, "swift-foreground.ready");
    const gated = process.env.NAC_SWIFT_FOREGROUND_GATE === "1";
    await fs.writeFile(
      config,
      JSON.stringify({
        ...configuration(paced.baseUrl),
        ...(gated ? { foregroundGate: gate, foregroundReady: gateReady } : {}),
      }),
    );
    enqueue(c.provider, "swift");
    const bundle = process.env.NAC_SWIFT_PERFORMANCE_APP!;
    const executable = path.join(bundle, "Contents/MacOS/NACPreview");
    const store = path.join(await fs.realpath(c.directory), "swift-store.db");
    const child = spawn(
      executable,
      [
        "--directory",
        c.workspace,
        "--store-path",
        store,
        "--instance-scenario",
        "performance",
        "--instance-output",
        output,
        "--instance-control",
        control,
        "--instance-store",
        store,
        "--instance-performance",
        config,
      ],
      {
        env: {
          PATH: "/usr/bin:/bin:/opt/homebrew/bin",
          HOME: path.join(c.directory, "home"),
          NAC_HOME: path.join(c.directory, "nac-home"),
          NAC_E2E_API_KEY: "nac-e2e-dummy-only",
          MODELS_DEV_URL: `${paced.baseUrl}/models-dev`,
          BROWSER: "none",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const logs: string[] = [];
    child.stdout.on("data", (b) => {
      if (logs.length < 20) logs.push(b.toString().slice(0, 2000));
    });
    child.stderr.on("data", (b) => {
      if (logs.length < 20) logs.push(b.toString().slice(0, 2000));
    });
    try {
      if (gated) {
        await expect
          .poll(
            () =>
              fs
                .access(gateReady)
                .then(() => true)
                .catch(() => false),
            { timeout: 45000 },
          )
          .toBe(true);
        await fs.writeFile(
          path.join(root, "target/swift-foreground-ready.json"),
          JSON.stringify({ pid: child.pid, bundle, gate, directory: c.directory }),
        );
      }
      await expect
        .poll(
          async () => {
            const value = await fs
              .readFile(output, "utf8")
              .then(JSON.parse)
              .catch(() => null);
            if (value?.stage === "failed")
              throw Error("Swift diagnostic failed: " + JSON.stringify(value));
            return value?.stage;
          },
          { timeout: 185000 },
        )
        .toBe("performance-ready");
      const report = JSON.parse(await fs.readFile(output, "utf8"));
      await fs.writeFile(path.join(control, "finish"), "finish");
      await expect.poll(() => child.exitCode, { timeout: 30000 }).not.toBeNull();
      expect(JSON.parse(await fs.readFile(output, "utf8")).stopped).toBe(true);
      await fs.writeFile(
        path.join(root, "target/swift-workflow-performance.json"),
        JSON.stringify(report, null, 2),
      );
      await info.attach("WKWebView-workflow-proxy", {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });
      c.provider.assertConsumed();
    } finally {
      // The existing instance fixture consumes finish through protected Quit.
      // Never force kill a pending engine to turn diagnostic failure into pass.
      if (child.exitCode === null) await fs.writeFile(path.join(control, "finish"), "finish");
      await info.attach("WKWebView-diagnostic-log", {
        body: logs.join(""),
        contentType: "text/plain",
      });
      await paced.stop();
    }
  });
}
