import type { Page } from "@playwright/test";

import { test, expect, createProject, createSession, waitForRunIdle } from "./harness";
import { openSessionPanel } from "./nav-focus-helpers";

/**
 * Behavior is presented only as the navigation label's suffix ("<title>,
 * Orchestrator"); direct-only presentation names rows by title alone.
 */
const BEHAVIOR_MARKERS = [", Agent", ", Agent + Orchestrator", ", Orchestrator"]
  .map((suffix) => `button[aria-label$="${suffix}"]`)
  .join(", ");

const NEW_SESSION_CHORD = () =>
  /Mac|iPhone|iPad/.test(navigator.userAgent) ? "Meta+Shift+O" : "Control+Shift+O";

/** Home's composer: the one new-session flow, preset to a project. */
async function expectHomeComposer(page: Page, projectId: string) {
  await expect(page).toHaveURL(new RegExp(`#/\\?project=${projectId}$`));
  await expect(
    page.getByRole("textbox", { name: "What should we work on?", exact: true }),
  ).toBeFocused();
}

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
        await page.keyboard.press(await page.evaluate(NEW_SESSION_CHORD));
        // The chord opens Home's composer for this project; leaving it returns
        // to the unavailable view without creating anything.
        await expectHomeComposer(page, projectId);
        await page.goBack();
        await expect(page.getByText("This chat is unavailable in direct-only mode")).toBeVisible();
        await page.getByRole("button", { name: "New direct chat" }).click();
        await expectHomeComposer(page, projectId);
        // Direct-only creation offers no behavior or light-model choice.
        await expect(page.getByRole("button", { name: /^Behavior:/ })).toHaveCount(0);
        await expect(page.getByRole("radiogroup")).toHaveCount(0);
        await expect(page.getByText("Optional light model", { exact: true })).toHaveCount(0);
        harness.provider.enqueue(
          "policy-direct",
          { token: "POLICY_DIRECT_TOKEN" },
          // Home sends before the session page subscribes; follow the request's mode.
          { kind: "text", text: "direct policy response", stream: "request" },
        );
        await page
          .getByRole("textbox", { name: "What should we work on?", exact: true })
          .fill("POLICY_DIRECT_TOKEN");
        const created = page.waitForResponse(
          (response) =>
            response.url() === `${harness.baseUrl}/sessions` &&
            response.request().method() === "POST",
        );
        const firstRun = page.waitForResponse(
          (response) =>
            /\/sessions\/[^/]+\/runs$/.test(new URL(response.url()).pathname) &&
            response.request().method() === "POST",
        );
        // Start session creates the session and sends the prompt as its first run.
        await page.getByRole("button", { name: "Start session", exact: true }).click();
        const response = await created;
        const body = response.request().postDataJSON();
        expect(body).toMatchObject({ behavior: "direct", project_id: projectId });
        // Only hidden legacy sessions exist: ordinary creation, never a first-chat merge.
        expect(body.first_chat ?? false).toBe(false);
        const directId = (await response.json()).metadata.session_id;
        await expect(page).toHaveURL(new RegExp(`/session/${directId}/insights`));
        const delivered = await firstRun;
        expect(delivered.request().postDataJSON()).toMatchObject({ prompt: "POLICY_DIRECT_TOKEN" });
        // Startup projection may hold the local operation briefly. A confirmed
        // rejection returns the prompt to the composer and permits a fresh
        // click; an unknown reply never permits retry.
        let admission: "ready" | "busy" | "accepted" | "unconfirmed" = delivered.ok()
          ? "accepted"
          : "busy";
        if (!delivered.ok()) {
          expect(delivered.status()).toBe(409);
          expect(await delivered.json()).toEqual({
            error: "session is busy with a local operation",
          });
        }
        const composer = page.getByRole("combobox", { name: "Message" });
        const send = page
          .locator("form")
          .filter({ has: composer })
          .getByRole("button", { name: "Send", exact: true });
        await expect
          .poll(
            async () => {
              if (admission === "accepted" || admission === "unconfirmed") return admission;
              await expect(composer).toHaveValue("POLICY_DIRECT_TOKEN");
              admission = "unconfirmed";
              const reply = page.waitForResponse(
                (response) =>
                  response.url() === `${harness.baseUrl}/sessions/${directId}/runs` &&
                  response.request().method() === "POST",
              );
              await send.click();
              const response = await reply;
              expect(response.request().postDataJSON()).toMatchObject({
                prompt: "POLICY_DIRECT_TOKEN",
              });
              if (response.ok()) {
                admission = "accepted";
              } else {
                expect(response.status()).toBe(409);
                expect(await response.json()).toEqual({
                  error: "session is busy with a local operation",
                });
                admission = "busy";
              }
              return admission;
            },
            { timeout: 15_000, intervals: [50, 100, 250] },
          )
          .toBe("accepted");
        await waitForRunIdle(request, harness, directId);
        await expect(page.getByText("direct policy response")).toBeVisible();
        await expect(page.locator(BEHAVIOR_MARKERS)).toHaveCount(0);
        await page.goto(`${harness.baseUrl}/#/session/${directId}/worksets`);
        await expect(page).toHaveURL(new RegExp(`/session/${directId}/insights`));
        if (mobile) {
          // The phone panel sheet lists only the panels direct policy allows.
          await page.getByRole("button", { name: "Open panel", exact: true }).click();
          const sheet = page.getByRole("dialog", { name: "Session", exact: true });
          await expect(sheet.getByRole("button").filter({ hasText: /^Insights/ })).toHaveCount(1);
          await expect(sheet.getByRole("button").filter({ hasText: /^Threads/ })).toHaveCount(0);
          await expect(sheet.getByRole("button").filter({ hasText: /^Worksets/ })).toHaveCount(0);
          await page.keyboard.press("Escape");
          await expect(sheet).toBeHidden();
        }
        const insights = await openSessionPanel(page, "Insights");
        if (!mobile) {
          await expect(
            insights.getByRole("tab", { name: "Insights", exact: true }),
          ).toHaveAttribute("aria-selected", "true");
        }
        await expect(insights.getByRole("tab", { name: "Threads", exact: true })).toHaveCount(0);
        await expect(insights.getByRole("tab", { name: "Worksets", exact: true })).toHaveCount(0);
        if (mobile) await page.keyboard.press("Escape");
        else await insights.getByRole("button", { name: "Hide panel", exact: true }).click();
        await expect(insights).toBeHidden();
        await expect(page.getByRole("button", { name: "Spawn", exact: true })).toHaveCount(0);
        await expect(page.locator(BEHAVIOR_MARKERS)).toHaveCount(0);
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
        await expect(page).toHaveURL(new RegExp(`/session/${childId}/insights`));
        await expect(page.getByRole("button", { name: "Parent chat" })).toBeVisible();
        await expect(page.getByText("Traditional coding agent", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("combobox", { name: "Message" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Create fork", exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "Parent chat" }).click();
        await expect(page).toHaveURL(new RegExp(`/session/${directId}/delegated`));
        const subagents = await openSessionPanel(page, "Subagents");
        if (!mobile) {
          await expect(
            subagents.getByRole("tab", { name: "Subagents", exact: true }),
          ).toHaveAttribute("aria-selected", "true");
        }
        await expect(
          subagents.getByRole("button", { name: "Direct child policy", exact: true }),
        ).toBeVisible();
        await expect(page.locator(BEHAVIOR_MARKERS)).toHaveCount(0);
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
      // An empty project opens Home's composer, preset to it and focused.
      await expectHomeComposer(page, projectId);
      harness.provider.enqueue(
        "policy-first",
        { token: "POLICY_FIRST_TOKEN" },
        { kind: "text", text: "first chat response", stream: "request" },
      );
      await page.keyboard.type("POLICY_FIRST_TOKEN");
      const created = page.waitForResponse(
        (response) =>
          response.url() === `${harness.baseUrl}/sessions` &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Start session", exact: true }).focus();
      await page.keyboard.press("Enter");
      const response = await created;
      // The project's first primary session converges under concurrent submits.
      expect(response.request().postDataJSON()).toMatchObject({
        behavior: "direct",
        first_chat: true,
        first_chat_same_behavior: true,
      });
      await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
      const firstId = (await response.json()).metadata.session_id;
      await waitForRunIdle(request, harness, firstId);
      await expect(page.getByText("first chat response")).toBeVisible();
      await page.getByRole("combobox", { name: "Message" }).focus();
      await page.keyboard.press(await page.evaluate(NEW_SESSION_CHORD));
      await expectHomeComposer(page, projectId);
      await expect(page.getByRole("button", { name: /^Behavior:/ })).toHaveCount(0);
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
    // Keeps the zero counts above honest: opting in shows the same icons.
    await expect(page.locator(BEHAVIOR_MARKERS).first()).toBeVisible();
    await page.keyboard.press(await page.evaluate(NEW_SESSION_CHORD));
    // Home's composer offers every behavior again.
    await expectHomeComposer(page, projectId);
    await page.getByRole("button", { name: /^Behavior: / }).click();
    await expect(page.getByRole("menuitemradio")).toHaveCount(3);
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
      { kind: "text", text: `restart direct response ${gate}`, stream: "request" },
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
