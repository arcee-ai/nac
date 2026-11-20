import { createProject, expect, test } from "./harness";
import { homeComposer, startSessionFromHome } from "./focus-embedded-helpers";

for (const mobile of [false, true]) {
  test(`project Home visibly copies a session model into a new explicit request (${mobile ? "phone" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    const projectId = await createProject(request, harness, {
      name: "Selection source",
    });
    const original = await request.post(`${harness.baseUrl}/sessions`, {
      data: {
        project_id: projectId,
        behavior: "direct",
        backend: "openai-responses",
        model: "gpt-6.1-sol",
        base_url: "https://api.openai.com/v1",
        allow_insecure_http: false,
        api_key_env: "NAC_E2E_API_KEY",
        reasoning_effort: "high",
        service_tier: "fast",
        extra_headers: { "x-source": "header-secret-canary" },
      },
    });
    expect(original.ok(), await original.text()).toBeTruthy();
    const sourceId = (await original.json()).metadata.session_id;
    const source = await request.get(
      `${harness.baseUrl}/projects/${projectId}/session-model-sources/${sourceId}`,
    );
    expect(source.ok()).toBeTruthy();
    expect(await source.text()).not.toContain("header-secret-canary");
    await page.route("**/sessions/*/runs", (route) => route.abort());
    await page.goto(`${harness.baseUrl}/#/session/${sourceId}`);
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeVisible();
    const modifier = await page.evaluate(() =>
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "Meta" : "Control",
    );
    await page.keyboard.press(`${modifier}+Shift+O`);
    await expect(homeComposer(page)).toBeFocused();
    const chip = page.getByRole("button", { name: /^Model: / });
    await expect(chip).toHaveAccessibleName(/gpt-6\.1.*Fast speed/i);
    await expect(homeComposer(page)).toBeVisible();
    const create = page.waitForRequest(
      (candidate) => candidate.method() === "POST" && candidate.url().endsWith("/sessions"),
    );
    const id = await startSessionFromHome(page, "Copied explicitly", {
      runAdmission: "aborted",
    });
    expect(id).not.toBe(sourceId);
    expect((await create).postDataJSON()).toMatchObject({
      project_id: projectId,
      backend: "openai-responses",
      model: "gpt-6.1-sol",
      base_url: "https://api.openai.com/v1",
      allow_insecure_http: false,
      api_key_env: "NAC_E2E_API_KEY",
      reasoning_effort: "high",
      service_tier: "fast",
      extra_headers: null,
      model_source: { project_id: projectId, session_id: sourceId },
    });
    const config = await request.get(`${harness.baseUrl}/sessions/${id}/config`);
    expect(config.ok()).toBeTruthy();
    expect(await config.json()).toMatchObject({
      model: "gpt-6.1-sol",
      api_key_env: "NAC_E2E_API_KEY",
      service_tier: "fast",
      extra_headers_json: '{"x-source":"header-secret-canary"}',
    });
  });
}

for (const mobile of [false, true]) {
  test(`empty project displays and submits a ready suggested session model (${mobile ? "phone" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    const projectId = await createProject(request, harness, {
      name: "Empty selection",
    });
    await page.route("**/sessions/*/runs", (route) => route.abort());
    await page.goto(`${harness.baseUrl}/#/?project=${projectId}`);
    await expect(page.getByRole("button", { name: /^Model: / })).toBeVisible();
    const create = page.waitForRequest(
      (candidate) => candidate.method() === "POST" && candidate.url().endsWith("/sessions"),
    );
    const id = await startSessionFromHome(page, "Start with the shown choice", {
      runAdmission: "aborted",
    });
    const body = (await create).postDataJSON();
    expect(body).toMatchObject({
      project_id: projectId,
      backend: expect.any(String),
      model: expect.any(String),
      base_url: expect.any(String),
    });
    const config = await request.get(`${harness.baseUrl}/sessions/${id}/config`);
    expect(config.ok()).toBeTruthy();
    expect(await config.json()).toMatchObject({
      backend: body.backend,
      model: body.model,
      base_url: body.base_url,
    });
  });
}

test("a source that moves after Home loads cannot start a session", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness, {
    name: "Moving source",
  });
  const original = await request.post(`${harness.baseUrl}/sessions`, {
    data: {
      project_id: projectId,
      behavior: "direct",
      backend: "openai-responses",
      model: "gpt-6.1-sol",
      base_url: "https://api.openai.com/v1",
      api_key_env: "NAC_E2E_API_KEY",
      reasoning_effort: "high",
    },
  });
  expect(original.ok(), await original.text()).toBeTruthy();
  await page.goto(`${harness.baseUrl}/#/?project=${projectId}`);
  await expect(page.getByRole("button", { name: /gpt-6\.1/i })).toBeVisible();
  let creates = 0;
  page.on("request", (candidate) => {
    if (candidate.method() === "POST" && candidate.url().endsWith("/sessions")) creates++;
  });
  await page.route("**/session-model-sources/*", (route) =>
    route.fulfill({ status: 404, json: { error: "source moved" } }),
  );
  await homeComposer(page).fill("Keep my draft");
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "source session changed or moved" }),
  ).toBeVisible();
  await expect(homeComposer(page)).toHaveValue("Keep my draft");
  expect(creates).toBe(0);
});
