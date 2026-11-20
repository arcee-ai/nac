import path from "node:path";
import { createDirectSession, expect, test } from "./harness";
import { modelChip, openModelCatalog, openModelSettings } from "./speed-controls";

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
    const catalog = await openModelCatalog(page, "gpt-6.1-sol");
    await catalog.getByRole("menuitemradio", { name: /^GPT-6\.1-Sol/ }).click();
    const speed = page.getByRole("button", { name: "Speed: Provider default" });
    await openModelSettings(page);
    await expect(speed).toBeVisible();
    const snapshotPattern = new RegExp(`/sessions/${sessionId}(?:\\?.*)?$`);
    const failSnapshot = async (route: import("@playwright/test").Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 503, json: { error: "Fixture refresh unavailable" } });
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
    await page.route(`${harness.baseUrl}/providers/models`, async (route) => {
      if (route.request().postDataJSON().backend !== "deepseek-chat") return route.fallback();
      await route.fulfill({
        json: {
          base_url: "https://api.deepseek.com/v1",
          api_key_env: "DEEPSEEK_API_KEY",
          models: [{ id: "deepseek-chat", display_name: "DeepSeek Chat" }],
        },
      });
    });
    await page.goto(`${harness.baseUrl}/#/project/${project.project_id}`);
    await expect(modelChip(page)).toHaveAccessibleName(/Fast speed/);
    const chooseDeepSeek = async () => {
      const models = await openModelCatalog(page, "deepseek-chat");
      await models
        .getByRole("group", { name: "DeepSeek", exact: true })
        .getByRole("menuitemradio", { name: /^DeepSeek Chat/ })
        .click();
    };
    await chooseDeepSeek();
    await expect(
      page.getByRole("alert").filter({ hasText: "This model does not accept the selected speed." }),
    ).toBeVisible();
    await capture("inherited-speed-reconciliation");
    await page.getByRole("button", { name: "Switch model and clear speed" }).click();
    const settings = await openModelSettings(page);
    await expect(
      settings.getByRole("button", { name: "Choose model: DeepSeek Chat" }),
    ).toBeVisible();
    await expect(settings.getByRole("button", { name: /^Speed:/ })).toBeHidden();
  });
}
