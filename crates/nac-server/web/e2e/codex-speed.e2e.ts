import path from "node:path";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { openSessionSettings } from "./nav-focus-helpers";

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
    await capture("menu");
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
    await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
    await expect(page.getByText(/Speed was not changed/)).toBeVisible();
    await capture("rejected");
    expect((await (await request.get(configUrl)).json()).service_tier ?? null).toBeNull();
    await page.unroute(configUrl, reject);
    await speed.click();
    const patch = page.waitForRequest((req) => req.url() === configUrl && req.method() === "PATCH");
    await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
    expect((await patch).postDataJSON()).toEqual({ service_tier: "fast" });
    await expect
      .poll(async () => (await (await request.get(configUrl)).json()).service_tier)
      .toBe("fast");
    await page.reload();
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
    await openSessionSettings(page);
    const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
    await expect(settings.getByText("Fast (unavailable)")).toBeVisible();
    await settings.getByText("Fast (unavailable)").scrollIntoViewIfNeeded();
    await capture("unavailable");
    await settings.getByRole("button", { name: "Speed: Fast" }).click();
    await page.getByRole("menuitemradio", { name: "Use provider default" }).click();
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings).toBeHidden();
    await expect
      .poll(async () => (await (await request.get(configUrl)).json()).service_tier ?? null)
      .toBeNull();
  });
}

test("a Fast preset survives simple and advanced setup into the first project chat", async ({
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
  await page.goto(harness.baseUrl);
  await page.getByRole("button", { name: "Get Started", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New Project", exact: true });
  await expect(dialog.getByRole("button", { name: "Speed: Fast" })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Advanced presets and provider setup", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Back to unified models", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Speed: Fast" })).toBeVisible();
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url() === `${harness.baseUrl}/sessions`,
  );
  await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
  const response = await created;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON()).toMatchObject({
    first_chat: true,
    service_tier: "fast",
    reasoning_effort: "high",
  });
  const metadata = (await response.json()).metadata;
  const projects = await (await request.get(`${harness.baseUrl}/projects`)).json();
  expect(
    projects.projects.find(
      (project: { project_id: string }) => project.project_id === metadata.project_id,
    )?.default_model_config_id,
  ).toBe(preset.config_id);
  expect(
    await (await request.get(`${harness.baseUrl}/sessions/${metadata.session_id}/config`)).json(),
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
  await expect(page.getByText("Requested speed: fast; served tier: default")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Requested speed: fast; served tier: default")).toBeVisible();
  await openSessionSettings(page); // Settle the post-reload surface before opening usage.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Session menu", exact: true }).click();
  await expect(page.getByText("Base-rate estimate; speed-tier charges excluded.")).toBeVisible();
  await expect(
    page.getByText("API-equivalent estimate, not subscription allowance or credits."),
  ).toBeVisible();
});
