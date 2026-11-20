import path from "node:path";
import { expect, test, waitForRunIdle } from "./harness";
import { startSessionFromHome } from "./focus-embedded-helpers";
import { modelChip, openModelCatalog, openModelSettings } from "./speed-controls";

test.use({ codexCatalogFixture: true });

test("native OpenAI speed survives composer settings, protocol changes and restart", async ({
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
      config_version: number;
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
  await expect(modelChip(page)).toHaveAccessibleName(/GPT-6.1 Sol, High reasoning/);
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  if (mobile) {
    const label = modelChip(page).locator("span").first();
    await expect(label).toHaveText(/GPT-6\.1 Sol\s*High/);
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
  await openModelSettings(page);
  const speed = (name: string) => page.getByRole("button", { name: `Speed: ${name}` });
  const initialSpeed = speed("Provider default");
  if (mobile) {
    const size = await initialSpeed.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);
  }
  await initialSpeed.click();
  await expect(page.getByRole("menuitemradio", { checked: true })).toHaveCount(0);
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
  await expect(modelChip(page)).toBeFocused();
  await openModelSettings(page);
  await expect(page.getByText(/Faster tiers cost more and depend on project access/)).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenAI pricing" })).toHaveAttribute(
    "href",
    "https://developers.openai.com/api/docs/pricing",
  );
  const initial = await config();
  const newer = await request.patch(configUrl, {
    data: {
      expected_config_version: initial.config_version,
      orchestrator_compaction_threshold: 1,
    },
  });
  expect(newer.ok(), await newer.text()).toBe(true);
  const stale = page.waitForResponse(
    (response) => response.url() === configUrl && response.request().method() === "PATCH",
  );
  await speed("Provider default").click();
  await page.getByRole("menuitemradio", { name: "Fast", exact: true }).click();
  expect((await stale).status()).toBe(409);
  await expect(page.getByText(/configuration changed or is busy/i)).toBeVisible();
  await expect(modelChip(page)).toBeDisabled();
  const afterConflict = await config();
  expect(afterConflict.service_tier ?? null).toBeNull();
  expect(afterConflict.config_version).toBe(initial.config_version + 1);
  await page.reload();
  await openModelSettings(page);
  await speed("Provider default").click();
  await expect(page.getByRole("menuitemradio", { checked: true })).toHaveCount(0);
  const writes: unknown[] = [];
  const loseAck = async (route: import("@playwright/test").Route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    writes.push(route.request().postDataJSON());
    const accepted = await route.fetch();
    expect(accepted.ok(), await accepted.text()).toBe(true);
    await route.abort("failed");
  };
  await page.route(configUrl, loseAck);
  await page.getByRole("menuitemradio", { name: "Standard", exact: true }).click();
  await expect(page.getByText(/configuration save outcome is unknown/i)).toBeVisible();
  await expect(modelChip(page)).toBeDisabled();
  await expect(modelChip(page)).toHaveAccessibleName(/Standard speed/);
  expect(writes).toEqual([
    { service_tier: "standard", expected_config_version: afterConflict.config_version },
  ]);
  expect(await config()).toMatchObject({
    service_tier: "standard",
    config_version: afterConflict.config_version + 1,
    reasoning_effort: "high",
  });
  await page.unroute(configUrl, loseAck);
  await page.reload();
  await openModelSettings(page);
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
  await expect(modelChip(page)).toBeFocused();

  // Both protocol rows use the same model; picker order follows the catalog's
  // Responses, Chat Completions, then Codex provider ordering.
  const models = await openModelCatalog(page, "gpt-6.1-sol");
  const modelRows = models.getByRole("menuitemradio", { name: /^GPT-6\.1 Sol/i });
  await expect(modelRows).toHaveCount(3);
  await modelRows.nth(1).click();
  await expect.poll(async () => (await config()).backend).toBe("openai-chat-completions");
  await expect.poll(async () => (await config()).service_tier).toBe("standard");
  await expect(page.getByText(/speed changed to Standard/i)).toBeVisible();
  const afterSwitch = await config();
  expect(afterSwitch).toMatchObject({
    model: "gpt-6.1-sol",
    base_url: "https://api.openai.com/v1",
    reasoning_effort: "high",
  });
  const fast = page.getByRole("switch", { name: "Fast speed" });
  await expect(fast).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("link", { name: "OpenAI pricing" })).toBeVisible();
  if (mobile) {
    const size = await fast.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);
  }
  if (process.env.NAC_VISUAL_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-fast-only-standard-mobile.png" : "after-fast-only-standard.png",
      ),
    });
  }
  await fast.click();
  await expect.poll(async () => (await config()).service_tier).toBe("fast");
  await expect(fast).toHaveAttribute("aria-checked", "true");
  if (process.env.NAC_VISUAL_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-fast-only-fast-mobile.png" : "after-fast-only-fast.png",
      ),
    });
  }
  await fast.click();
  await expect.poll(async () => (await config()).service_tier).toBe("standard");
  await expect(fast).toHaveAttribute("aria-checked", "false");
  await fast.click();
  await expect.poll(async () => (await config()).service_tier).toBe("fast");
  await page.reload();
  await openModelSettings(page);
  await expect(fast).toHaveAttribute("aria-checked", "true");
  if (process.env.NAC_VISUAL_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.NAC_VISUAL_DIR,
        mobile ? "after-fast-only-selected-mobile.png" : "after-fast-only-selected.png",
      ),
    });
  }

  await openModelCatalog(page, "gpt-6.1-sol");
  await modelRows.nth(2).click();
  await expect.poll(async () => (await config()).backend).toBe("chatgpt-codex-responses");
  await expect.poll(async () => (await config()).service_tier).toBe("fast");
  await openModelCatalog(page, "gpt-6.1-sol");
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
  const settings = await openModelSettings(page);
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
  await settings.getByRole("button", { name: "Speed: Fast (unavailable)" }).click();
  await page.getByRole("menuitemradio", { name: "Standard", exact: true }).click();
  await expect.poll(async () => (await config()).service_tier).toBe("standard");
  await page.unroute(`${harness.baseUrl}/models`);
  await harness.restart(undefined, true);
  await page.reload();
  await expect(modelChip(page)).toHaveAccessibleName(/Standard speed/);
  expect((await config()).service_tier).toBe("standard");
});

