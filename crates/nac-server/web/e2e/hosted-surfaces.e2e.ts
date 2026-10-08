import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";

import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { startHostedFixture } from "./hosted-fixture";

const execute = promisify(execFile);
test.skip(
  !!process.env.NAC_E2E_REMOTE,
  "Requires disposable local workspaces and scripted providers",
);
test.use({ orchestration: "0" });

async function showFiles(page: Page, mobile: boolean) {
  const files = page.getByRole("tab", { name: "Files", exact: true });
  if (mobile) {
    if (!(await files.first().isVisible()))
      await page.getByRole("button", { name: "Open panel", exact: true }).click();
    await files.last().click();
  } else if (!(await files.isVisible())) {
    await page.getByRole("button", { name: "Show panel", exact: true }).click();
  }
  await expect(files.last()).toBeVisible();
}

async function openFileList(page: Page, mobile: boolean) {
  if (mobile && !(await page.getByRole("dialog", { name: "Files", exact: true }).isVisible()))
    await page.getByRole("button", { name: "Open list", exact: true }).click();
}
async function closeFileList(page: Page, mobile: boolean) {
  if (!mobile) return;
  const list = page.getByRole("dialog", { name: "Files", exact: true });
  await list.getByRole("button", { name: "Close", exact: true }).click();
  await expect(list).toHaveCount(0);
}

async function chooseFile(page: Page, name: string, mobile: boolean) {
  if (mobile && !(await page.getByRole("button", { name, exact: true }).isVisible())) {
    await page.getByRole("button", { name: "Open list", exact: true }).click();
  }
  const allFiles = page.getByRole("button", { name: "Show every file", exact: true });
  if ((await allFiles.getAttribute("aria-pressed")) !== "true") await allFiles.click();
  await page.getByRole("button", { name, exact: true }).click();
  if (mobile) await expect(page.getByRole("dialog", { name: "Files", exact: true })).toHaveCount(0);
}

