import path from "node:path";

import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { openSessionSettings } from "./nav-focus-helpers";

test.use({ orchestration: "0", codexCatalogFixture: true });

test("selects a discovered Codex model and agrees with runtime input budget", async ({
  harness,
  page,
  request,
}) => {
  const catalog = await (await request.get(`${harness.baseUrl}/models`)).json();
  const model = catalog.providers
    .find((provider: { id: string }) => provider.id === "chatgpt-codex-responses")
    .models.find((entry: { id: string }) => entry.id === "gpt-6.1-sol");
  expect(model.limits).toMatchObject({
    context_window: 500_000,
    effective_input_tokens: 475_000,
    context_origin: "observed",
    input_origin: "profile",
    output_origin: "estimated",
  });

  const sessionId = await createDirectSession(request, harness);
  harness.provider.enqueue(
    "codex-context",
    { token: "CONTEXT_FIXTURE" },
    {
      kind: "text",
      text: "ready",
      usage: { input_tokens: 40_597, output_tokens: 3, total_tokens: 40_600 },
    },
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
        data: { prompt: "CONTEXT_FIXTURE" },
      })
    ).ok(),
  ).toBeTruthy();
  await waitForRunIdle(request, harness, sessionId);
  await page.route(`${harness.baseUrl}/providers/models`, async (route) => {
    if (route.request().postDataJSON().backend !== "chatgpt-codex-responses")
      return route.fallback();
    await route.fulfill({
      json: {
        base_url: "https://chatgpt.com/backend-api",
        api_key_env: null,
        models: [
          { id: "gpt-6.1-sol", display_name: "GPT-6.1-Sol" },
          { id: "gpt-6-astra", display_name: "GPT-6-Astra" },
        ],
      },
    });
  });
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await page.getByRole("button", { name: "Model" }).click();
  await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
  await page.getByRole("button", { name: /GPT-6\.1-Sol gpt-6\.1-sol/ }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`)).json()).model,
    )
    .toBe("gpt-6.1-sol");
  await page.getByRole("button", { name: "Session menu" }).click();
  await expect(
    page.getByText("9% of the model's effective input budget (provider profile)"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Model" }).click();
  await page.getByPlaceholder("Search models…").fill("gpt-6-astra");
  await page.getByRole("button", { name: /GPT-6-Astra gpt-6-astra/ }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`)).json()).model,
    )
    .toBe("gpt-6-astra");
  await page.getByRole("button", { name: "Session menu" }).click();
  await expect(page.getByText("33% of the estimated input budget for this model.")).toBeVisible();

  const created = await request.post(`${harness.baseUrl}/sessions`, {
    data: {
      behavior: "direct",
      cwd: path.join(harness.runRoot, "workspace"),
      backend: "chatgpt-codex-responses",
      model: "gpt-6.1-sol",
      reasoning_effort: "medium",
    },
  });
  expect(created.ok()).toBeTruthy();
  const newId = (await created.json()).metadata.session_id;
  const configUrl = `${harness.baseUrl}/sessions/${newId}/config`;
  expect((await (await request.get(configUrl)).json()).orchestrator_compaction_threshold).toBe(
    332_500,
  );
  await page.goto(`${harness.baseUrl}/#/session/${newId}/delegated`);
  await openSessionSettings(page);
  const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
  await settings.getByText("Advanced execution settings", { exact: true }).click();
  await settings.getByRole("button", { name: "Advanced Configurations", exact: true }).click();
  await expect(settings.getByRole("textbox", { name: "Context limit", exact: true })).toHaveValue(
    "332500",
  );
  await settings.getByRole("textbox", { name: "Context limit", exact: true }).fill("123456");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  expect((await (await request.get(configUrl)).json()).orchestrator_compaction_threshold).toBe(
    123_456,
  );
});
