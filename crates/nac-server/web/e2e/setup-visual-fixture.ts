import fs from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, initializeHarnessWorkspace, type EmbeddedHarness } from "./harness";
import type { ModelCatalog } from "../src/app/types/api";
import { sealFrontendAssets, serveFrontendAssets } from "./frontend-assets";

export const longModel =
  "GPT-5.6 Terra — a long model name for planning, implementation and careful review";
export const setupBaseline = () => process.env.NAC_SETUP_BASELINE_DIST;

/** The test owns every returned serving handle; no page-close event hook. */
type SetupBaselineLifetime = {
  serve(page: Page, baseUrl: string): Promise<void>;
  beforeContextClose(context: BrowserContext): Promise<void>;
  withContext<T>(context: BrowserContext, body: () => Promise<T>): Promise<T>;
};

async function withAwaitedCleanup<T>(
  body: () => Promise<T>,
  cleanup: (() => Promise<void>)[],
  label: string,
): Promise<T> {
  const failures: unknown[] = [];
  let value!: T;
  try {
    value = await body();
  } catch (error) {
    failures.push(error);
  }
  for (const dispose of cleanup) {
    try {
      await dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 1) throw new AggregateError(failures, label);
  if (failures.length === 1) throw failures[0];
  return value;
}

/** Immutable normal frontend bytes share the real isolated API. */
async function serveSetupBaseline(page: Page, baseUrl: string) {
  const directory = setupBaseline();
  if (directory) return serveFrontendAssets(page, baseUrl, await sealFrontendAssets(directory));
}

/** Explicit test-local serving lifetime, including pages prepared by zoom. */
export async function withSetupBaselines<T>(
  body: (baseline: SetupBaselineLifetime) => Promise<T>,
): Promise<T> {
  const serving = new Map<
    Page,
    {
      context: BrowserContext;
      handle: Awaited<ReturnType<typeof serveFrontendAssets>>;
    }
  >();
  let finishing = false;
  const dispose = async (context?: BrowserContext) => {
    const selected = [...serving].filter(([, entry]) => !context || entry.context === context);
    // Claim once, including rejected disposers; no repeated assertion or masking.
    for (const [page] of selected) serving.delete(page);
    const settled = await Promise.allSettled(selected.map(([, entry]) => entry.handle.dispose()));
    const failures = settled
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 1)
      throw new AggregateError(failures, "Setup baseline pages failed disposal");
    if (failures.length === 1) throw failures[0];
  };
  const baseline: SetupBaselineLifetime = {
    serve: async (page, baseUrl) => {
      if (finishing) throw new Error("Setup baseline lifetime already finished");
      if (serving.has(page)) throw new Error("Setup baseline page already has a serving owner");
      const handle = await serveSetupBaseline(page, baseUrl);
      // No-baseline branch touches no Page/Context method and owns no sealer.
      if (handle) serving.set(page, { context: page.context(), handle });
    },
    beforeContextClose: (context) => dispose(context),
    withContext: (context, run) =>
      withAwaitedCleanup(
        run,
        [() => dispose(context), () => context.close()],
        "Setup zoom body, baseline disposal or context close failed",
      ),
  };
  return withAwaitedCleanup(
    () => body(baseline),
    [
      async () => {
        finishing = true;
        await dispose();
      },
    ],
    "Setup test body or baseline disposal failed",
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
