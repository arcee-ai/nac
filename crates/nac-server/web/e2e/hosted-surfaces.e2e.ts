import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";

import {
  createProject,
  createSession,
  expect,
  showPhonePanel,
  showSidePanel,
  test,
  waitForRunIdle,
} from "./harness";
import { startHostedFixture } from "./hosted-fixture";
import { STDIO_MCP_SERVER, openCustomMcpServer } from "./mcp-library-fixture";
import { openModelList } from "./focus-embedded-helpers";
import { openSessionMenu, openSessionRename, openSettingsSection } from "./settings-focus";

const execute = promisify(execFile);
test.skip(
  !!process.env.NAC_E2E_REMOTE,
  "Requires disposable local workspaces and scripted providers",
);
test.use({ orchestration: "0" });

/**
 * Opens the Files tab of the session panel, or the phone's Files sheet.
 */
async function showFiles(page: Page, mobile: boolean) {
  if (mobile) {
    await showPhonePanel(page, "Files");
    return;
  }
  await showSidePanel(page);
  const panels = page.getByRole("tablist", { name: "Session panels", exact: true });
  const files = panels.getByRole("tab", { name: "Files", exact: true });
  await files.click();
  await expect(files).toHaveAttribute("aria-selected", "true");
}

/** A phone's panel shows one screen at a time: an open file goes back to the list. */
async function openFileList(page: Page, mobile: boolean) {
  const back = page.getByRole("button", { name: "Open list", exact: true });
  if (mobile && (await back.isVisible())) await back.click();
}

async function chooseFile(page: Page, name: string, mobile: boolean) {
  await openFileList(page, mobile);
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const file = page.getByRole("button", {
    name: new RegExp(
      `^${escapedName}(?:\\s*, (?:Modified|Added|Deleted|Renamed|Copied|Type changed|Conflict|Untracked|Ignored))?$`,
    ),
  });
  const allFiles = page.getByRole("button", { name: "All files", exact: true });
  if ((await allFiles.getAttribute("aria-pressed")) !== "true") await allFiles.click();
  await file.click();
  if (mobile)
    await expect(page.getByRole("button", { name: "Open list", exact: true })).toBeVisible();
}

/**
 * The session's snapshot selection lives in the Session menu's details (a
 * phone's panel sheet holds the same details). The Files panel then reopens on
 * the selected snapshot.
 */
/** Clears the open panel off the session header so its menu can open. */
async function hidePanel(page: Page, mobile: boolean) {
  // A phone's Files sheet by its Close, the desktop drawer by "Hide panel" (an
  // embedded view owns only focused keys, so no Escape from an unfocused page).
  if (mobile) {
    const files = page.getByRole("dialog", { name: "Files", exact: true });
    if (await files.isVisible()) {
      // An open file's header leads back to the list, whose header closes the sheet.
      await openFileList(page, mobile);
      await files.getByRole("button", { name: "Close", exact: true }).first().click();
      await expect(files).toHaveCount(0);
    }
  } else {
    const hide = page.getByRole("button", { name: "Hide panel", exact: true });
    if (await hide.isVisible()) await hide.click();
    await expect(page.getByRole("tablist", { name: "Session panels", exact: true })).toHaveCount(0);
  }
}

/** Desktop: the ⋯ trigger toggles its popover. A phone's sheet stays: its panel rows lead on. */
async function closeSessionMenu(page: Page, menu: Locator, mobile: boolean) {
  if (mobile || !(await menu.isVisible())) return;
  await page.getByRole("button", { name: "Session menu", exact: true }).click();
  await expect(menu).toHaveCount(0);
}

/**
 * The session's snapshot selection lives in the Session menu's details (a
 * phone's panel sheet holds the same details). The Files panel then reopens on
 * the selected snapshot.
 */
async function selectRevision(page: Page, name: RegExp, mobile: boolean) {
  await hidePanel(page, mobile);
  const menu = await openSessionMenu(page);
  await menu.getByRole("button", { name: /^Snapshot:/ }).click();
  await page.getByRole("button", { name }).click();
  await closeSessionMenu(page, menu, mobile);
  await showFiles(page, mobile);
}