test("new project chats use only their explicitly selected speed", async ({ harness, request }) => {
  const project = await request.post(`${harness.baseUrl}/projects`, {
    data: { name: "Speed project", cwd: path.join(harness.runRoot, "workspace") },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const projectId = (await project.json()).project_id;
  const body = {
    project_id: projectId,
    backend: "openai-responses",
    model: "gpt-6.1-sol",
    base_url: "https://api.openai.com/v1",
    api_key_env: "OPENAI_API_KEY",
  };
  for (const serviceTier of [null, "standard"]) {
    const response = await request.post(`${harness.baseUrl}/sessions`, {
      data: { ...body, service_tier: serviceTier },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const id = (await response.json()).metadata.session_id;
    expect(
      (await (await request.get(`${harness.baseUrl}/sessions/${id}/config`)).json()).service_tier ??
        null,
    ).toBe(serviceTier);
  }
});

test("Home carries explicit model speed into each new project session", async ({
  harness,
  page,
  request,
}) => {
  const project = await request.post(`${harness.baseUrl}/projects`, {
    data: { name: "Explicit speed", cwd: path.join(harness.runRoot, "workspace") },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const projectId = (await project.json()).project_id;
  await page.route(
    (url) => /\/sessions\/[^/]+\/runs$/.test(url.pathname),
    (route) => (route.request().method() === "POST" ? route.abort() : route.fallback()),
  );
  let first = true;
  for (const [label, tier] of [
    ["Fast", "fast"],
    ["Standard", "standard"],
  ] as const) {
    if (first) {
      await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
      first = false;
    } else {
      await page.getByRole("button", { name: "New session in Explicit speed" }).click();
    }
    const catalog = await openModelCatalog(page, "gpt-6.1-sol");
    await catalog
      .getByRole("group", { name: "OpenAI", exact: true })
      .getByRole("menuitemradio", { name: /^GPT-6\.1|^gpt-6\.1/i })
      .click();
    const dialog = await openModelSettings(page);
    await dialog.getByRole("button", { name: /^Speed:/ }).click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const create = page.waitForRequest(
      (candidate) => candidate.method() === "POST" && candidate.url().endsWith("/sessions"),
    );
    const id = await startSessionFromHome(page, `Explicit ${label} session`, {
      runAdmission: "aborted",
    });
    expect((await create).postDataJSON()).toMatchObject({
      project_id: projectId,
      first_chat: tier === "fast",
      backend: "openai-responses",
      model: "gpt-6.1-sol",
      service_tier: tier,
    });
    const config = await request.get(`${harness.baseUrl}/sessions/${id}/config`);
    expect(config.ok()).toBeTruthy();
    expect((await config.json()).service_tier).toBe(tier);
  }
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
  await openModelSettings(page);
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
  await openModelSettings(page);
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
