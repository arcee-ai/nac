import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

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