/**
 * Runs a branch-picker step: a phone's picker sits atop its file list, the
 * desktop's in the Session menu's details. The Files panel is shown afterwards.
 */
async function withBranchPicker(page: Page, mobile: boolean, step: () => Promise<void>) {
  if (mobile) {
    await openFileList(page, mobile);
    await step();
    return;
  }
  await hidePanel(page, mobile);
  const menu = await openSessionMenu(page);
  await step();
  await closeSessionMenu(page, menu, mobile);
  await showFiles(page, mobile);
}

for (const mobile of [false, true]) {
  test(`injected files, captured history and Git settlement ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = path.join(harness.runRoot, "injected-files-git");
    await fs.mkdir(workspace);
    const git = (...args: string[]) => execute("git", ["-C", workspace, ...args]);
    await git("init", "-b", "main");
    await git("config", "user.name", "Disposable NAC fixture");
    await git("config", "user.email", "nac-fixture@example.test");
    await fs.writeFile(path.join(workspace, "note.txt"), "CAPTURED_ALPHA\n");
    await fs.writeFile(path.join(workspace, "stable.txt"), "UNCHANGED_CONTENT\n");
    await git("add", ".");
    await git("commit", "-m", "fixture baseline");
    await git("branch", "other");
    const project = await createProject(request, harness, {
      name: "Injected files/Git",
      cwd: workspace,
    });
    const id = await createSession(request, harness, "direct", project);
    for (const token of ["CAPTURE_ALPHA", "CAPTURE_BETA"]) {
      if (token === "CAPTURE_BETA")
        await fs.writeFile(path.join(workspace, "note.txt"), "CAPTURED_BETA\n");
      harness.provider.enqueue(
        token,
        { token },
        { kind: "text", text: token + " done", stream: true },
      );
      const submitted = await request.post(`${harness.baseUrl}/sessions/${id}/runs`, {
        data: { prompt: token },
      });
      expect(submitted.ok()).toBe(true);
      await waitForRunIdle(request, harness, id);
    }
    const revisions = await (
      await request.get(`${harness.baseUrl}/sessions/${id}/workspace/revisions`)
    ).json();
    const olderIndex = revisions.findIndex((entry: { label: string }) =>
      entry.label.includes("CAPTURE_ALPHA"),
    );
    expect(olderIndex).toBeGreaterThanOrEqual(0);
    const ordinal = revisions.length - olderIndex;
    const fixture = await startHostedFixture(harness, id);
    try {
      await page.goto(fixture.baseUrl);
      const callerLocation = page.url();
      await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
      await showFiles(page, mobile);
      await chooseFile(page, "stable.txt", mobile);
      await expect(page.getByText("UNCHANGED_CONTENT", { exact: true })).toBeVisible();
      await chooseFile(page, "note.txt", mobile);
      await expect(page.getByText("CAPTURED_BETA", { exact: true })).toBeVisible();
      await selectRevision(page, new RegExp(`^Snapshot ${ordinal} ·`), mobile);
      await chooseFile(page, "note.txt", mobile);
      await expect(page.getByText("CAPTURED_ALPHA", { exact: true })).toBeVisible();
      await expect(page.getByText("CAPTURED_BETA", { exact: true })).toHaveCount(0);
      await openFileList(page, mobile);
      await expect(page.getByRole("button", { name: "Commit", exact: true })).toBeDisabled();
      await selectRevision(page, /^Working tree/, mobile);
      await chooseFile(page, "note.txt", mobile);
      await expect(page.getByText("CAPTURED_BETA", { exact: true })).toBeVisible();
      // A phone's branch sits atop the file list; a desktop's in the Session menu.
      await withBranchPicker(page, mobile, async () => {
        await page.getByRole("button", { name: "Branch: main", exact: true }).click();
        await expect(page.getByRole("button", { name: "other", exact: true })).toBeDisabled();
        await page.getByPlaceholder("Find or create a branch").fill("injected-feature");
        await page.getByRole("button", { name: "Create injected-feature", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Branch: injected-feature", exact: true }),
        ).toBeVisible();
      });
      await openFileList(page, mobile);
      await page.getByRole("button", { name: "Commit", exact: true }).click();
      await page.getByPlaceholder("Commit message").fill("injected accepted commit");
      await page.getByPlaceholder("Commit message").press("Control+Enter");
      await expect(page.getByPlaceholder("Commit message")).toHaveCount(0);
      await expect
        .poll(async () => (await git("log", "-1", "--format=%s")).stdout.trim())
        .toBe("injected accepted commit");
      await withBranchPicker(page, mobile, async () => {
        await page.getByRole("button", { name: "Branch: injected-feature", exact: true }).click();
        await page.getByRole("button", { name: "other", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Branch: other", exact: true }),
        ).toBeVisible();
      });
      // The native commit succeeds but its response is lost. No automatic retry may create another intent.
      await fs.writeFile(path.join(workspace, "note.txt"), "ACCEPTED_WITH_LOST_RESPONSE\n");
      harness.provider.enqueue(
        "REFRESH_DIRTY",
        { token: "REFRESH_DIRTY" },
        { kind: "text", text: "dirty refresh done", stream: true },
      );
      expect(
        (
          await request.post(`${harness.baseUrl}/sessions/${id}/runs`, {
            data: { prompt: "REFRESH_DIRTY" },
          })
        ).ok(),
      ).toBe(true);
      await waitForRunIdle(request, harness, id);
      await openFileList(page, mobile);
      await expect(page.getByRole("button", { name: "Commit", exact: true })).toBeEnabled();
      fixture.loseNextResponse("POST", `/sessions/${id}/workspace/commit`);
      await page.getByRole("button", { name: "Commit", exact: true }).click();
      await page.getByPlaceholder("Commit message").fill("accepted response lost");
      await page.getByPlaceholder("Commit message").press("Control+Enter");
      await expect(page.getByText("Failed to fetch", { exact: false })).toBeVisible();
      expect(fixture.lostResponses).toHaveLength(1);
      expect((await git("log", "-1", "--format=%s")).stdout.trim()).toBe("accepted response lost");
      expect(fixture.lostResponses[0].status).toBe(200);
      // A phone's panel covers the host's own controls until Escape closes it.
      // The commit sheet above it takes the first Escape on its own.
      if (mobile) {
        await page.keyboard.press("Escape");
        await expect(page.getByPlaceholder("Commit message")).toHaveCount(0);
        await expect(page.getByRole("dialog", { name: "Files", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "Files", exact: true })).toHaveCount(0);
      }
      await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
      await showFiles(page, mobile);
      await chooseFile(page, "note.txt", mobile);
      await expect(page.getByText("ACCEPTED_WITH_LOST_RESPONSE", { exact: true })).toBeVisible();
      await openFileList(page, mobile);
      await expect(page.getByRole("button", { name: "Commit", exact: true })).toBeDisabled();
      expect(fixture.lostResponses).toHaveLength(1);
      expect(
        fixture.calls.filter(
          (call) => call.method === "POST" && call.path.endsWith("/workspace/commit"),
        ),
      ).toHaveLength(2);
      expect(
        fixture.calls.some((call) =>
          call.path.includes(`/revisions/${revisions[olderIndex].id}/changes`),
        ),
      ).toBe(true);
      expect(
        fixture.calls.some((call) => call.path.includes(`revision=${revisions[olderIndex].id}`)),
      ).toBe(true);
      expect(page.url()).toBe(callerLocation);
      harness.provider.assertConsumed();
    } finally {
      await fixture.stop();
    }
  });

  test(`injected rename acknowledgement loss and replacement ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness, { name: "Injected settings" });
    const id = await createSession(request, harness, "direct", project);
    const presentationPath = `/sessions/${id}/presentation`;
    const projectsBefore = await (await request.get(`${harness.baseUrl}/projects`)).json();
    const fixture = await startHostedFixture(harness, id);
    const summary = async (): Promise<{ title: string; presentation_version: number }> =>
      (await (await request.get(`${harness.baseUrl}/sessions`)).json()).find(
        (entry: { summary: { session_id: string } }) => entry.summary.session_id === id,
      ).summary;
    const notices = page.getByRole("region", { name: "Notifications", exact: true });
    try {
      await page.goto(fixture.baseUrl);
      const dialog = await openSessionRename(page);
      const title = dialog.getByRole("textbox", { name: "Title", exact: true });
      const save = dialog.getByRole("button", { name: "Save", exact: true });
      await title.fill("Accepted injected title");
      await save.click();
      await expect(dialog).toHaveCount(0);
      expect((await summary()).title).toBe("Accepted injected title");

      await openSessionRename(page);
      await title.fill("Accepted with response lost");
      fixture.loseNextResponse("PUT", presentationPath);
      await save.click();
      await expect(notices.getByRole("alert")).toContainText("Failed to fetch");
      expect(fixture.lostResponses).toHaveLength(1);
      expect(fixture.lostResponses[0].status).toBe(200);
      const accepted = await summary();
      expect(accepted.title).toBe("Accepted with response lost");

      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
      await openSessionRename(page);
      await expect(title).toHaveValue(accepted.title);
      const external = await request.put(`${harness.baseUrl}${presentationPath}`, {
        data: {
          title: "Updated outside the presentation",
          pinned: false,
          expected_version: accepted.presentation_version,
        },
      });
      expect(external.ok()).toBe(true);
      await title.fill("Stale edit must not rename");
      await save.click();
      await expect(
        notices.getByRole("alert").filter({ hasText: "Version conflict" }),
      ).toBeVisible();
      expect((await summary()).title).toBe("Updated outside the presentation");
      expect(await (await request.get(`${harness.baseUrl}/projects`)).json()).toEqual(
        projectsBefore,
      );
      expect(
        fixture.calls.filter((call) => call.method === "PUT" && call.path === presentationPath),
      ).toHaveLength(3);
    } finally {
      await fixture.stop();
    }
  });

  test(`injected outgoing MCP CRUD, test and runtime status ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    // This local outgoing stdio double has one inert tool; no inbound OAuth or remote service.
    const script = path.join(harness.runRoot, "outgoing-mcp.cjs");
    await fs.writeFile(script, STDIO_MCP_SERVER);
    const project = await createProject(request, harness, { name: "Injected outgoing MCP" });
    const id = await createSession(request, harness, "direct", project);
    const fixture = await startHostedFixture(harness, id);
    try {
      await page.goto(fixture.baseUrl);
      const form = await openCustomMcpServer(page, mobile);
      await form.getByPlaceholder("my_server").fill("injected_fixture");
      await form.getByRole("button", { name: "Stdio", exact: true }).click();
      await form.getByRole("button", { name: "Legacy", exact: true }).click();
      await form.getByPlaceholder("npx").fill(process.execPath);
      // A long comma list is still one argument; the fixture script ignores it.
      const allowlist = Array.from({ length: 12 }, (_, at) => `linear_tool_${at}`).join(",");
      for (const value of [script, allowlist]) {
        await form.getByRole("button", { name: "Add argument", exact: true }).click();
        await page.keyboard.insertText(value);
      }
      await expect(form.getByRole("textbox", { name: "Argument 2" })).toHaveValue(allowlist);
      await expect(form.getByRole("button", { name: "Remove argument 2" })).toBeInViewport();
      expect(
        await page.locator("html").evaluate((root) => root.scrollWidth <= root.clientWidth),
      ).toBe(true);
      await form.getByRole("button", { name: "Test connection", exact: true }).click();
      await expect(form.getByText("1 tool found", { exact: true })).toBeVisible();
      await expect(form.getByText("fixture_echo", { exact: true })).toBeVisible();
      await form.getByRole("button", { name: "Save", exact: true }).click();
      if (mobile) await page.getByRole("button", { name: "injected_fixture", exact: true }).click();
      // The page manager keeps the saved server selected; a phone reopens it as a sheet.
      const editing = mobile
        ? page.getByRole("dialog", { name: "injected_fixture", exact: true })
        : form;
      await expect(editing.getByRole("textbox", { name: "Argument 1" })).toHaveValue(script);
      await expect(editing.getByRole("textbox", { name: "Argument 2" })).toHaveValue(allowlist);
      for (const action of ["Connect", "Reload", "Disconnect"] as const) {
        const actionPath = `/mcp_library/servers/injected_fixture/${action.toLowerCase()}`;
        const button = editing.getByRole("button", { name: action, exact: true });
        // Reload retains "connected" while pending. Wait for this operation,
        // rather than reading the old status and clicking a newly disabled button.
        const [response] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response.request().method() === "POST" && response.url().endsWith(actionPath),
          ),
          button.click(),
        ]);
        expect(response.ok()).toBe(true);
        await expect(button).toBeEnabled();
        const status =
          action === "Disconnect"
            ? "Disconnected. Sessions won't use this server until you connect it."
            : "Runtime: connected";
        await expect(editing.getByText(status, { exact: true })).toBeVisible();
        expect(
          fixture.calls.filter((call) => call.method === "POST" && call.path === actionPath),
        ).toHaveLength(1);
      }
      await editing.getByPlaceholder("my_server").fill("renamed_fixture");
      await editing.getByRole("button", { name: "Save", exact: true }).click();
      if (mobile) await page.getByRole("button", { name: "renamed_fixture", exact: true }).click();
      await expect(page.getByPlaceholder("my_server")).toHaveValue("renamed_fixture");
      if (mobile) await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
      // The replacement presentation starts on its own session route.
      await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
      await openSettingsSection(page, "MCP servers");
      if (mobile) {
        await page.getByRole("button", { name: "renamed_fixture", exact: true }).click();
        // Field values are available before the phone panel finishes sliding in.
        const reopened = page.getByRole("dialog", { name: "renamed_fixture", exact: true });
        await expect(reopened).toHaveClass(/\btranslate-x-0\b/);
        await expect
          .poll(() =>
            reopened.evaluate((surface) =>
              surface
                .getAnimations()
                .every((animation: { playState: string }) =>
                  ["finished", "idle"].includes(animation.playState),
                ),
            ),
          )
          .toBe(true);
      }
      await expect(page.getByPlaceholder("my_server")).toHaveValue("renamed_fixture");
      await page.getByRole("button", { name: "Delete server", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await (await request.get(`${harness.baseUrl}/mcp_library/servers`)).json()).servers,
        )
        .toEqual([]);
      expect(
        fixture.calls.filter(
          (call) =>
            call.method === "DELETE" && call.path === "/mcp_library/servers/renamed_fixture",
        ),
      ).toHaveLength(1);
      expect(
        fixture.calls.filter(
          (call) => call.method === "POST" && call.path === "/mcp_library/servers/test",
        ),
      ).toHaveLength(1);
      expect(
        fixture.calls.filter(
          (call) => call.method === "POST" && call.path === "/mcp_library/servers",
        ),
      ).toHaveLength(1);
      expect(fixture.calls.some((call) => call.path.includes("/oauth/"))).toBe(false);
    } finally {
      await fixture.stop();
    }
  });
  test(`injected composer uses a saved provider account without reading its key ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness, { name: "Injected saved configuration" });
    const id = await createSession(request, harness, "direct", project);
    const canary = "injected-preset-dummy-key-only";
    const created = await request.post(`${harness.baseUrl}/model-configs`, {
      data: {
        name: "Injected Fireworks account",
        backend: "fireworks-chat",
        model: "gpt-5.6-sol",
        base_url: harness.provider.baseUrl,
        api_key: canary,
      },
    });
    expect(created.ok()).toBe(true);
    const saved = await created.json();
    expect(saved.api_key_env).toMatch(/^NAC_CONFIG_/);
    expect(JSON.stringify(saved)).not.toContain(canary);
    const fixture = await startHostedFixture(harness, id);
    try {
      await page.goto(fixture.baseUrl);
      await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
      const list = await openModelList(page);
      await page.getByRole("textbox", { name: "Search models", exact: true }).fill("gpt-5.6-sol");
      const switched = page.waitForRequest(
        (req) => req.method() === "PATCH" && req.url().endsWith(`/sessions/${id}/config`),
      );
      await list
        .getByText("Fireworks", { exact: true })
        .locator("..")
        .getByRole("menuitemradio", { name: /^(?:GPT-5\.6 Sol|gpt-5\.6-sol)/i })
        .click();
      const payload = (await switched).postDataJSON();
      expect(payload).toMatchObject({
        backend: "fireworks-chat",
        model: "gpt-5.6-sol",
        api_key_env: saved.api_key_env,
      });
      expect(JSON.stringify(payload)).not.toContain(canary);
      expect((await (await switched).response())?.ok()).toBe(true);

      await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
      const rebound = await openModelList(page);
      await page.getByRole("textbox", { name: "Search models", exact: true }).fill("gpt-5.6-sol");
      await expect(
        rebound
          .getByText("Fireworks", { exact: true })
          .locator("..")
          .getByRole("menuitemradio", { name: /^(?:GPT-5\.6 Sol|gpt-5\.6-sol)/i }),
      ).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
      expect(
        fixture.calls.filter(
          (call) => call.method === "PATCH" && call.path === `/sessions/${id}/config`,
        ),
      ).toHaveLength(1);
    } finally {
      await fixture.stop();
    }
  });
}

