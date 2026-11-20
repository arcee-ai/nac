import { test, expect, createProject, waitForRunIdle } from "./harness";

test.use({ serverEnvironment: { NAC_ORCHESTRATION: "1" } });

for (const mobile of [false, true]) {
  test(`direct-only creation with an obsolete environment value (${mobile ? "mobile" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    expect((await request.get(`${harness.baseUrl}/ui-config`)).status()).toBe(404);
    const projectId = await createProject(request, harness);
    for (const behavior of ["orchestrator", "direct-with-orchestrator"]) {
      const rejected = await request.post(`${harness.baseUrl}/sessions`, {
        data: {
          project_id: projectId,
          behavior,
          backend: "openai-responses",
          model: "gpt-5.6-sol",
          base_url: harness.provider.baseUrl,
          api_key_env: "NAC_E2E_API_KEY",
        },
      });
      expect(rejected.status()).toBe(400);
    }
    await page.goto(`${harness.baseUrl}/#/?project=${projectId}`);
    await expect(page.getByRole("button", { name: /^Behavior:/ })).toHaveCount(0);
    await expect(page.getByText("Optional light model", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Choose a model" }).click();
    const dialog = page.getByRole("dialog", { name: "Model for this session" });
    await expect(dialog).toBeVisible();
    await dialog.locator("button[aria-expanded]").first().click();
    await page.getByRole("textbox", { name: "Search models" }).fill("gpt-5.6-sol");
    const row = page
      .locator('[aria-label="Model results"] button[data-row]')
      .filter({ hasText: /gpt-5\.6/i });
    const openai = row
      .locator("..")
      .filter({ hasText: "OpenAI Responses" })
      .locator("button[data-row]")
      .first();
    await openai.click();
    await dialog.getByRole("button", { name: "Use this model" }).click();
    harness.provider.enqueue(
      "direct-only",
      { token: "DIRECT_ONLY_TOKEN" },
      { kind: "text", text: "direct session response", stream: "request" },
    );
    await page.getByRole("textbox", { name: "What should we work on?" }).fill("DIRECT_ONLY_TOKEN");
    const created = page.waitForResponse(
      (response) =>
        response.url() === `${harness.baseUrl}/sessions` && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Start session", exact: true }).click();
    const response = await created;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({
      behavior: "direct",
      project_id: projectId,
      model: "gpt-5.6-sol",
    });
    const sessionId = (await response.json()).metadata.session_id as string;
    await expect(page.getByText("direct session response")).toBeVisible();
    await waitForRunIdle(request, harness, sessionId);
    expect(
      (await request.get(`${harness.baseUrl}/sessions/${sessionId}/orchestrators`)).status(),
    ).toBe(404);
  });
}
