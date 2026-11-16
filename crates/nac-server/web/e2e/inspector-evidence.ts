import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";

export type InspectorVersion = "before" | "after";
const boundPages = new WeakSet<Page>();
const currentAssets = fileURLToPath(new URL("../../assets/dist/", import.meta.url));

/** Only production-built assets change; both versions use the same local fixture/server. */
export async function serveInspectorVersion(
  page: Page,
  baseUrl: string,
  version: InspectorVersion,
) {
  if (boundPages.has(page)) throw new Error("Inspector page version is already sealed");
  if (page.url() !== "about:blank")
    throw new Error("Bind inspector assets before first navigation");
  const directory = version === "before" ? process.env.NAC_INSPECTOR_BASELINE_DIST : currentAssets;
  if (!directory) throw new Error("Baseline inspector assets are required for before captures");
  const root = path.resolve(directory);
  boundPages.add(page);
  await page.route(`${baseUrl}/assets/dist/**`, async (route) => {
    const relative = new URL(route.request().url()).pathname.slice("/assets/dist/".length);
    const file = path.resolve(root, decodeURIComponent(relative));
    if (!file.startsWith(root + path.sep)) return route.abort();
    try {
      // A chunk from the opposite revision must fail closed, never fall back.
      await fs.access(file);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return route.abort("failed");
      throw error;
    }
    // The candidate still comes from the normal embedded production server.
    if (version === "after") return route.continue();
    return route.fulfill({
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
      if (version === "after") return route.continue();
      return route.fulfill({
        body: await fs.readFile(path.join(root, "index.html")),
        contentType: "text/html",
      });
    },
  );
}

/** The wide panel root or phone dialog, excluding the parent transcript. */
export function inspectorPane(page: Page, width: number, name: "Subagents" | "Files") {
  if (width < 768) return page.getByRole("dialog", { name, exact: true });
  return page
    .getByRole("tab", { name, exact: true })
    .locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' overflow-hidden ')][1]",
    );
}

async function waitForPaneTransitions(pane: Locator) {
  await expect
    .poll(() =>
      pane.evaluate((root) =>
        root
          .getAnimations({ subtree: true })
          .every(
            (animation: {
              effect: { getComputedTiming: () => { iterations: number } } | null;
              playState: string;
            }) =>
              animation.effect?.getComputedTiming().iterations === Infinity ||
              animation.playState === "finished" ||
              animation.playState === "idle",
          ),
      ),
    )
    .toBe(true);
}

export async function readyInspectorChild(page: Page, width: number, text: string) {
  const pane = inspectorPane(page, width, "Subagents");
  const content = pane.getByText(text, { exact: true });
  await expect(content).toBeVisible();
  await expect(pane.getByRole("status", { name: "Loading conversation", exact: true })).toHaveCount(
    0,
  );
  // Visibility alone accepts an opacity-zero ancestor while reveal is in progress.
  await expect
    .poll(() =>
      content.evaluate((element) => {
        const view = globalThis as unknown as {
          getComputedStyle: (node: typeof element) => { opacity: string; visibility: string };
        };
        for (let node: typeof element | null = element; node; node = node.parentElement) {
          const style = view.getComputedStyle(node);
          if (Number(style.opacity) !== 1 || style.visibility !== "visible") return false;
        }
        return true;
      }),
    )
    .toBe(true);
  await waitForPaneTransitions(pane);
}

export async function readyInspectorFiles(page: Page, width: number) {
  const pane = inspectorPane(page, width, "Files");
  await expect(pane.getByRole("status", { name: "Loading Files", exact: true })).toHaveCount(0);
  // Tablet Files initially opens its selected detail; this capture names the list.
  if (width >= 768 && width < 1280)
    await pane.getByRole("button", { name: "Open list", exact: true }).click();
  const file = pane
    .getByRole("button", { name: /^inspection-notes\.txt/ })
    .and(pane.locator("button[aria-pressed]"));
  await expect(file).toBeVisible();
  if (width >= 1280) {
    await expect(pane.getByText("Existing checkout notes", { exact: true })).toBeVisible();
    await expect(pane.getByText("Loading diff…", { exact: true })).toHaveCount(0);
  }
  await waitForPaneTransitions(pane);
}

export async function captureInspector(page: Page, name: string) {
  const directory = process.env.NAC_INSPECTOR_CAPTURE_DIR;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  await page.evaluate(async () => {
    const view = globalThis as unknown as {
      document: { fonts: { ready: Promise<unknown> } };
      requestAnimationFrame: (callback: () => void) => void;
    };
    await view.document.fonts.ready;
    await new Promise<void>((resolve) =>
      view.requestAnimationFrame(() => view.requestAnimationFrame(resolve)),
    );
  });
  // The page shell can still be opening while the requested state is visible.
  await waitForPaneTransitions(page.locator("body"));
  const cdp = await page.context().newCDPSession(page);
  try {
    const frame = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.writeFile(path.join(directory, `${name}.png`), Buffer.from(frame.data, "base64"));
  } finally {
    await cdp.detach();
  }
  await fs.writeFile(
    path.join(directory, `${name}.aria.txt`),
    await page.locator("body").ariaSnapshot(),
  );
}

/** Chromium's tab zoom, verified through the browser API; no CSS zoom or DPR substitution. */
export async function inspectorZoomBrowser(
  outputPath: (name: string) => string,
  baseUrl: string,
  version: InspectorVersion,
) {
  const { chromium, expect } = await import("@playwright/test");
  const extension = outputPath("inspector-zoom-extension");
  await fs.mkdir(extension, { recursive: true });
  await fs.writeFile(
    path.join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Disposable NAC inspector zoom",
      version: "1.0",
      permissions: ["tabs"],
      background: { service_worker: "worker.js" },
    }),
  );
  await fs.writeFile(
    path.join(extension, "worker.js"),
    "chrome.runtime.onInstalled.addListener(() => {});",
  );
  const context = await chromium.launchPersistentContext(outputPath("inspector-zoom-profile"), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    await serveInspectorVersion(page, baseUrl, version);
    await page.goto(baseUrl);
    const zoom = await worker.evaluate(async (url) => {
      const { chrome } = globalThis as unknown as {
        chrome: {
          tabs: {
            query: (options: object) => Promise<{ id: number; url: string }[]>;
            setZoom: (id: number, zoom: number) => Promise<void>;
            getZoom: (id: number) => Promise<number>;
          };
        };
      };
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url.startsWith(url));
      if (!tab) throw new Error("Inspector fixture tab not found");
      await chrome.tabs.setZoom(tab.id, 2);
      return chrome.tabs.getZoom(tab.id);
    }, baseUrl);
    expect(zoom).toBe(2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}
