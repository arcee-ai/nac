import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type TestInfo } from "@playwright/test";

/** Real Chromium tab zoom, using the same disposable extension lane as navigation acceptance. */
export async function openNameZoom(info: TestInfo, origin: string) {
  const extension = info.outputPath("zoom-extension");
  await fs.mkdir(extension, { recursive: true });
  await fs.writeFile(
    path.join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Disposable session-name zoom",
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
    hasTouch: true,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    await page.goto(origin);
    const zoom = await worker.evaluate(async (url) => {
      const { chrome } = globalThis as unknown as {
        chrome: {
          tabs: {
            query(options: object): Promise<{ id: number; url: string }[]>;
            setZoom(id: number, value: number): Promise<void>;
            getZoom(id: number): Promise<number>;
          };
        };
      };
      const tab = (await chrome.tabs.query({})).find((item) => item.url.startsWith(url));
      if (!tab) throw new Error("Session-name acceptance tab not found");
      await chrome.tabs.setZoom(tab.id, 2);
      return chrome.tabs.getZoom(tab.id);
    }, origin);
    if (zoom !== 2) throw new Error(`Expected real 200% tab zoom, received ${zoom}`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    return { context, page, zoom };
  } catch (error) {
    await context.close();
    throw error;
  }
}
