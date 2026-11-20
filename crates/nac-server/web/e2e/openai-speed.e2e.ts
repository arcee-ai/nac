import path from "node:path";
import { expect, test, waitForRunIdle } from "./harness";
import { startSessionFromHome } from "./focus-embedded-helpers";
import { openSessionSettings } from "./nav-focus-helpers";

test.use({ orchestration: "0", codexCatalogFixture: true });

test("native OpenAI speed survives settings, protocol changes and restart", async ({
  harness,
  page,
  request,
}) => {
  const created = await request.post(`${harness.baseUrl}/sessions`, {
    data: {
      behavior: "direct",
      cwd: path.join(harness.runRoot, "workspace"),
      backend: "openai-responses",
      model: "gpt-6.1-sol",
      base_url: "https://api.openai.com/v1",
      reasoning_effort: "high",
      api_key_env: "OPENAI_API_KEY",
      extra_headers: {},
      orchestrator_compaction_threshold: 0,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const sessionId = (await created.json()).metadata.session_id as string;
  const configUrl = `${harness.baseUrl}/sessions/${sessionId}/config`;
  const config = async () =>
    (await (await request.get(configUrl)).json()) as {
      backend: string;
      model: string;
      base_url: string;
      reasoning_effort: string;
      service_tier: string | null;
    };
  // Keep provider model discovery deterministic and off public endpoints;
  // capability metadata still comes from the production catalog.
  await page.route(`${harness.baseUrl}/providers/models`, async (route) => {
    const backend = route.request().postDataJSON().backend;
    if (
      !["openai-responses", "openai-chat-completions", "chatgpt-codex-responses"].includes(backend)
    )
      return route.fallback();
    await route.fulfill({
      json: {
        base_url:
          backend === "chatgpt-codex-responses"
            ? "https://chatgpt.com/backend-api"
            : "https://api.openai.com/v1",
        api_key_env: backend === "chatgpt-codex-responses" ? null : "OPENAI_API_KEY",
        models: [{ id: "gpt-6.1-sol", display_name: "GPT-6.1 Sol" }],
      },
    });
  });
  const mobile = process.env.NAC_VISUAL_MOBILE === "1";
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await expect(page.getByRole("button", { name: "Model", exact: true })).toHaveAttribute(
    "title",
    /OpenAI Responses/,
  );
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  if (mobile) {
    const label = page.getByRole("button", { name: "Model", exact: true }).locator("span").first();
    await expect(label).toHaveText("GPT-6.1 Sol");
    await expect
      .poll(async () => label.evaluate((node) => node.scrollWidth <= node.clientWidth))
      .toBe(true);
  }
  if (process.env.NAC_VISUAL_DIR) await page.waitForTimeout(1000);
  if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL === "before") {
    await page.screenshot({
      path: path.join(process.env.NAC_VISUAL_DIR, mobile ? "before-mobile.png" : "before.png"),
      animations: "disabled",
    });
    return;
  }
  if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL === "after") {
    await page.screenshot({
      path: path.join(process.env.NAC_VISUAL_DIR, mobile ? "after-mobile.png" : "after.png"),
      animations: "disabled",
    });
  }
  const speed = (name: string) => page.getByRole("button", { name: `Speed: ${name}` });
  const initialSpeed = speed("Provider default");
  if (mobile) {
    const size = await initialSpeed.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);
  }
  await initialSpeed.click();
  await expect(page.getByRole("menuitemradio", { name: "Use provider default" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL === "after") {
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-mobile-menu.png" : "after-menu.png",
      ),
    });
  }
  await page.keyboard.press("Escape");
  await expect(initialSpeed).toBeFocused();
  const disclosure = page.getByRole("button", { name: "Speed pricing and access" });
  await disclosure.click();
  await expect(page.getByText(/Higher token cost; subject to your OpenAI project/)).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenAI pricing" })).toHaveAttribute(
    "href",
    "https://developers.openai.com/api/docs/pricing",
  );
  await page.keyboard.press("Escape");
  await expect(disclosure).toBeFocused();
  const rejectSave = async (route: import("@playwright/test").Route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status: 409, json: { error: "Configuration changed" } });
  };
  await page.route(configUrl, rejectSave);
  await speed("Provider default").click();
  await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
  await expect(page.getByText(/Speed was not changed/)).toBeVisible();
  if (process.env.NAC_VISUAL_DIR)
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-rejected-save-mobile.png" : "after-rejected-save.png",
      ),
      animations: "disabled",
    });
  expect((await config()).service_tier ?? null).toBeNull();
  await page.unroute(configUrl, rejectSave);
  await speed("Provider default").click();
  await expect(page.getByRole("menuitemradio", { name: "Use provider default" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("menuitemradio", { name: "Standard", exact: true }).click();
  await expect.poll(async () => (await config()).service_tier).toBe("standard");
  await page.reload();
  await expect(speed("Standard")).toBeVisible();
  if (process.env.NAC_VISUAL_DIR) await page.waitForTimeout(1000);
  if (process.env.NAC_VISUAL_DIR)
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-selected-mobile.png" : "after-selected.png",
      ),
      animations: "disabled",
    });
  await speed("Standard").click();
  await page.getByRole("menuitemradio", { name: "Ultrafast", exact: true }).click();
  await expect.poll(async () => (await config()).service_tier).toBe("ultrafast");
  await expect(speed("Ultrafast")).toBeVisible();
  await speed("Ultrafast").click();
  const selectedUltra = page.getByRole("menuitemradio", { name: "Ultrafast" });
  await expect(selectedUltra).toHaveAttribute("aria-checked", "true");
  await expect(selectedUltra.locator("svg")).toBeVisible();
  if (process.env.NAC_VISUAL_DIR) {
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-ultra-selected-menu-mobile.png" : "after-ultra-selected-menu.png",
      ),
    });
  }
  await page.keyboard.press("Escape");
  await expect(speed("Ultrafast")).toBeFocused();

  // Both protocol rows use the same model; picker order follows the catalog's
  // Responses, Chat Completions, then Codex provider ordering.
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
  const modelRows = page
    .getByRole("group", { name: "Model results" })
    .getByRole("button", { name: /GPT-6\.1.Sol.*gpt-6\.1-sol/i });
  await expect(modelRows).toHaveCount(3);
  await modelRows.nth(1).click();
  await expect.poll(async () => (await config()).backend).toBe("openai-chat-completions");
  await expect.poll(async () => (await config()).service_tier).toBe("standard");
  await expect(page.getByText(/speed reset to Standard/)).toBeVisible();
  const afterSwitch = await config();
  expect(afterSwitch).toMatchObject({
    model: "gpt-6.1-sol",
    base_url: "https://api.openai.com/v1",
    reasoning_effort: "high",
  });
  await expect(speed("Standard")).toHaveAttribute("aria-pressed", "false");
  if (process.env.NAC_VISUAL_DIR) {
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-fast-only-standard-mobile.png" : "after-fast-only-standard.png",
      ),
    });
  }
  const pricing = page.getByRole("button", { name: "Speed pricing and access" });
  await expect(pricing).toBeVisible();
  if (mobile) {
    const size = await pricing.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);
  }
  await pricing.click();
  await expect(page.getByText(/Higher token cost; subject to your OpenAI project/)).toBeVisible();
  if (process.env.NAC_VISUAL_DIR) {
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-fast-info-mobile.png" : "after-fast-info.png",
      ),
    });
  }
  await page.keyboard.press("Escape");
  await expect(pricing).toBeFocused();
  await speed("Standard").click();
  await expect.poll(async () => (await config()).service_tier).toBe("fast");
  await expect(speed("Fast")).toHaveAttribute("aria-pressed", "true");
  if (process.env.NAC_VISUAL_DIR) {
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-fast-only-fast-mobile.png" : "after-fast-only-fast.png",
      ),
    });
  }
  await speed("Fast").click();
  await expect.poll(async () => (await config()).service_tier).toBe("standard");
  await speed("Standard").click();
  await expect.poll(async () => (await config()).service_tier).toBe("fast");
  await page.reload();
  await expect(speed("Fast")).toBeVisible();

  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
  await modelRows.nth(2).click();
  await expect.poll(async () => (await config()).backend).toBe("chatgpt-codex-responses");
  await expect.poll(async () => (await config()).service_tier).toBe("fast");
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
  await modelRows.nth(1).click();
  await expect.poll(async () => (await config()).backend).toBe("openai-chat-completions");
  await expect.poll(async () => (await config()).service_tier).toBe("fast");

  // Model metadata may stop advertising a saved choice. It must stay visible
  // in settings and be repairable without silently changing the stored value.
  await page.route(`${harness.baseUrl}/models`, async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    const provider = catalog.providers.find(
      (entry: { id: string }) => entry.id === "openai-chat-completions",
    );
    provider.speed_profiles["gpt-6.1-sol"].tiers = ["standard"];
    await route.fulfill({ response, json: catalog });
  });
  await page.reload();
  await openSessionSettings(page);
  const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
  await expect(settings.getByText("Fast (unavailable)")).toBeVisible();
  if (process.env.NAC_VISUAL_DIR)
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-unavailable-mobile.png" : "after-unavailable.png",
      ),
      animations: "disabled",
    });
  expect((await config()).service_tier).toBe("fast");
  await settings.getByRole("button", { name: "Speed: Fast" }).click();
  await page.getByRole("menuitemradio", { name: "Use provider default" }).click();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toBeHidden();
  await expect.poll(async () => (await config()).service_tier ?? null).toBeNull();
  await page.unroute(`${harness.baseUrl}/models`);
  await harness.restart("0", undefined, true);
  await page.reload();
  await expect(speed("Provider default")).toBeVisible();
  expect((await config()).service_tier ?? null).toBeNull();
});