test("composer fences configuration writes after uncertain settlement or a newer revision", async ({
  harness,
  page,
  request,
}) => {
  const project = await createProject(request, harness);
  const id = await createSession(request, harness, "direct", project);
  const resource = `/sessions/${id}/config`;
  const configUrl = `${harness.baseUrl}${resource}`;
  const config = async (): Promise<{ config_version: number; reasoning_effort: string }> =>
    (await request.get(configUrl)).json();
  const initial = await config();
  expect(initial.reasoning_effort).toBe("high");
  const fixture = await startHostedFixture(harness, id);
  const chip = page.getByRole("button", { name: /^Model: / });
  const notices = page.getByRole("region", { name: "Notifications", exact: true });
  const openEffort = async () => {
    await chip.click();
    return page.getByRole("dialog", { name: "Model settings", exact: true });
  };
  const writes = () =>
    fixture.calls.filter((call) => call.method === "PATCH" && call.path === resource);

  try {
    await page.goto(fixture.baseUrl);
    const effort = await openEffort();
    fixture.loseNextResponse("PATCH", resource);
    const sent = page.waitForRequest(
      (req) => req.method() === "PATCH" && req.url().endsWith(resource),
    );
    await effort.getByRole("radio", { name: "Medium", exact: true }).press("Space");
    expect((await sent).postDataJSON()).toMatchObject({
      expected_config_version: initial.config_version,
      reasoning_effort: "medium",
    });
    await expect(
      notices.getByRole("alert").filter({ hasText: "save outcome is unknown" }),
    ).toBeVisible();
    const accepted = await config();
    expect(accepted).toMatchObject({
      config_version: initial.config_version + 1,
      reasoning_effort: "medium",
    });
    expect(fixture.lostResponses).toHaveLength(1);
    expect(writes()).toHaveLength(1);
    await expect(chip).toHaveAccessibleName(/Medium reasoning/);
    await expect(chip).toBeDisabled();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
    await expect(chip).toHaveAccessibleName(/Medium reasoning/);
    await openEffort();
    const newer = await request.patch(configUrl, {
      data: { expected_config_version: accepted.config_version, reasoning_effort: "low" },
    });
    expect(newer.ok()).toBe(true);
    await effort.getByRole("radio", { name: "High", exact: true }).press("Space");
    await expect(
      notices.getByRole("alert").filter({ hasText: "changed or is busy" }),
    ).toBeVisible();
    expect(await config()).toMatchObject({
      config_version: accepted.config_version + 1,
      reasoning_effort: "low",
    });
    await expect(chip).toHaveAccessibleName(/Low reasoning/);
    await expect(chip).toBeDisabled();
    expect(writes()).toHaveLength(2);
  } finally {
    await fixture.stop();
  }
});