async function selectRevision(page: Page, name: RegExp, mobile: boolean) {
  if (mobile) await page.getByRole("tab", { name: "History", exact: true }).last().click();
  else await page.getByRole("button", { name: /^Snapshot:/ }).click();
  await page.getByRole("button", { name }).click();
  if (mobile) await page.getByRole("tab", { name: "Files", exact: true }).last().click();
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
      await closeFileList(page, mobile);
      await selectRevision(page, /^Working tree/, mobile);
      await chooseFile(page, "note.txt", mobile);
      await expect(page.getByText("CAPTURED_BETA", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Branch: main", exact: true }).click();
      await expect(page.getByRole("button", { name: "other", exact: true })).toBeDisabled();
      await page.getByPlaceholder("Find or create a branch").fill("injected-feature");
      await page.getByRole("button", { name: "Create injected-feature", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Branch: injected-feature", exact: true }),
      ).toBeVisible();
      await openFileList(page, mobile);
      await page.getByRole("button", { name: "Commit", exact: true }).click();
      await page.getByPlaceholder("Commit message").fill("injected accepted commit");
      await page.getByPlaceholder("Commit message").press("Control+Enter");
      await expect(page.getByPlaceholder("Commit message")).toHaveCount(0);
      await closeFileList(page, mobile);
      await expect
        .poll(async () => (await git("log", "-1", "--format=%s")).stdout.trim())
        .toBe("injected accepted commit");
      await page.getByRole("button", { name: "Branch: injected-feature", exact: true }).click();
      await page.getByRole("button", { name: "other", exact: true }).click();
      await expect(page.getByRole("button", { name: "Branch: other", exact: true })).toBeVisible();
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
      if (mobile) await page.keyboard.press("Escape");
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

  test(`injected session settings uncertainty and replacement ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness, { name: "Injected settings" });
    const id = await createSession(request, harness, "direct", project);
    const configUrl = `${harness.baseUrl}/sessions/${id}/config`;
    const before = await (await request.get(configUrl)).json();
    const projectsBefore = await (await request.get(`${harness.baseUrl}/projects`)).json();
    const fixture = await startHostedFixture(harness, id);
    try {
      await page.goto(fixture.baseUrl);
      await page.getByRole("button", { name: "Session settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
      await settings
        .getByRole("textbox", { name: "Session title", exact: true })
        .fill("Accepted injected title");
      await settings.getByText("Advanced execution settings", { exact: true }).click();
      await settings.getByRole("button", { name: "Advanced Configurations", exact: true }).click();
      await settings.getByRole("textbox", { name: "Context limit", exact: true }).fill("222");
      await settings.getByRole("button", { name: "Save", exact: true }).click();
      await expect(settings).toHaveCount(0);
      expect(await (await request.get(configUrl)).json()).toMatchObject({
        config_version: before.config_version + 1,
        orchestrator_compaction_threshold: 222,
      });
      expect(await (await request.get(`${harness.baseUrl}/projects`)).json()).toEqual(
        projectsBefore,
      );
      await page.getByRole("button", { name: "Session settings", exact: true }).click();
      await settings.getByText("Advanced execution settings", { exact: true }).click();
      await settings.getByRole("button", { name: "Advanced Configurations", exact: true }).click();
      await settings.getByRole("textbox", { name: "Context limit", exact: true }).fill("333");
      fixture.loseNextResponse("PATCH", `/sessions/${id}/config`);
      await settings.getByRole("button", { name: "Save", exact: true }).click();
      await expect(settings.getByRole("alert")).toContainText("outcome is unknown");
      await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(fixture.lostResponses).toHaveLength(1);
      expect(await (await request.get(configUrl)).json()).toMatchObject({
        orchestrator_compaction_threshold: 333,
      });
      expect(fixture.lostResponses[0].status).toBe(200);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
      await page.getByRole("button", { name: "Session settings", exact: true }).click();
      await expect(
        settings.getByRole("textbox", { name: "Session title", exact: true }),
      ).toHaveValue("Accepted injected title");
      await settings.getByText("Advanced execution settings", { exact: true }).click();
      await settings.getByRole("button", { name: "Advanced Configurations", exact: true }).click();
      await expect(
        settings.getByRole("textbox", { name: "Context limit", exact: true }),
      ).toHaveValue("333");
      const external = await request.patch(configUrl, {
        data: { orchestrator_compaction_threshold: 444 },
      });
      expect(external.ok()).toBe(true);
      await settings
        .getByRole("textbox", { name: "Session title", exact: true })
        .fill("Stale edit must not rename");
      await settings.getByRole("button", { name: "Save", exact: true }).click();
      await expect(settings.getByRole("alert")).toContainText("settings changed");
      await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(
        (await (await request.get(`${harness.baseUrl}/sessions`)).json()).find(
          (entry: { summary: { session_id: string } }) => entry.summary.session_id === id,
        ).summary.title,
      ).toBe("Accepted injected title");
      expect(fixture.lostResponses).toHaveLength(1);
      expect(
        fixture.calls.filter(
          (call) => call.method === "PATCH" && call.path === `/sessions/${id}/config`,
        ),
      ).toHaveLength(2);
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
    await fs.writeFile(
      script,
      `const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:
m.method==='tools/list'?{tools:[{name:'fixture_echo',description:'Local inert fixture',inputSchema:{type:'object',properties:{}}}]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});\n`,
    );
    const project = await createProject(request, harness, { name: "Injected outgoing MCP" });
    const id = await createSession(request, harness, "direct", project);
    const fixture = await startHostedFixture(harness, id);
    try {
      await page.goto(fixture.baseUrl);
      await page.getByRole("button", { name: /^MCP servers/ }).click();
      await page
        .getByRole("button", { name: mobile ? "Add server" : "Custom server", exact: true })
        .click();
      if (mobile) await page.getByRole("button", { name: "Custom", exact: true }).click();
      const form = page.getByRole("dialog").last();
      await form.getByPlaceholder("my_server").fill("injected_fixture");
      await form.getByRole("button", { name: "Stdio", exact: true }).click();
      await form.getByRole("button", { name: "Legacy", exact: true }).click();
      await form.getByPlaceholder("npx").fill(process.execPath);
      await form.getByPlaceholder("-y\nsome-mcp-server").fill(script);
      await form.getByRole("button", { name: "Test connection", exact: true }).click();
      await expect(form.getByText("1 tool found", { exact: true })).toBeVisible();
      await expect(form.getByText("fixture_echo", { exact: true })).toBeVisible();
      await form.getByRole("button", { name: "Save", exact: true }).click();
      if (mobile) await page.getByRole("button", { name: "injected_fixture", exact: true }).click();
      const editing = page.getByRole("dialog").last();
      await editing.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(editing.getByText("Runtime: connected", { exact: true })).toBeVisible();
      await editing.getByRole("button", { name: "Reload", exact: true }).click();
      await expect(editing.getByText("Runtime: connected", { exact: true })).toBeVisible();
      await editing.getByRole("button", { name: "Disconnect", exact: true }).click();
      await expect(editing.getByText("Runtime: disconnected", { exact: true })).toBeVisible();
      await editing.getByPlaceholder("my_server").fill("renamed_fixture");
      await editing.getByRole("button", { name: "Save", exact: true }).click();
      if (mobile) await page.getByRole("button", { name: "renamed_fixture", exact: true }).click();
      await expect(page.getByPlaceholder("my_server")).toHaveValue("renamed_fixture");
      await page.keyboard.press("Escape");
      if (mobile) await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
      await page.getByRole("button", { name: /^MCP servers/ }).click();
      if (mobile) await page.getByRole("button", { name: "renamed_fixture", exact: true }).click();
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
  test(`injected saved configuration CRUD and write-only key ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness, { name: "Injected saved configuration" });
    const id = await createSession(request, harness, "direct", project);
    const fixture = await startHostedFixture(harness, id);
    const open = async () => {
      if (mobile) await page.getByRole("button", { name: "Open the menu", exact: true }).click();
      await page.getByRole("button", { name: "Configurations", exact: true }).click();
    };
    try {
      await page.goto(fixture.baseUrl);
      await open();
      const dialog = page.getByRole("dialog", { name: "Configurations", exact: true });
      if (mobile)
        await dialog.getByRole("button", { name: "Choose configuration", exact: true }).click();
      await page.getByRole("button", { name: "New configuration", exact: true }).click();
      await dialog
        .getByRole("textbox", { name: "Configuration name", exact: true })
        .fill("Injected unused preset");
      // Set the local endpoint before a dummy key can trigger provider discovery.
      await dialog.getByPlaceholder("https://api.openai.com/v1").fill(harness.provider.baseUrl);
      await dialog.getByRole("switch", { name: "Allow insecure HTTP", exact: true }).check();
      const canary = "injected-preset-dummy-key-only";
      await dialog.getByPlaceholder("Paste the provider key").fill(canary);
      await expect
        .poll(() => fixture.calls.filter((call) => call.path === "/providers/models").length)
        .toBeGreaterThan(0);
      const manualModel = dialog.getByPlaceholder("gpt-5.5");
      if (await manualModel.isVisible()) await manualModel.fill("gpt-5.6-sol");
      else {
        await dialog.getByRole("button", { name: "No models offered", exact: true }).click();
        await page.getByRole("button", { name: "gpt-5.6-sol", exact: true }).click();
      }
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByText("Configuration Injected unused preset created", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("textbox", { name: "Configuration name", exact: true }),
      ).toHaveValue("Injected unused preset");
      await expect(dialog.getByPlaceholder("*".repeat(32))).toHaveValue("");
      const saved = (
        await (await request.get(`${harness.baseUrl}/model-configs`)).json()
      ).configurations.find((entry: { name: string }) => entry.name === "Injected unused preset");
      expect(saved).toBeDefined();
      expect(JSON.stringify(saved)).not.toContain(canary);
      await dialog
        .getByRole("textbox", { name: "Configuration name", exact: true })
        .fill("Renamed injected preset");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByText("Configuration Renamed injected preset saved", { exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      // Replace the whole runtime with identical IDs/endpoint and a new release fence.
      await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
      await open();
      await expect(
        dialog.getByRole("textbox", { name: "Configuration name", exact: true }),
      ).toHaveValue("Renamed injected preset");
      await expect(dialog.getByPlaceholder("*".repeat(32))).toHaveValue("");
      await dialog.getByRole("button", { name: "Delete configuration", exact: true }).click();
      await expect
        .poll(async () =>
          (
            await (await request.get(`${harness.baseUrl}/model-configs`)).json()
          ).configurations.some(
            (entry: { config_id: string }) => entry.config_id === saved.config_id,
          ),
        )
        .toBe(false);
      expect(
        fixture.calls.filter((call) => call.method === "POST" && call.path === "/model-configs"),
      ).toHaveLength(1);
      expect(
        fixture.calls.filter(
          (call) => call.method === "PATCH" && call.path === `/model-configs/${saved.config_id}`,
        ),
      ).toHaveLength(1);
      expect(
        fixture.calls.filter(
          (call) => call.method === "DELETE" && call.path === `/model-configs/${saved.config_id}`,
        ),
      ).toHaveLength(1);
    } finally {
      await fixture.stop();
    }
  });
}
