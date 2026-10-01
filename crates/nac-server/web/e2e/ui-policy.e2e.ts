import { test, expect, createProject, createSession, waitForRunIdle } from "./harness";

for (const orchestration of [null, "0"] as const) {
  test.describe(`direct presentation (${orchestration ?? "unset"})`, () => {
    test.use({ orchestration });
    for (const mobile of [false, true]) {
      test(`preserves identities and creates direct from hidden history ${mobile ? "mobile" : "desktop"}`, async ({
        harness,
        page,
        request,
      }) => {
        if (mobile) await page.setViewportSize({ width: 390, height: 844 });
        const config = await request.get(`${harness.baseUrl}/ui-config`);
        expect(await config.json()).toEqual({ orchestration_enabled: false, diagnostic: null });
        const projectId = await createProject(request, harness);
        const legacy = await createSession(request, harness, "orchestrator", projectId);
        const hybrid = await createSession(request, harness, "direct-with-orchestrator", projectId);
        await page.goto(`${harness.baseUrl}/#/session/${legacy}/threads`);
        await expect(page.getByText("This chat is unavailable in direct-only mode")).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Message" })).toHaveCount(0);
        const modifier = process.platform === "darwin" ? "Meta" : "Control";
        await page.keyboard.press(`${modifier}+Shift+O`);
        const shortcutDialog = page.getByRole("dialog", { name: "New Chat" });
        await expect(shortcutDialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(shortcutDialog).not.toBeVisible();
        await expect(page.getByText("This chat is unavailable in direct-only mode")).toBeVisible();
        await page.getByRole("button", { name: "New direct chat" }).click();
        await expect(page.getByRole("dialog", { name: "New Chat" })).toBeVisible();
        await expect(page.getByRole("radiogroup")).toHaveCount(0);
        await expect(page.getByText("Optional light model", { exact: true })).toHaveCount(0);
        const created = page.waitForResponse(
          (response) =>
            response.url() === `${harness.baseUrl}/sessions` &&
            response.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Create chat", exact: true }).click();
        const response = await created;
        expect(response.request().postDataJSON()).toMatchObject({
          behavior: "direct",
          project_id: projectId,
          first_chat: false,
        });
        const directId = (await response.json()).metadata.session_id;
        await expect(page).toHaveURL(new RegExp(`/session/${directId}/files`));
        harness.provider.enqueue(
          "policy-direct",
          { token: "POLICY_DIRECT_TOKEN" },
          { kind: "text", text: "direct policy response", stream: true },
        );
        const composer = page.getByRole("combobox", { name: "Message" });
        await composer.fill("POLICY_DIRECT_TOKEN");
        await page
          .locator("form")
          .filter({ has: composer })
          .getByRole("button", { name: "Send", exact: true })
          .click();
        await waitForRunIdle(request, harness, directId);
        await expect(page.getByText("direct policy response")).toBeVisible();
        await page.goto(`${harness.baseUrl}/#/session/${directId}/worksets`);
        await expect(page).toHaveURL(new RegExp(`/session/${directId}/files`));
        await expect(page.getByRole("tab", { name: "Threads", exact: true })).toHaveCount(0);
        await expect(page.getByRole("tab", { name: "Worksets", exact: true })).toHaveCount(0);
        if (!mobile) await page.getByRole("button", { name: "Spawn", exact: true }).click();
        if (!mobile)
          await expect(
            page.getByRole("button", { name: "Create Subagent", exact: true }),
          ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Create Orchestrator", exact: true }),
        ).toHaveCount(0);
        await page.reload();
        await expect(page.getByText("direct policy response")).toBeVisible();
        harness.provider.enqueue(
          "policy-child",
          { token: "POLICY_CHILD_TOKEN" },
          { kind: "text", text: "direct child response", stream: true },
        );
        const childResponse = await request.post(
          `${harness.baseUrl}/sessions/${directId}/children`,
          {
            data: {
              profile: "general",
              description: "Direct child policy",
              prompt: "POLICY_CHILD_TOKEN",
              background: false,
            },
          },
        );
        expect(childResponse.ok()).toBe(true);
        const childId = (await childResponse.json()).child_session_id;
        await page.goto(`${harness.baseUrl}/#/session/${childId}/threads`);
        await expect(page).toHaveURL(new RegExp(`/session/${childId}/files`));
        if (!mobile)
          await expect(page.getByText("Traditional coding agent", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Parent chat" })).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Message" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Create fork", exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "Parent chat" }).click();
        await expect(page).toHaveURL(new RegExp(`/session/${directId}/delegated`));
        for (const [id, behavior] of [
          [legacy, "orchestrator"],
          [hybrid, "direct-with-orchestrator"],
          [directId, "direct"],
        ]) {
          const stored = await request.get(`${harness.baseUrl}/sessions/${id}`);
          expect((await stored.json()).metadata).toMatchObject({ session_id: id, behavior });
        }
        await page.goto(`${harness.baseUrl}/#/design`);
        await expect(page).toHaveURL(`${harness.baseUrl}/#/`);
      });
    }
    test("empty project keyboard creation retains first-chat duplicate prevention", async ({
      harness,
      page,
      request,
    }) => {
      const projectId = await createProject(request, harness);
      await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
      await expect(page.getByRole("dialog", { name: "New Chat" })).toBeVisible();
      const created = page.waitForResponse(
        (response) =>
          response.url() === `${harness.baseUrl}/sessions` &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Create chat", exact: true }).click();
      const response = await created;
      expect(response.request().postDataJSON()).toMatchObject({
        behavior: "direct",
        first_chat: true,
        first_chat_same_behavior: true,
      });
      await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
      await page.keyboard.press(
        await page.evaluate(() =>
          /Mac|iPhone|iPad/.test(navigator.userAgent) ? "Meta+Shift+O" : "Control+Shift+O",
        ),
      );
      await expect(page.getByRole("dialog", { name: "New Chat" })).toBeVisible();
      await expect(page.getByRole("radiogroup")).toHaveCount(0);
    });
  });
}

test.describe("runtime opt-in with the same production binary", () => {
  test.use({ orchestration: "1" });
  test("restores orchestration panels and all creation choices", async ({
    harness,
    page,
    request,
  }) => {
    const projectId = await createProject(request, harness);
    const legacy = await createSession(request, harness, "orchestrator", projectId);
    await page.goto(`${harness.baseUrl}/#/session/${legacy}/threads`);
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    await page.keyboard.press(
      await page.evaluate(() =>
        /Mac|iPhone|iPad/.test(navigator.userAgent) ? "Meta+Shift+O" : "Control+Shift+O",
      ),
    );
    await expect(page.getByRole("dialog", { name: "New Chat" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(3);
    expect(
      (await (await request.get(`${harness.baseUrl}/ui-config`)).json()).orchestration_enabled,
    ).toBe(true);
  });
});
test.describe("invalid numeric operator setting", () => {
  test.use({ orchestration: "true" });
  test("fails closed with an actionable restart diagnostic", async ({ harness, page, request }) => {
    const config = await (await request.get(`${harness.baseUrl}/ui-config`)).json();
    expect(config.orchestration_enabled).toBe(false);
    expect(config.diagnostic).toContain("must be exactly 1");
    await page.goto(harness.baseUrl);
    await expect(page.getByRole("alert")).toContainText("restart nac-web");
  });
});

test("switches on-off-on after restart with the same binary and seeded store", async ({
  harness,
  page,
  request,
}) => {
  const binary = harness.binaryPath;
  const lightModel = {
    model: "gpt-5.6-sol",
    backend: "openai-responses" as const,
    base_url: harness.provider.baseUrl,
    api_key_env: "NAC_E2E_API_KEY",
    reasoning_effort: "low" as const,
  };
  const project = await createProject(request, harness, { lightModel });
  const ids = await Promise.all([
    createSession(request, harness, "orchestrator", project),
    createSession(request, harness, "direct-with-orchestrator", project),
    createSession(request, harness, "direct", project),
  ]);
  const before = await Promise.all(
    ids.map(async (id) => (await request.get(`${harness.baseUrl}/sessions/${id}/config`)).json()),
  );
  for (const gate of ["1", "0", "1"]) {
    await harness.restart(gate);
    expect(harness.binaryPath).toBe(binary);
    const configs = await Promise.all(
      ids.map(async (id) => (await request.get(`${harness.baseUrl}/sessions/${id}/config`)).json()),
    );
    expect(configs).toEqual(before);
    for (const [index, id] of ids.entries()) {
      await page.goto(`${harness.baseUrl}/#/session/${id}/threads`);
      if (gate === "0" && index < 2)
        await expect(page.getByText("This chat is unavailable in direct-only mode")).toBeVisible();
      else await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
      const snapshot = await (await request.get(`${harness.baseUrl}/sessions/${id}`)).json();
      expect(snapshot.metadata.session_id).toBe(id);
      expect(snapshot.metadata.behavior).toBe(
        ["orchestrator", "direct-with-orchestrator", "direct"][index],
      );
    }
    // The existing direct route/provider remains usable across each restart.
    harness.provider.enqueue(
      `restart-${gate}`,
      { token: "RESTART_DIRECT_TOKEN" },
      { kind: "text", text: `restart direct response ${gate}`, stream: true },
    );
    const submitted = await request.post(`${harness.baseUrl}/sessions/${ids[2]}/runs`, {
      data: { prompt: "RESTART_DIRECT_TOKEN" },
    });
    expect(submitted.status()).toBe(202);
    await waitForRunIdle(request, harness, ids[2]);
    await page.reload();
    await expect(page.getByText(`restart direct response ${gate}`).last()).toBeVisible();
  }
});