test("new chats inherit project speed and can explicitly choose Standard", async ({
  harness,
  page,
  request,
}) => {
  const configuration = await request.post(`${harness.baseUrl}/model-configs`, {
    data: {
      name: "Native OpenAI speed fixture",
      backend: "openai-chat-completions",
      model: "gpt-6.1-sol",
      base_url: "https://api.openai.com/v1",
      api_key: "e2e-only",
      reasoning_effort: "high",
      service_tier: "fast",
      extra_headers: {},
      orchestrator_compaction_threshold: 0,
    },
  });
  expect(configuration.ok(), await configuration.text()).toBe(true);
  const configId = (await configuration.json()).config_id;
  const project = await request.post(`${harness.baseUrl}/projects`, {
    data: {
      name: "Speed project",
      cwd: path.join(harness.runRoot, "workspace"),
      default_model_config_id: configId,
    },
  });
  expect(project.ok(), await project.text()).toBe(true);
  const projectId = (await project.json()).project_id;
  // A native endpoint is never contacted: hold Home's first-run admission.
  await page.route(
    (url) => /\/sessions\/[^/]+\/runs$/.test(url.pathname),
    (route) => (route.request().method() === "POST" ? route.abort() : route.fallback()),
  );
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  await page.getByRole("button", { name: /^(Model: |Choose a model$)/ }).click();
  const dialog = page.getByRole("dialog", { name: "Model for this session", exact: true });
  await expect(dialog.getByRole("button", { name: "Speed: Fast" })).toBeVisible();
  await dialog.getByRole("button", { name: "Speed: Fast" }).click();
  await page.getByRole("menuitemradio", { name: "Standard", exact: true }).click();
  await dialog.getByRole("button", { name: "Use this model", exact: true }).click();
  const create = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/sessions"),
  );
  const sessionId = await startSessionFromHome(page, "Speed project journey", {
    runAdmission: "aborted",
  });
  const body = (await create).postDataJSON();
  expect(body).toMatchObject({ project_id: projectId, service_tier: "standard" });
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`)).json())
      .service_tier,
  ).toBe("standard");
});

test("native policy rejection remains repairable and a served receipt survives reload", async ({
  harness,
  page,
  request,
}) => {
  test.skip(
    process.env.NAC_E2E_OPENAI_FIXTURE !== "1",
    "Requires feature-gated native OpenAI fixture",
  );
  // Only the isolated feature build may run a native fixture journey. An
  // ordinary binary would ignore the transport override and contact OpenAI.
  expect(process.env.NAC_E2E_BINARY).toContain("/target/openai-e2e-fixture/");
  const mobile = process.env.NAC_VISUAL_MOBILE === "1";
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const created = await request.post(`${harness.baseUrl}/sessions`, {
    data: {
      behavior: "direct",
      cwd: path.join(harness.runRoot, "workspace"),
      backend: "openai-responses",
      model: "gpt-6.1-sol",
      base_url: "https://api.openai.com/v1",
      api_key_env: "OPENAI_API_KEY",
      reasoning_effort: "high",
      service_tier: "fast",
      extra_headers: {},
      orchestrator_compaction_threshold: 0,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const sessionId = (await created.json()).metadata.session_id as string;
  const configUrl = `${harness.baseUrl}/sessions/${sessionId}/config`;
  harness.provider.enqueue(
    "native-rejected",
    { token: "NATIVE_REJECT" },
    {
      kind: "http_error",
      status: 400,
      body: {
        type: "invalid_request_error",
        param: "service_tier",
        message: "Project tier policy denied",
      },
    },
  );
  const run = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "NATIVE_REJECT" },
  });
  expect(run.ok(), await run.text()).toBe(true);
  await waitForRunIdle(request, harness, sessionId);
  expect((await (await request.get(configUrl)).json()).service_tier).toBe("fast");
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/insights`);
  await page.getByText("Diagnostics", { exact: true }).click();
  await expect(page.getByText(/Project tier policy denied/)).toBeVisible();
  await expect(page.getByText(/choose Standard|project.*access/i)).toBeVisible();
  if (process.env.NAC_VISUAL_DIR)
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-provider-rejection-mobile.png" : "after-provider-rejection.png",
      ),
      animations: "disabled",
    });
  await page.getByRole("button", { name: "Speed: Fast" }).click();
  await page.getByRole("menuitemradio", { name: "Standard", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(configUrl)).json()).service_tier)
    .toBe("standard");
  harness.provider.enqueue(
    "native-recovered",
    { token: "NATIVE_RECOVER" },
    {
      kind: "text",
      text: "Native fixture recovered.",
      stream: "request",
      service_tier: "default",
      usage: { input_tokens: 40, output_tokens: 5, total_tokens: 45 },
    },
  );
  const retry = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "NATIVE_RECOVER" },
  });
  expect(retry.ok(), await retry.text()).toBe(true);
  await waitForRunIdle(request, harness, sessionId);
  const rejected = harness.provider.requests.find(
    (entry) => entry.matchedStep === "native-rejected",
  );
  const recovered = harness.provider.requests.find(
    (entry) => entry.matchedStep === "native-recovered",
  );
  expect(rejected?.body).toMatchObject({ service_tier: "priority", reasoning: { effort: "high" } });
  expect(recovered?.body).toMatchObject({ service_tier: "default", reasoning: { effort: "high" } });
  await expect(page.getByText("Native fixture recovered.")).toBeVisible();
  await expect(page.getByText("Requested speed: Standard; served tier: Standard")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Requested speed: Standard; served tier: Standard")).toBeVisible();
  await page.getByRole("button", { name: "Speed: Standard" }).click();
  await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(configUrl)).json()).service_tier)
    .toBe("fast");
  harness.provider.enqueue(
    "native-downgrade",
    { token: "NATIVE_DOWNGRADE" },
    {
      kind: "text",
      text: "Native fixture downgraded.",
      stream: "request",
      service_tier: "default",
      usage: { input_tokens: 40, output_tokens: 5, total_tokens: 45 },
    },
  );
  const downgrade = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "NATIVE_DOWNGRADE" },
  });
  expect(downgrade.ok(), await downgrade.text()).toBe(true);
  await waitForRunIdle(request, harness, sessionId);
  await expect(
    page.getByText("Requested speed: Fast; served tier: Standard (provider downgrade)"),
  ).toBeVisible();
  expect((await (await request.get(configUrl)).json()).service_tier).toBe("fast");
  const transcript = await (
    await request.get(`${harness.baseUrl}/sessions/${sessionId}/messages?limit=200`)
  ).json();
  expect(JSON.stringify(transcript)).toContain('"requested":"fast","served":"default"');
  const downgradeRequest = harness.provider.requests.find(
    (entry) => entry.matchedStep === "native-downgrade",
  );
  expect(JSON.stringify(downgradeRequest?.body)).not.toContain("service_tier_receipt");
  await page.reload();
  await expect(
    page.getByText("Requested speed: Fast; served tier: Standard (provider downgrade)"),
  ).toBeVisible();
  if (process.env.NAC_VISUAL_DIR)
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-downgrade-mobile.png" : "after-downgrade.png",
      ),
      animations: "disabled",
    });
  harness.provider.assertConsumed();
});
