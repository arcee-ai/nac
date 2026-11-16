import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ANSWER, PROMPT, REASONING, serveReasoningBaseline } from "./reasoning-fixture";

test.use({ orchestration: "0" });

test("reasoning reading controls work at actual 200 percent tab zoom", async ({
  harness,
  request,
}, info) => {
  test.setTimeout(90_000);
  const extension = info.outputPath("zoom-extension");
  await fs.mkdir(extension, { recursive: true });
  // Chromium's browser API sets real tab zoom. This is neither CSS zoom nor
  // CDP pageScaleFactor (pinch zoom); getZoom and DPR below verify the result.
  await fs.writeFile(
    path.join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Disposable NAC zoom fixture",
      version: "1.0",
      permissions: ["tabs"],
      background: { service_worker: "worker.js" },
    }),
  );
  await fs.writeFile(
    path.join(extension, "worker.js"),
    "chrome.runtime.onInstalled.addListener(() => {});",
  );
  const context = await chromium.launchPersistentContext(info.outputPath("zoom-profile"), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    await serveReasoningBaseline(page, harness.baseUrl);
    harness.provider.enqueue(
      "zoom-reasoning",
      { token: PROMPT },
      { kind: "text", text: ANSWER, reasoning: REASONING },
    );
    const id = await createDirectSession(request, harness);
    const run = await request.post(`${harness.baseUrl}/sessions/${id}/runs`, {
      data: { prompt: PROMPT },
    });
    expect(run.status()).toBe(202);
    await waitForRunIdle(request, harness, id);
    await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
    const filesDialog = page.getByRole("dialog", { name: "Files", exact: true });
    if (await filesDialog.isVisible())
      await filesDialog.getByRole("button", { name: "Close", exact: true }).click();
    const zoom = await worker.evaluate(async (url) => {
      const { chrome } = globalThis as unknown as {
        chrome: {
          tabs: {
            query: (options: object) => Promise<{ id: number; url: string }[]>;
            setZoom: (id: number, value: number) => Promise<void>;
            getZoom: (id: number) => Promise<number>;
          };
        };
      };
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url.startsWith(url));
      if (!tab) throw new Error("NAC tab not found");
      await chrome.tabs.setZoom(tab.id, 2);
      return chrome.tabs.getZoom(tab.id);
    }, harness.baseUrl);
    expect(zoom).toBe(2);
    await expect
      .poll(() =>
        page.evaluate(
          () => (globalThis as unknown as { devicePixelRatio: number }).devicePixelRatio,
        ),
      )
      .toBe(2);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByRole("button", { name: /^(Total activity:|Thoughts)/ })
        .first()
        .click();
      const detail = page.getByRole("region", { name: "Insights detail" });
      if (!process.env.NAC_REASONING_BASELINE_DIST) {
        // At real tab zoom this can be a phone dialog. Its disclosure state
        // settles before the enclosing entry transition finishes.
        await expect
          .poll(() =>
            detail.evaluate((element) => {
              const surface = element.closest('[data-slot="dialog-content"]');
              if (!surface)
                return !element.ownerDocument.defaultView!.matchMedia("(max-width: 767.98px)")
                  .matches;
              return (
                Math.abs(surface.getBoundingClientRect().left) <= 1 &&
                surface
                  .getAnimations()
                  .every(
                    (animation: { playState: string; pending: boolean }) =>
                      animation.playState !== "running" && !animation.pending,
                  )
              );
            }),
          )
          .toBe(true);
        const toggle = detail.getByRole("button", { name: /^Reasoning/ });
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        const geometry = await toggle.evaluate((element) => {
          const view = element.ownerDocument.defaultView!;
          const box = element.getBoundingClientRect();
          const surface = element.closest('[data-slot="dialog-content"]');
          const rect = surface?.getBoundingClientRect();
          return {
            url: element.ownerDocument.location.href,
            box: { x: box.x, width: box.width },
            innerWidth: view.innerWidth,
            dpr: view.devicePixelRatio,
            phone: view.matchMedia("(max-width: 767.98px)").matches,
            dialog: rect
              ? {
                  left: rect.left,
                  right: rect.right,
                  width: rect.width,
                  animations: surface!
                    .getAnimations()
                    .map((animation: { playState: string; pending: boolean }) => ({
                      playState: animation.playState,
                      pending: animation.pending,
                    })),
                }
              : null,
            dom: element.closest('[aria-label="Insights detail"]')?.outerHTML,
          };
        });
        await info.attach(`zoom-geometry-${width}`, {
          body: JSON.stringify(geometry, null, 2),
          contentType: "application/json",
        });
        if (geometry.phone) expect(geometry.dialog).not.toBeNull();
        const { box, innerWidth } = geometry;
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(innerWidth + 1);
      }
      await page.evaluate(() =>
        (
          globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
        ).document.fonts.ready.then(() => undefined),
      );
      const name = `${process.env.NAC_REASONING_BASELINE_DIST ? "before" : "after"}-${width}-zoom200.png`;
      const file = info.outputPath(name);
      await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
      await info.attach(name, { path: file, contentType: "image/png" });
      if (process.env.NAC_REASONING_CAPTURE_DIR) {
        await fs.mkdir(process.env.NAC_REASONING_CAPTURE_DIR, { recursive: true });
        await fs.copyFile(file, path.join(process.env.NAC_REASONING_CAPTURE_DIR, name));
      }
      await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
      const filesDialog = page.getByRole("dialog", { name: "Files", exact: true });
      if (await filesDialog.isVisible())
        await filesDialog.getByRole("button", { name: "Close", exact: true }).click();
    }
    harness.provider.assertConsumed();
  } finally {
    await context.close();
  }
});
