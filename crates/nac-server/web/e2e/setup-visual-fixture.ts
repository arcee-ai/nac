import fs from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, initializeHarnessWorkspace, type EmbeddedHarness } from "./harness";
import type { ModelCatalog } from "../src/app/types/api";

export const longModel =
  "GPT-5.6 Terra — a long model name for planning, implementation and careful review";
export const setupBaseline = () => process.env.NAC_SETUP_BASELINE_DIST;

/** Immutable browser bundles share one real isolated API; this does not run the baseline server. */
export async function serveSetupBaseline(page: Page, baseUrl: string) {
  const directory = setupBaseline();
  if (!directory) return;
  await page.route(`${baseUrl}/assets/dist/**`, async (route) => {
    const file = path.resolve(
      directory,
      new URL(route.request().url()).pathname.slice("/assets/dist/".length),
    );
    if (!file.startsWith(path.resolve(directory) + path.sep)) return route.abort();
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
    (url) => url.origin === baseUrl && url.pathname === "/",
    async (route) => {
      const live = await (await route.fetch()).text();
      const binding =
        live.match(/<script id="nac-presentation-binding"[\s\S]*?<\/script>/)?.[0] ?? "";
      const html = await fs.readFile(path.join(directory, "index.html"), "utf8");
      await route.fulfill({
        body: html.replace("</head>", binding + "</head>"),
        contentType: "text/html",
      });
    },
  );
}

/** Stable synthetic catalog/paths; filesystem and project/session commands remain real and disposable. */
export async function installSetupFixture(
  page: Page,
  request: APIRequestContext,
  harness: EmbeddedHarness,
  width: number,
  catalogReady?: Promise<void>,
) {
  const folder = `/tmp/nac-all522-visual-${width}`;
  await initializeHarnessWorkspace(folder);
  const catalog = (await (await request.get(`${harness.baseUrl}/models`)).json()) as ModelCatalog;
  const provider = catalog.providers.find((entry) => entry.id === "openai-responses")!;
  const seed = provider.models[0]!;
  const fixture: ModelCatalog = {
    ...catalog,
    providers: [
      {
        ...provider,
        auth_status: "ready",
        connection: {
          base_url: "https://provider.example.test/v1",
          api_key_env: "NAC_E2E_API_KEY",
        },
        default_base_url: "https://provider.example.test/v1",
        managed_base_url: null,
        models: [
          {
            ...seed,
            id: "gpt-5.6-sol",
            display_name: "GPT-5.6 Sol",
            context_window: 128000,
            supported_efforts: ["low", "high"],
            cost: { input: 2, output: 8, cache_read: 0, cache_write: 0 },
          },
          {
            ...seed,
            id: "gpt-5.6-terra",
            display_name: longModel,
            context_window: 256000,
            supported_efforts: ["low", "high"],
            cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          },
        ],
      },
    ],
  };
  await page.route(`${harness.baseUrl}/models`, async (route) => {
    await catalogReady;
    await route.fulfill({ json: fixture });
  });
  await page.route(`${harness.baseUrl}/store`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        root_cwd: folder,
        store_path: "/tmp/nac-all522-visual-store.db",
      },
    });
  });
  return { folder, fixture };
}

export async function captureSetup(
  page: Page,
  info: TestInfo,
  width: number,
  state: string,
  target?: Locator,
) {
  if (target) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
  }
  await page.evaluate(async () => {
    const { document, requestAnimationFrame } = globalThis as unknown as {
      document: { fonts: { ready: Promise<unknown> } };
      requestAnimationFrame: (callback: () => void) => void;
    };
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const name = `${setupBaseline() ? "before" : "after"}-${width}-${state}.png`;
  const file = info.outputPath(name);
  // Native viewport capture also preserves real tab zoom geometry.
  const cdp = await page.context().newCDPSession(page);
  try {
    const frame = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.writeFile(file, Buffer.from(frame.data, "base64"));
  } finally {
    await cdp.detach();
  }
  await info.attach(name, { path: file, contentType: "image/png" });
  if (process.env.NAC_SETUP_CAPTURE_DIR) {
    await fs.mkdir(process.env.NAC_SETUP_CAPTURE_DIR, { recursive: true });
    await fs.copyFile(file, path.join(process.env.NAC_SETUP_CAPTURE_DIR, name));
  }
}
