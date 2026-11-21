import path from "node:path";
import type { APIRequestContext, Page, Request, Route } from "@playwright/test";
import { createDirectSession, expect, test, type EmbeddedHarness } from "./harness";
import { ScriptGate } from "./scripted-provider";
import { modelChip, openModelCatalog, openModelSettings } from "./speed-controls";

test.use({ codexCatalogFixture: true });

async function openProviderDefaultSpeed(
  page: Page,
  request: APIRequestContext,
  harness: EmbeddedHarness,
  mobile: boolean,
) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route(`${harness.baseUrl}/providers/models`, async (route) => {
    if (route.request().postDataJSON().backend !== "chatgpt-codex-responses")
      return route.fallback();
    await route.fulfill({
      json: {
        base_url: "https://chatgpt.com/backend-api",
        api_key_env: null,
        models: [{ id: "gpt-6.1-sol", display_name: "GPT-6.1-Sol" }],
      },
    });
  });
  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  const catalog = await openModelCatalog(page, "gpt-6.1-sol");
  await catalog.getByRole("menuitemradio", { name: /^GPT-6\.1-Sol/ }).click();
  const speed = page.getByRole("button", { name: "Speed: Provider default" });
  await openModelSettings(page);
  await expect(speed).toBeVisible();
  await expect(speed).toBeEnabled();
  return { sessionId, speed };
}

for (const mobile of [false, true]) {
  test(`accepted speed recovers from hanging configuration readback (${mobile ? "phone" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    const { sessionId, speed } = await openProviderDefaultSpeed(page, request, harness, mobile);
    const configUrl = `${harness.baseUrl}/sessions/${sessionId}/config`;
    const before = await (await request.get(configUrl)).json();
    const isConfigWrite = (write: Request) =>
      write.url() === configUrl && write.method() === "PATCH";
    const readback = new ScriptGate();
    let writes = 0;
    page.on("request", (write) => {
      if (isConfigWrite(write)) writes++;
    });
    const holdRead = async (route: Route) => {
      if (route.request().method() !== "GET" || writes === 0) return route.fallback();
      readback.markAccepted();
      await readback.waitForRelease();
      await route.fallback().catch(() => {});
    };
    await page.route(configUrl, holdRead);
    try {
      await speed.click();
      const saved = page.waitForResponse((response) => isConfigWrite(response.request()));
      await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
      expect((await saved).status()).toBe(200);
      await readback.accepted;
      await expect(page.getByText(/Reload before editing again/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Speed set to Fast", { exact: true })).toHaveCount(0);
      await expect(modelChip(page)).toBeDisabled();
      await expect(page.getByRole("dialog", { name: "Model settings" })).toBeHidden();
      const committed = await (await request.get(configUrl)).json();
      expect(committed.service_tier).toBe("fast");
      expect(committed.config_version).toBe(before.config_version + 1);
    } finally {
      readback.release();
      await page.unroute(configUrl, holdRead);
    }
    await expect(modelChip(page)).toHaveAccessibleName(/Fast speed/);
    await expect(modelChip(page)).toBeDisabled();
    await page.reload();
    await expect(modelChip(page)).toBeEnabled();
    await expect(modelChip(page)).toHaveAccessibleName(/Fast speed/);
    expect(writes).toBe(1);
  });

  test(`refresh after interrupted readback (${mobile ? "phone" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    test.skip(!process.env.NAC_VISUAL_DIR, "Explicit evidence capture only");
    test.setTimeout(90_000);
    const width = mobile ? "mobile" : "desktop";
    const capture = async (state: string) => {
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(process.env.NAC_VISUAL_DIR!, `after-${width}-${state}.png`),
      });
    };
    const { sessionId, speed } = await openProviderDefaultSpeed(page, request, harness, mobile);
    const snapshotPattern = new RegExp(`/sessions/${sessionId}(?:\\?.*)?$`);
    const failSnapshot = async (route: import("@playwright/test").Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 503,
        json: { error: "Fixture refresh unavailable" },
      });
    };
    await page.route(snapshotPattern, failSnapshot);
    const configUrl = `${harness.baseUrl}/sessions/${sessionId}/config`;
    const isConfigWrite = (write: import("@playwright/test").Request) =>
      write.url() === configUrl && write.method() === "PATCH";
    let writes = 0;
    page.on("request", (write) => {
      if (isConfigWrite(write)) writes++;
    });
    await speed.click();
    const saved = page.waitForResponse((response) => isConfigWrite(response.request()));
    await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText(/Reload before editing again/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Speed set to Fast", { exact: true })).toHaveCount(0);
    await expect(modelChip(page)).toBeDisabled();
    await expect(page.getByRole("dialog", { name: "Model settings" })).toBeHidden();
    expect(writes).toBe(1);
    await capture("reload-needed");
    await page.unroute(snapshotPattern, failSnapshot);
    await page.reload();
    await expect(modelChip(page)).toBeEnabled();
    await expect(modelChip(page)).toHaveAccessibleName(/Fast speed/);
  });
}
