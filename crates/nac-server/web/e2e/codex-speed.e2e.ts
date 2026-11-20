import path from "node:path";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { startSessionFromHome } from "./focus-embedded-helpers";
import { modelChip, openModelCatalog, openModelSettings } from "./speed-controls";

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
    const catalog = await openModelCatalog(page, "gpt-6.1-sol");
    await catalog.getByRole("menuitemradio", { name: /^GPT-6\.1-Sol/ }).click();
    await expect
      .poll(async () => (await (await request.get(configUrl)).json()).model)
      .toBe("gpt-6.1-sol");
    await expect(page.getByRole("textbox", { name: "Search models" })).toBeHidden();
    await expect(page.getByText("Model switched to gpt-6.1-sol")).toBeHidden();
    const initialReasoning = (await (await request.get(configUrl)).json()).reasoning_effort;
    if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL === "before") {
      await page.screenshot({
        path: path.join(process.env.NAC_VISUAL_DIR, `before-${mobile ? "mobile" : "desktop"}.png`),
      });
      return;
    }
    const capture = async (state: string) => {
      if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL === "after") {
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(
            process.env.NAC_VISUAL_DIR,
            `after-${mobile ? "mobile" : "desktop"}-${state}.png`,
          ),
        });
      }
    };
    const speed = page.getByRole("button", { name: "Speed: Provider default" });
    await openModelSettings(page);
    await expect(speed).toBeVisible();
    if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL) {
      await page.screenshot({
        path: path.join(
          process.env.NAC_VISUAL_DIR,
          `${process.env.NAC_VISUAL_LABEL}-${mobile ? "mobile" : "desktop"}.png`,
        ),
      });
    }
    await expect(speed).toBeEnabled();
    await speed.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Ultrafast", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modelChip(page)).toBeFocused();
    await openModelSettings(page);
    await speed.click();
    await expect(page.getByRole("menuitemradio", { checked: true })).toHaveCount(0);
    await capture("menu");
    await page.keyboard.press("Escape");
    if (mobile) {
      await openModelSettings(page);
      const box = await speed.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const reject = async (route: import("@playwright/test").Route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({ status: 409, json: { error: "Configuration changed" } });
    };
    await page.route(configUrl, reject);
    await openModelSettings(page);
    await speed.click();
    await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
    await expect(page.getByText(/configuration changed or is busy/i)).toBeVisible();
    await capture("rejected");
    expect((await (await request.get(configUrl)).json()).service_tier ?? null).toBeNull();
    await page.unroute(configUrl, reject);
    await expect(modelChip(page)).toBeDisabled();
    await page.reload();
    await openModelSettings(page);
    const { config_version } = await (await request.get(configUrl)).json();
    await speed.click();
    const patch = page.waitForRequest((req) => req.url() === configUrl && req.method() === "PATCH");
    await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
    expect((await patch).postDataJSON()).toEqual({
      service_tier: "fast",
      expected_config_version: config_version,
    });
    await expect
      .poll(async () => (await (await request.get(configUrl)).json()).service_tier)
      .toBe("fast");
    await page.reload();
    await openModelSettings(page);
    const fastSpeed = page.getByRole("button", { name: "Speed: Fast" });
    await expect(fastSpeed).toBeVisible();
    await capture("selected");
    await fastSpeed.click();
    await expect(page.getByRole("menuitemradio", { name: "Fast", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await capture("selected-menu");
    await page.keyboard.press("Escape");
    expect((await (await request.get(configUrl)).json()).reasoning_effort).toBe(initialReasoning);
    await page.route(`${harness.baseUrl}/models`, async (route) => {
      const response = await route.fetch();
      const catalog = await response.json();
      const provider = catalog.providers.find(
        (entry: { id: string }) => entry.id === "chatgpt-codex-responses",
      );
      const model = provider.models.find((entry: { id: string }) => entry.id === "gpt-6.1-sol");
      model.service_tiers = [];
      await route.fulfill({ response, json: catalog });
    });
    await page.reload();
    const settings = await openModelSettings(page);
    const repair = settings.getByRole("button", { name: "Speed: Fast (unavailable)" });
    await expect(repair).toBeVisible();
    await capture("unavailable");
    await repair.click();
    await settings.getByRole("menuitemradio", { name: "Standard", exact: true }).click();
    await expect
      .poll(async () => (await (await request.get(configUrl)).json()).service_tier)
      .toBe("standard");
  });
}

test("the Home composer uses a saved Fast preset for the first project chat", async ({
  harness,
  page,
  request,
}) => {
  const presetResponse = await request.post(`${harness.baseUrl}/model-configs`, {
    data: {
      name: "Fast Codex setup",
      backend: "chatgpt-codex-responses",
      model: "gpt-6.1-sol",
      reasoning_effort: "high",
      service_tier: "fast",
    },
  });
  expect(presetResponse.ok()).toBeTruthy();
  const preset = await presetResponse.json();
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
  const createdProject = await request.post(`${harness.baseUrl}/projects`, {
    data: {
      name: "Codex speed fixture",
      cwd: path.join(harness.runRoot, "workspace"),
      default_model_config_id: preset.config_id,
    },
  });
  expect(createdProject.ok()).toBeTruthy();
  const projectId = (await createdProject.json()).project_id;
  await page.route(
    (url) => /\/sessions\/[^/]+\/runs$/.test(url.pathname),
    (route) => (route.request().method() === "POST" ? route.abort() : route.fallback()),
  );
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  await expect(modelChip(page)).toHaveAccessibleName(/High reasoning, Fast speed/);
  const settings = await openModelSettings(page);
  await expect(settings.getByRole("button", { name: "Speed: Fast" })).toBeVisible();
  await page.keyboard.press("Escape");
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url() === `${harness.baseUrl}/sessions`,
  );
  const sessionId = await startSessionFromHome(page, "Keep the project speed", {
    runAdmission: "aborted",
  });
  const response = await created;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON()).toMatchObject({
    first_chat: true,
    project_id: projectId,
  });
  expect(
    await (await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`)).json(),
  ).toMatchObject({ service_tier: "fast", reasoning_effort: "high" });
});

test("provider downgrade receipt and estimate warning survive reload", async ({
  harness,
  page,
  request,
}) => {
  test.skip(
    process.env.NAC_E2E_CODEX_FIXTURE !== "1",
    "Requires the isolated feature-gated Codex provider fixture",
  );
  const created = await request.post(`${harness.baseUrl}/sessions`, {
    data: {
      behavior: "direct",
      cwd: path.join(harness.runRoot, "workspace"),
      backend: "chatgpt-codex-responses",
      model: "gpt-6.1-sol",
      reasoning_effort: "high",
      service_tier: "fast",
    },
  });
  expect(created.ok()).toBeTruthy();
  const sessionId = (await created.json()).metadata.session_id;
  harness.provider.enqueue(
    "codex-tier-response",
    { token: "CODEX_TIER_RECEIPT" },
    {
      kind: "text",
      text: "Fixture response with provider downgrade.",
      stream: true,
      service_tier: "default",
      usage: { input_tokens: 40, output_tokens: 5, total_tokens: 45 },
    },
  );
  const run = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "CODEX_TIER_RECEIPT" },
  });
  expect(run.ok()).toBeTruthy();
  await waitForRunIdle(request, harness, sessionId);
  const upstream = harness.provider.requests.find(
    (entry) => entry.matchedStep === "codex-tier-response",
  );
  expect(upstream?.body).toMatchObject({ service_tier: "priority", reasoning: { effort: "high" } });
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/insights`);
  await expect(
    page.getByText("Requested speed: Fast; served tier: Standard (provider downgrade)"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Requested speed: Fast; served tier: Standard (provider downgrade)"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Session menu", exact: true }).click();
  await expect(page.getByText("Base-rate estimate; speed-tier charges excluded.")).toBeVisible();
  await expect(
    page.getByText("API-equivalent estimate, not subscription allowance or credits."),
  ).toBeVisible();
});
