import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const REASONING =
  "The build spends most of its time preparing images. I’ll check the cache key before changing the build steps.\n\nA stable key should include the lockfile and image directory so unchanged inputs can reuse the cache.";
export const ANSWER = "Use a stable image cache key to avoid rebuilding unchanged images.";
export const PROMPT = "Explain how to make this example build faster.";

/** Only the immutable browser artifact changes; both versions use the same isolated API. */
export async function serveReasoningBaseline(page: Page, baseUrl: string) {
  const baseline = process.env.NAC_REASONING_BASELINE_DIST;
  if (!baseline) return;
  await page.route(`${baseUrl}/assets/dist/**`, async (route) => {
    const relative = new URL(route.request().url()).pathname.slice("/assets/dist/".length);
    const file = path.resolve(baseline, relative);
    if (!file.startsWith(path.resolve(baseline) + path.sep)) return route.abort();
    await route.fulfill({
      body: await fs.readFile(file),
      contentType: file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "application/octet-stream",
    });
  });
  await page.route(
    (url) => url.origin === new URL(baseUrl).origin && url.pathname === "/",
    async (route) => {
      await route.fulfill({
        body: await fs.readFile(path.join(baseline, "index.html")),
        contentType: "text/html",
      });
    },
  );
}

/** A turn's work line: "Thinking" while live, "Thought for …"/"Worked for …" once settled. */
export const WORK_FOLD = /^(Thinking|Thought|Working|Worked for)\b/;

/**
 * Each turn's reasoning and tools fold behind one line in the transcript.
 * Expanded, the fold offers "Open in Insights" on its own group, which opens
 * the drawer (a sheet on a phone) on that group's detail.
 */
export async function openWorkInInsights(page: Page, index = 0) {
  const fold = page.locator("[data-work-fold]").nth(index);
  // The fold's own line leads it; its expanded step rows can share a verb ("Thought").
  const toggle = fold.getByRole("button", { name: WORK_FOLD }).first();
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await fold.getByRole("button", { name: "Open in Insights", exact: true }).click();
}

/**
 * A panel drawer (or a phone's panel sheet) floats over the chat and keeps
 * its open state across hash navigation and reloads. Close it before reaching
 * for the transcript underneath.
 */
export async function closePanels(page: Page) {
  const drawer = page.getByRole("tablist", { name: "Session panels", exact: true });
  const hide = page.getByRole("button", { name: "Hide panel", exact: true }).first();
  const sheets = page.locator('[role="dialog"][data-slot="sheet-content"]');
  await expect(async () => {
    // A drawer that is already sliding away keeps its controls mounted but
    // out of view; only a resting one is closed by hand.
    if (await hide.isVisible()) {
      const box = await hide.boundingBox();
      const size = page.viewportSize();
      const inView = box && size && box.x >= 0 && box.x + box.width <= size.width + 1;
      if (inView) await hide.click({ timeout: 2_000 });
    } else if (await sheets.first().isVisible()) await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0, { timeout: 2_000 });
    await expect(sheets).toHaveCount(0, { timeout: 2_000 });
  }).toPass();
}
