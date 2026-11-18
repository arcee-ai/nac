import path from "node:path";
import { createDirectSession, expect, test } from "./harness";

test.use({ orchestration: "0", codexCatalogFixture: true });

for (const mobile of [false, true]) {
  test(`Codex speed is independent and survives reload (${mobile ? "phone" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    const sessionId = await createDirectSession(request, harness);
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
    const configUrl = `${harness.baseUrl}/sessions/${sessionId}/config`;
    await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
    await page.getByRole("button", { name: "Model" }).click();
    await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
    await page.getByRole("button", { name: /GPT-6\.1-Sol gpt-6\.1-sol/ }).click();
    await expect
      .poll(async () => (await (await request.get(configUrl)).json()).model)
      .toBe("gpt-6.1-sol");
    await expect(page.getByPlaceholder("Search models…")).toBeHidden();
    await expect(page.getByText("Model switched to gpt-6.1-sol")).toBeHidden();
    const initialReasoning = (await (await request.get(configUrl)).json()).reasoning_effort;
    if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL === "before") {
      await page.screenshot({
        path: path.join(process.env.NAC_VISUAL_DIR, `before-${mobile ? "mobile" : "desktop"}.png`),
      });
      return;
    }
    const speed = page.getByRole("button", { name: "Speed: Provider default" });
    await expect(speed).toBeVisible();
    if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL) {
      await page.screenshot({
        path: path.join(
          process.env.NAC_VISUAL_DIR,
          `${process.env.NAC_VISUAL_LABEL}-${mobile ? "mobile" : "desktop"}.png`,
        ),
      });
    }
    await speed.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Ultrafast", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(speed).toBeFocused();
    await speed.click();
    await expect(page.getByRole("menuitemradio", { name: "Use provider default" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.keyboard.press("Escape");
    if (mobile) {
      const box = await speed.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const reject = async (route: import("@playwright/test").Route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({ status: 409, json: { error: "Configuration changed" } });
    };
    await page.route(configUrl, reject);
    await speed.click();
    await page.getByRole("menuitemradio", { name: "Fast" }).click();
    await expect(page.getByText(/Speed was not changed/)).toBeVisible();
    expect((await (await request.get(configUrl)).json()).service_tier ?? null).toBeNull();
    await page.unroute(configUrl, reject);
    await speed.click();
    const patch = page.waitForRequest((req) => req.url() === configUrl && req.method() === "PATCH");
    await page.getByRole("menuitemradio", { name: "Fast" }).click();
    expect((await patch).postDataJSON()).toEqual({ service_tier: "fast" });
    await expect
      .poll(async () => (await (await request.get(configUrl)).json()).service_tier)
      .toBe("fast");
    await page.reload();
    await expect(page.getByRole("button", { name: "Speed: Fast" })).toBeVisible();
    expect((await (await request.get(configUrl)).json()).reasoning_effort).toBe(initialReasoning);
  });
}
