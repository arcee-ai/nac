import fs from "node:fs/promises";
import path from "node:path";

import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

interface BrowserEvidence {
  commits: number;
  opened: number;
  closed: number;
  active: number;
}
declare global {
  // These names exist only inside Playwright's browser callbacks.
  var __directEvidence: BrowserEvidence;
  var location: { hash: string };
}

// Test-only instrumentation of the actual production React build and native SSE adapter.
// No profiling build, perfDebug switch, fabricated deltas, or application instrumentation.
for (const mobile of [false, true]) {
  test(`direct workflow production lifecycle ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const baselineAssets = process.env.NAC_DIRECT_BASELINE_ASSETS;
    if (baselineAssets) {
      await page.route("**/assets/dist/**", async (route) => {
        const relative = new URL(route.request().url()).pathname.split("/assets/dist/")[1];
        if (!relative || relative.includes("..")) throw new Error("Invalid baseline asset path");
        await route.fulfill({ path: path.join(baselineAssets, relative) });
      });
      await page.route(harness.baseUrl + "/", async (route) => {
        await route.fulfill({
          path: path.join(baselineAssets, "index.html"),
          contentType: "text/html",
        });
      });
    }
    await page.addInitScript(() => {
      const evidence = { commits: 0, opened: 0, closed: 0, active: 0 };
      globalThis.__directEvidence = evidence;
      Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
        value: {
          supportsFiber: true,
          renderers: new Map(),
          inject: () => 1,
          checkDCE: () => undefined,
          onCommitFiberRoot: () => {
            evidence.commits += 1;
          },
          onCommitFiberUnmount: () => undefined,
        },
      });
      const NativeEventSource = globalThis.EventSource;
      globalThis.EventSource = class extends NativeEventSource {
        private released = false;
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          evidence.opened += 1;
          evidence.active += 1;
        }
        override close() {
          if (!this.released) {
            this.released = true;
            evidence.closed += 1;
            evidence.active -= 1;
          }
          super.close();
        }
      };
    });
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/assets/") || url.pathname === "/") return;
      requests.push(
        `${request.method()} ${url.pathname.replace(/\/sessions\/[^/]+/, "/sessions/:id")}`,
      );
    });
    const stages: Record<string, BrowserEvidence> = {};
    const project = await createProject(request, harness);
    const first = await createSession(request, harness, "direct", project);
    const second = await createSession(request, harness, "direct", project);
    await page.goto(`${harness.baseUrl}/#/session/${first}/files`);
    const composer = page.getByRole("combobox", { name: "Message" });
    await expect(composer).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.__directEvidence.active)).toBe(1);
    stages.open = await page.evaluate(() => ({ ...globalThis.__directEvidence }));
    expect(stages.open.commits).toBeGreaterThan(0);
    if (!baselineAssets) {
      // The project fixture explicitly configures high effort; wait for the
      // canonical snapshot rather than accepting the pre-snapshot placeholder.
      await expect(page.getByRole("button", { name: "High", exact: true })).toBeVisible();
      if (!mobile) {
        await page.getByText("Run details", { exact: true }).click();
        await expect(page.getByText("Context tokens", { exact: true })).toBeVisible();
        await page.getByText("Run details", { exact: true }).click();
      }
    }
    const boundary = new ScriptGate();
    harness.provider.enqueue(
      "scoped-active",
      { token: "DIRECT_SCOPE_TOKEN" },
      { kind: "text", text: "cancelled scoped response", stream: true },
      boundary,
    );
    await composer.fill("DIRECT_SCOPE_TOKEN");
    await page
      .locator("form")
      .filter({ has: composer })
      .getByRole("button", { name: "Send", exact: true })
      .click();
    await boundary.accepted;
    await composer.fill("scoped queue input");
    await page.getByRole("button", { name: "Queue Next" }).click();
    const pending = page.getByLabel("Pending messages");
    await expect(pending).toContainText("scoped queue input");
    await pending.getByRole("button", { name: "Change to steer" }).click();
    await pending.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(pending).toHaveCount(0);
    stages.queued = await page.evaluate(() => ({ ...globalThis.__directEvidence }));

    // Hash navigation preserves the document so counts include release/reacquire.
    await page.evaluate((id) => {
      globalThis.location.hash = `/session/${id}/files`;
    }, second);
    await expect(composer).toHaveValue("");
    await expect.poll(() => page.evaluate(() => globalThis.__directEvidence.opened)).toBe(2);
    await expect.poll(() => page.evaluate(() => globalThis.__directEvidence.active)).toBe(1);
    stages.switched = await page.evaluate(() => ({ ...globalThis.__directEvidence }));
    const durable = await (await request.get(`${harness.baseUrl}/sessions/${first}`)).json();
    expect(durable.active_run).toBeTruthy();
    await page.evaluate((id) => {
      globalThis.location.hash = `/session/${id}/files`;
    }, first);
    await expect(page.getByRole("button", { name: "Stop run", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop run", exact: true }).click();
    await waitForRunIdle(request, harness, first);
    boundary.release();
    await expect(page.getByRole("button", { name: "Stop run", exact: true })).toHaveCount(0);
    harness.provider.enqueue(
      "scoped-complete",
      { token: "DIRECT_COMPLETE_TOKEN" },
      { kind: "text", text: "scoped completed response", stream: true },
    );
    await composer.fill("DIRECT_COMPLETE_TOKEN");
    await page
      .locator("form")
      .filter({ has: composer })
      .getByRole("button", { name: "Send", exact: true })
      .click();
    await waitForRunIdle(request, harness, first);
    await expect(page.getByText("scoped completed response", { exact: true })).toBeVisible();
    stages.completed = await page.evaluate(() => ({ ...globalThis.__directEvidence }));
    if (mobile)
      expect(await page.locator("html").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    if (process.env.NAC_DIRECT_EVIDENCE_DIR) {
      await fs.mkdir(process.env.NAC_DIRECT_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.NAC_DIRECT_EVIDENCE_DIR,
          `${baselineAssets ? "dev34e10bf7" : "ALL-135"}-${mobile ? "mobile" : "desktop"}.png`,
        ),
        fullPage: true,
      });
    }
    await page.reload();
    await expect(page.getByText("scoped completed response", { exact: true })).toBeVisible();
    stages.reloaded = await page.evaluate(() => ({ ...globalThis.__directEvidence }));
    await page.evaluate(() => {
      globalThis.location.hash = "/";
    });
    await expect.poll(() => page.evaluate(() => globalThis.__directEvidence.active)).toBe(0);
    stages.detached = await page.evaluate(() => ({ ...globalThis.__directEvidence }));
    expect(stages.detached.closed).toBe(stages.detached.opened);
    harness.provider.assertConsumed();
    const evidence = {
      artifact: baselineAssets ? "dev34e10bf7" : "ALL-135",
      viewport: mobile ? "390x844" : "1280x720",
      stages,
      requests: Object.fromEntries(
        [...new Set(requests)]
          .sort()
          .map((key) => [key, requests.filter((entry) => entry === key).length]),
      ),
    };
    await testInfo.attach("production workflow evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    if (process.env.NAC_DIRECT_EVIDENCE_DIR) {
      await fs.mkdir(process.env.NAC_DIRECT_EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(
        path.join(
          process.env.NAC_DIRECT_EVIDENCE_DIR,
          `${evidence.artifact}-${mobile ? "mobile" : "desktop"}.json`,
        ),
        JSON.stringify(evidence, null, 2),
      );
    }
  });
}
