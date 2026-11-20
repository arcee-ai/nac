import path from "node:path";
import { createDirectSession, expect, test } from "./harness";

test.use({ orchestration: "0", codexCatalogFixture: true });
test.skip(!process.env.NAC_VISUAL_DIR, "Explicit evidence capture only");

for (const mobile of [false, true]) {
  test(`refresh and inherited-speed repair (${mobile ? "phone" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    const width = mobile ? "mobile" : "desktop";
    const capture = async (state: string) => {
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(process.env.NAC_VISUAL_DIR!, `after-${width}-${state}.png`),
      });
    };
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
    await page.getByRole("button", { name: "Model" }).click();
    await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
    await page.getByRole("button", { name: /GPT-6\.1-Sol gpt-6\.1-sol/ }).click();
    const speed = page.getByRole("button", { name: "Speed: Provider default" });
    await expect(speed).toBeVisible();
    const snapshotPattern = new RegExp(`/sessions/${sessionId}(?:\\?.*)?$`);
    const failSnapshot = async (route: import("@playwright/test").Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 503, json: { error: "Fixture refresh unavailable" } });
    };
    await page.route(snapshotPattern, failSnapshot);
    await speed.click();
    await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry settings refresh" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Model" })).toBeDisabled();
    if (mobile) {
      const retry = await page
        .getByRole("button", { name: "Retry settings refresh" })
        .boundingBox();
      const model = await page.getByRole("button", { name: "Model" }).boundingBox();
      const send = await page.getByRole("button", { name: "Send", exact: true }).boundingBox();
      expect(retry?.width).toBeGreaterThanOrEqual(44);
      expect(retry?.height).toBeGreaterThanOrEqual(44);
      expect(model?.width).toBeGreaterThan(44);
      expect(model!.x + model!.width).toBeLessThanOrEqual(retry!.x);
      expect(retry!.x + retry!.width).toBeLessThanOrEqual(send!.x);
      await expect(speed).toHaveCount(0);
    }
    await capture("refresh-retry");
    await page.unroute(snapshotPattern, failSnapshot);
    await page.getByRole("button", { name: "Retry settings refresh" }).click();
    await expect(page.getByRole("button", { name: "Model" })).toBeEnabled();

    const presetResponse = await request.post(`${harness.baseUrl}/model-configs`, {
      data: {
        name: "Fast Codex default",
        backend: "chatgpt-codex-responses",
        model: "gpt-6.1-sol",
        reasoning_effort: "high",
        service_tier: "fast",
      },
    });
    expect(presetResponse.ok()).toBeTruthy();
    const preset = await presetResponse.json();
    const projectResponse = await request.post(`${harness.baseUrl}/projects`, {
      data: {
        name: "Speed repair fixture",
        cwd: path.join(harness.runRoot, "workspace"),
        default_model_config_id: preset.config_id,
      },
    });
    expect(projectResponse.ok()).toBeTruthy();
    const project = await projectResponse.json();
    await page.goto(`${harness.baseUrl}/#/project/${project.project_id}`);
    await page.getByRole("button", { name: /^Model: / }).click();
    const dialog = page.getByRole("dialog", { name: "Model for this session" });
    await dialog
      .getByRole("button", { name: "Advanced presets and provider setup", exact: true })
      .click();
    await dialog.getByRole("button").filter({ hasText: "Fast Codex default" }).click();
    await page.getByText("Browse Models", { exact: true }).click();
    await dialog.getByRole("group", { name: "Model*", exact: true }).getByRole("button").click();
    await page.getByPlaceholder("Search models…").fill("gpt-5.6-sol");
    await page
      .getByText("OpenAI Responses", { exact: true })
      .first()
      .locator("../..")
      .getByRole("button")
      .first()
      .click();
    await expect(
      dialog.getByRole("button", { name: "Use provider default for speed" }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Use provider default for speed" })
      .scrollIntoViewIfNeeded();
    await expect(page.getByText(/Settings were saved, but the latest session/)).toBeHidden();
    await expect(page.getByText("Speed set to Fast")).toBeHidden();
    await capture("inherited-speed-reconciliation");
    await dialog.getByRole("button", { name: "Use provider default for speed" }).click();
    await dialog.getByRole("button", { name: "Use this model" }).click();
    await expect(dialog).toBeHidden();
  });
}
