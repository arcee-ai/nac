import path from "node:path";
import { expect, test } from "./harness";
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
  const mobile = process.env.NAC_VISUAL_MOBILE === "1";
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await expect(page.getByRole("button", { name: "Model" })).toHaveAttribute(
    "title",
    /OpenAI Responses/,
  );
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
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
  if (mobile) {
    const info = page.getByRole("button", { name: "Speed pricing and access" });
    await expect(info).toBeVisible();
    const size = await info.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);
    await info.click();
    await expect(info).toHaveAttribute("aria-expanded", "true");
  }
  await expect(page.getByText(/Higher token cost; subject to your OpenAI project/)).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenAI pricing" })).toHaveAttribute(
    "href",
    "https://developers.openai.com/api/docs/pricing",
  );
  if (mobile) {
    if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL === "after") {
      await page.screenshot({
        path: path.join(process.env.NAC_VISUAL_DIR, "after-mobile-info.png"),
        animations: "disabled",
      });
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Speed pricing and access" })).toBeFocused();
    return;
  }
  const speed = (name: string) => page.getByRole("button", { name: `Speed: ${name}` });
  await speed("Provider default").click();
  await expect(page.getByRole("menuitemradio", { name: "Use provider default" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("menuitemradio", { name: "Standard", exact: true }).click();
  await expect.poll(async () => (await config()).service_tier).toBe("standard");
  await page.reload();
  await expect(speed("Standard")).toBeVisible();
  await speed("Standard").click();
  await page.getByRole("menuitemradio", { name: "Ultrafast", exact: true }).click();
  await expect.poll(async () => (await config()).service_tier).toBe("ultrafast");

  // Both protocol rows use the same model; picker order follows the catalog's
  // Responses, Chat Completions, then Codex provider ordering.
  await page.getByRole("button", { name: "Model" }).click();
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
  await speed("Standard").click();
  await expect.poll(async () => (await config()).service_tier).toBe("fast");
  await page.reload();
  await expect(speed("Fast")).toBeVisible();

  await page.getByRole("button", { name: "Model" }).click();
  await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
  await modelRows.nth(2).click();
  await expect.poll(async () => (await config()).backend).toBe("chatgpt-codex-responses");
  await expect.poll(async () => (await config()).service_tier).toBe("fast");
  await page.getByRole("button", { name: "Model" }).click();
  await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
  await modelRows.nth(1).click();
  await expect.poll(async () => (await config()).backend).toBe("openai-chat-completions");
  await expect.poll(async () => (await config()).service_tier).toBe("fast");

  await openSessionSettings(page);
  const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
  await settings.getByRole("button", { name: "Speed: Fast" }).click();
  await page.getByRole("menuitemradio", { name: "Use provider default" }).click();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toBeHidden();
  await expect.poll(async () => (await config()).service_tier ?? null).toBeNull();
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
