import path from "node:path";

import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { openModelList } from "./focus-embedded-helpers";

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
  const sol = await openModelList(page);
  await page.getByRole("textbox", { name: "Search models", exact: true }).fill("gpt-6.1-sol");
  await sol
    .getByText("ChatGPT", { exact: true })
    .locator("..")
    .getByRole("menuitemradio", { name: /GPT-6\.1[- ]Sol/ })
    .click();
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
  const astraModel = await openModelList(page);
  await page.getByRole("textbox", { name: "Search models", exact: true }).fill("gpt-6-astra");
  await astraModel
    .getByText("ChatGPT", { exact: true })
    .locator("..")
    .getByRole("menuitemradio", { name: /GPT-6[- ]Astra/ })
    .click();
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
  expect((await (await request.get(configUrl)).json()).automatic_compaction).toBe(true);
  expect((await request.patch(configUrl, { data: { model: "gpt-6-astra" } })).ok()).toBeTruthy();
  const switchedConfig = await (await request.get(configUrl)).json();
  const astra = catalog.providers
    .find((provider: { id: string }) => provider.id === "chatgpt-codex-responses")
    .models.find((entry: { id: string }) => entry.id === "gpt-6-astra");
  expect(switchedConfig.orchestrator_compaction_threshold).toBe(
    astra.limits.automatic_compaction_threshold,
  );
  expect(switchedConfig.automatic_compaction).toBe(true);
  expect((await request.patch(configUrl, { data: { model: "gpt-6.1-sol" } })).ok()).toBeTruthy();
  const setThreshold = await request.patch(configUrl, {
    data: { orchestrator_compaction_threshold: 123_456 },
  });
  expect(setThreshold.ok()).toBeTruthy();
  await expect
    .poll(
      async () => (await (await request.get(configUrl)).json()).orchestrator_compaction_threshold,
    )
    .toBe(123_456);
  expect((await (await request.get(configUrl)).json()).orchestrator_compaction_threshold).toBe(
    123_456,
  );

  const another = await request.post(`${harness.baseUrl}/sessions`, {
    data: {
      behavior: "direct",
      cwd: path.join(harness.runRoot, "workspace"),
      backend: "chatgpt-codex-responses",
      model: "gpt-6.1-sol",
      reasoning_effort: "medium",
    },
  });
  expect(another.ok()).toBeTruthy();
  const anotherConfig = `${harness.baseUrl}/sessions/${(await another.json()).metadata.session_id}/config`;
  const openai = catalog.providers.find(
    (provider: { id: string }) => provider.id === "openai-responses",
  );
  const target = openai.models.find((entry: { id: string }) => entry.id === "gpt-6.1-sol");
  const providerSwitch = await request.patch(anotherConfig, {
    data: {
      backend: "openai-responses",
      model: "gpt-6.1-sol",
      base_url: "https://api.openai.com/v1",
      api_key_env: "OPENAI_API_KEY",
    },
  });
  expect(providerSwitch.ok()).toBeTruthy();
  const switchedProviderConfig = await (await request.get(anotherConfig)).json();
  expect(switchedProviderConfig.automatic_compaction).toBe(false);
  expect(switchedProviderConfig.orchestrator_compaction_threshold).toBe(
    target.limits.automatic_compaction_threshold,
  );
  expect((await (await request.get(configUrl)).json()).automatic_compaction).toBe(false);
  expect((await request.patch(configUrl, { data: { model: "gpt-6-astra" } })).ok()).toBeTruthy();
  expect((await (await request.get(configUrl)).json()).orchestrator_compaction_threshold).toBe(
    123_456,
  );
});
