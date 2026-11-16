import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import {
  createProject,
  createSession,
  expect,
  startForegroundChild,
  test,
  waitForRunIdle,
} from "./harness";
import { ScriptGate } from "./scripted-provider";
import { STDIO_MCP_SERVER } from "./mcp-library-fixture";
import { startPackedPresentation } from "./packed-presentation-fixture";
import { openNameZoom } from "./session-name-zoom";
import { finishPresentation } from "./presentation-lifetime";
import { ownComposedCleanup, ownPackedCapturePage } from "./presentation-capture-page";
import {
  activate,
  activatePacked390Model,
  recordPackedOverflow,
  captureComposed,
  composedBranch,
  composedWidths,
  installComposedFixture,
  menuAction,
  primaryModelTrigger,
  type ComposedFixture,
  type Journey,
} from "./presentation-composed-fixture";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const composedPrompt = "COMPOSED_QUALIFICATION_REASONING";
const answer = "The exact composed artifact preserved the selected workflow.";
const reasoning =
  "Read the selected state before acting.\n\nKeep the parent and sibling contexts independent.";
const childTitle = "Inspect the composed artifact and retain the complete parent context";
test.use({ orchestration: "0", hasTouch: true });
test.skip(
  !!process.env.NAC_E2E_REMOTE,
  "Requires the isolated current production binary and controlled external boundaries",
);

async function launchComposed(j: Journey) {
  const { root, fixture, page } = j;
  const start = root.getByRole("button", { name: "Get Started", exact: true });
  if (await start.isVisible()) await activate(j, start);
  else await menuAction(j, /^New project$/i);
  const form = root.getByRole("dialog", { name: "New Project", exact: true });
  const model = primaryModelTrigger(form);
  if (j.width === 768) {
    await expect
      .poll(() => fixture.calls.some((call) => call.method === "GET" && call.path === "/models"))
      .toBe(true);
    await expect(model).toBeDisabled();
  }
  fixture.catalogGate.release();
  if (j.transport === "packed" && j.width === 390) await activatePacked390Model(j, form, model);
  else await activate(j, model);
  await root.getByPlaceholder("Search models…").fill("gpt-5.6-sol");
  await root.getByPlaceholder("Search models…").press("ArrowDown");
  await root.getByPlaceholder("Search models…").press("Enter");
  await expect(model).toHaveAttribute("aria-expanded", "false");
  const title = form.getByRole("textbox", { name: "Project name", exact: true });
  await title.fill("Composed launch / preserve long selected context");
  const folder = form
    .getByRole("button", {
      name: new RegExp(`Working Folder|${fixture.folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    })
    .first();
  await activate(j, folder);
  await expect(
    root.getByRole("dialog", { name: "Select Working Folder", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(folder).toBeFocused();
  await expect(title).toHaveValue("Composed launch / preserve long selected context");
  await activate(j, form.getByRole("button", { name: "Close", exact: true }));
  await expect(form).toHaveCount(0);
  expect(fixture.state.projectAttempts).toBe(0);
  expect(fixture.state.sessionCreates).toBe(0);
  if (await start.isVisible()) await activate(j, start);
  else await menuAction(j, /^New project$/i);
  if (j.transport === "packed" && j.width === 390) await activatePacked390Model(j, form, model);
  else await activate(j, model);
  await root.getByPlaceholder("Search models…").fill("gpt-5.6-sol");
  await root.getByPlaceholder("Search models…").press("ArrowDown");
  await root.getByPlaceholder("Search models…").press("Enter");
  await expect(model).toHaveAttribute("aria-expanded", "false");
  await title.fill("Composed qualification project");
  const launch = form.getByRole("button", { name: "Create Project", exact: true });
  if (j.width === 768) {
    await activate(j, launch);
    await expect(form.getByRole("alert")).toHaveText(
      "Choose a valid Git working folder. (HTTP 400)",
    );
    // The prior request error clears only after an actual public edit.
    await title.fill("Composed qualification project / retry");
  }
  await expect(launch).toBeEnabled();
  const created = page
    .waitForResponse(
      (response) =>
        fixture.resource(new URL(response.url())) === "/sessions" &&
        response.request().method() === "POST",
    )
    .then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    );
  await activate(j, launch);
  try {
    await expect.poll(() => fixture.state.projectPending).toBe(true);
    await expect(launch).toBeDisabled();
    expect(fixture.state.sessionCreates).toBe(0);
    if (j.transport === "packed" && j.width === 195)
      await recordPackedOverflow(j, "packed195-pending-overflow");
    await captureComposed(j, "launch-pending");
  } finally {
    fixture.projectGate.release();
  }
  const observed = await created;
  if ("error" in observed) throw observed.error;
  const accepted = observed.response;
  expect(accepted.ok()).toBe(true);
  const body = (await accepted.json()) as { metadata: { session_id: string } };
  const id = body.metadata.session_id;
  expect(id).toBeTruthy();
  expect(body.metadata).toMatchObject({ behavior: "direct" });
  expect(fixture.state.sessionCreates).toBe(1);
  expect(fixture.state.projectAttempts).toBe(j.width === 768 ? 2 : 1);
  await expect(form).toHaveCount(0);
  const config = (await (
    await j.request.get(`${j.harness.baseUrl}/sessions/${id}/config`)
  ).json()) as { base_url: string; model: string };
  expect(new URL(config.base_url).origin).toBe(new URL(j.harness.provider.baseUrl).origin);
  expect(config.model).toBe("gpt-5.6-sol");
  await expect(
    j.root
      .getByRole("region", { name: "Notifications", exact: true })
      .getByText("Project created", { exact: true }),
  ).toHaveCount(0);
  return id;
}

async function conversationComposed(j: Journey, id: string) {
  const gate = new ScriptGate();
  j.harness.provider.enqueue(
    "composed-reasoning",
    { token: composedPrompt },
    { kind: "text", stream: "request", reasoning, text: answer },
    gate,
  );
  const composer = j.root.getByRole("combobox", { name: "Message", exact: true });
  await composer.fill(composedPrompt);
  await activate(j, j.root.getByRole("button", { name: "Send", exact: true }));
  await gate.accepted;
  expect(
    j.harness.provider.requests.find((entry) => entry.matchedStep === "composed-reasoning")?.body,
  ).toMatchObject({ stream: true });
  try {
    await activate(j, j.root.getByRole("button", { name: "Thinking…", exact: true }).first());
    const detail = j.root.getByRole("region", { name: "Insights detail", exact: true });
    const disclosure = detail.getByRole("button", { name: "Thinking…", exact: true });
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await disclosure.focus();
    await j.page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    gate.release();
    await waitForRunIdle(j.request, j.harness, id);
    await expect(detail.getByRole("button", { name: /^Reasoning/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const settled = detail.getByRole("button", { name: /^Reasoning/ });
    await activate(j, settled);
    await activate(j, detail.getByRole("button", { name: /^Copy Reasoning/ }));
    await expect
      .poll(() =>
        j.page.evaluate(() =>
          (
            globalThis as unknown as {
              navigator: { clipboard: { readText: () => Promise<string> } };
            }
          ).navigator.clipboard.readText(),
        ),
      )
      .toBe(reasoning);
    await captureComposed(j, "conversation-settled");
  } finally {
    gate.release();
  }
  if (j.width < 768) {
    const phone = j.root.getByRole("dialog", { name: "Insights", exact: true });
    await activate(j, phone.getByRole("button", { name: "Open list", exact: true }));
    await activate(j, phone.getByRole("button", { name: "Close", exact: true }));
  }
  await expect(composer).toBeVisible();
  await activate(j, j.root.getByRole("button", { name: "Copy message", exact: true }).last());
  await expect
    .poll(() =>
      j.page.evaluate(() =>
        (
          globalThis as unknown as { navigator: { clipboard: { readText: () => Promise<string> } } }
        ).navigator.clipboard.readText(),
      ),
    )
    .toBe(answer);
  await composer.fill("Unsent parent chat draft survives settings and managed setup");
}

async function settingsComposed(j: Journey) {
  const settings = j.root.getByRole("dialog", { name: "Session settings", exact: true });
  const notifications = j.root.getByRole("region", { name: "Notifications", exact: true });
  await activate(j, j.root.getByRole("button", { name: "Session settings", exact: true }));
  const title = settings.getByRole("textbox", { name: "Session title", exact: true });
  await title.fill("Discard this settings draft");
  await activate(j, settings.getByRole("button", { name: "Cancel", exact: true }));
  await expect(settings).toHaveCount(0);
  await activate(j, j.root.getByRole("button", { name: "Session settings", exact: true }));
  await expect(title).not.toHaveValue("Discard this settings draft");
  await title.fill("Composed settings saved");
  await settings.getByText("Advanced execution settings", { exact: true }).click();
  await activate(j, settings.getByRole("button", { name: "Advanced Configurations", exact: true }));
  await settings.getByRole("textbox", { name: "Context limit", exact: true }).fill("48000");
  if (j.width === 768) {
    await activate(j, settings.getByRole("button", { name: "Save", exact: true }));
    await expect(settings.getByRole("alert")).toContainText("Configured Deny");
  }
  await captureComposed(j, "settings-draft");
  await activate(j, settings.getByRole("button", { name: "Save", exact: true }));
  await expect(settings).toHaveCount(0);
  await activate(j, j.root.getByRole("button", { name: "Session settings", exact: true }));
  await expect(title).toHaveValue("Composed settings saved");
  await activate(j, settings.getByRole("button", { name: "Cancel", exact: true }));
  await expect(settings).toHaveCount(0);
  await expect(
    j.root
      .getByRole("region", { name: "Notifications", exact: true })
      .getByText("Session settings saved", { exact: true }),
  ).toHaveCount(0);

  await menuAction(j, /^MCP servers/);
  await activate(
    j,
    j.root.getByRole("button", {
      name: j.width < 768 ? "Add server" : "Custom server",
      exact: true,
    }),
  );
  if (j.width < 768) await activate(j, j.root.getByRole("button", { name: "Custom", exact: true }));
  const form = j.root.getByRole("dialog", {
    name: j.width < 768 ? "Custom server" : "MCP servers",
    exact: true,
    includeHidden: true,
  });
  await form.getByPlaceholder("my_server").fill("qualification_mcp");
  await activate(j, form.getByRole("button", { name: "Stdio", exact: true }));
  await form.getByPlaceholder("npx").fill(process.execPath);
  for (const value of ["-e", STDIO_MCP_SERVER, "qualification-long-argument-".repeat(8)]) {
    await activate(j, form.getByRole("button", { name: "Add argument", exact: true }));
    await j.page.keyboard.insertText(value);
  }
  await activate(j, form.getByRole("button", { name: "Remove argument 3", exact: true }));
  await form
    .getByPlaceholder("my_server")
    .dispatchEvent("keydown", { key: "Escape", isComposing: true, keyCode: 229 });
  await expect(form).toBeVisible();
  await activate(j, form.getByRole("button", { name: "Test connection", exact: true }));
  await expect(form.getByText("1 tool found", { exact: true })).toBeVisible();
  const connectionNotice = notifications.getByText("Connection succeeded: 1 tool found.", {
    exact: true,
  });
  await expect(connectionNotice).toBeVisible();
  await captureComposed(j, "mcp-controlled-test");
  await expect(connectionNotice).toHaveCount(0);
  await activate(j, form.getByRole("button", { name: "Save", exact: true }));
  const servers = j.root.getByRole("dialog", {
    name: "MCP servers",
    exact: true,
    includeHidden: true,
  });
  await expect(
    servers.getByRole("button", { name: "qualification_mcp", exact: true }),
  ).toBeVisible();
  const savedNotice = notifications.getByText("MCP server saved.", { exact: true });
  await expect(savedNotice).toBeVisible();
  await expect(savedNotice).toHaveCount(0);
  if (j.width < 768)
    await activate(j, servers.getByRole("button", { name: "qualification_mcp", exact: true }));
  const saved = j.root.getByRole("dialog", {
    name: j.width < 768 ? "qualification_mcp" : "MCP servers",
    exact: true,
    includeHidden: true,
  });
  await expect(saved.getByRole("textbox", { name: "Argument 1", exact: true })).toHaveValue("-e");
  if (j.width === 768) {
    await activate(j, saved.getByRole("button", { name: "Test connection", exact: true }));
    await activate(j, servers.getByRole("button", { name: "qualification_mcp", exact: true }));
    j.fixture.mcpGate.release();
    await expect(saved.getByText("1 tool found", { exact: true })).toBeVisible();
    await expect(connectionNotice).toBeVisible();
    await expect(connectionNotice).toHaveCount(0);
  }
  await activate(j, saved.getByRole("button", { name: "Delete server", exact: true }));
  const deletedNotice = notifications.getByText("MCP server deleted.", { exact: true });
  await expect(deletedNotice).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await j.request.get(`${j.harness.baseUrl}/mcp_library/servers`)).json()).servers
          .length,
    )
    .toBe(0);
  await expect(deletedNotice).toHaveCount(0);
  // All retained nested forms must unmount before another product surface opens.
  for (const name of ["qualification_mcp", "Add server", "MCP servers"]) {
    const layer = j.root.getByRole("dialog", { name, exact: true, includeHidden: true });
    if (await layer.count()) {
      const close = layer
        .locator(":scope > header")
        .getByRole("button", { name: "Close", exact: true });
      await expect(close).toHaveCount(1);
      if (await close.isVisible()) await activate(j, close);
      await expect(layer).toHaveCount(0);
    }
  }
}

async function managedComposed(j: Journey) {
  const state = j.fixture.state;
  const notifications = j.root.getByRole("region", { name: "Notifications", exact: true });
  const operationsBefore = state.loginStarts + state.secretWrites + state.cloneStarts;
  state.managed = true; // The controlled host becomes available; normal status polling observes it.
  await menuAction(j, /^(Managed host|Manage Host)$/);
  const modal = j.root.getByRole("dialog", { name: "Managed host", exact: true });
  await expect(modal.getByTestId("managed-host-status")).toContainText(
    "Controlled host readiness",
    { timeout: 25_000 },
  );
  expect(state.loginStarts + state.secretWrites + state.cloneStarts).toBe(operationsBefore);
  const unavailable = modal.getByTestId("managed-upgrade-unavailable");
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toContainText(
    j.width === 768 ? "no longer authorized" : "temporarily unavailable",
  );
  await activate(j, modal.getByRole("button", { name: "GitHub", exact: true }));
  const github = modal.getByTestId("managed-github-settings");
  if (j.width === 768) {
    await expect(
      github.getByText("GitHub App is not configured on this host.", { exact: true }),
    ).toBeVisible();
    await activate(j, github.getByRole("button", { name: "Connect GitHub", exact: true }));
    await expect(github.getByRole("alert")).toContainText("denied");
  }
  await activate(j, github.getByRole("button", { name: "Connect GitHub", exact: true }));
  await expect(github.getByTestId("github-device-code")).toContainText("TEST-CODE");
  j.fixture.loginGate.release();
  await expect(github.getByText("Connected", { exact: true })).toBeVisible();
  expect(state.loginStarts).toBe(j.width === 768 ? 2 : 1);
  const githubNotice = notifications.getByText("GitHub connected", { exact: true });
  await expect(githubNotice).toBeVisible();
  await expect(githubNotice).toHaveCount(0);
  await activate(j, modal.getByRole("button", { name: "secrets", exact: true }));
  const names = modal.getByLabel("Variable name", { exact: true });
  const value = modal.getByLabel("New value", { exact: true });
  await names.fill("QUALIFICATION_SUBMITTED");
  await value.fill("synthetic-dummy-value");
  await expect(value).toHaveAttribute("type", "password");
  await activate(j, modal.getByRole("button", { name: "Save secret", exact: true }));
  try {
    await expect.poll(() => state.secretPending).toBe(true);
    if (j.width <= 390) {
      await names.fill("QUALIFICATION_NEWER_DRAFT");
      await value.fill("synthetic-newer-dummy");
      // Editing away and back must still retain ownership of the newer draft.
      await names.fill("QUALIFICATION_SUBMITTED");
      await names.fill("QUALIFICATION_NEWER_DRAFT");
    }
  } finally {
    j.fixture.secretGate.release();
  }
  await expect(modal.getByText("QUALIFICATION_SUBMITTED", { exact: true })).toBeVisible();
  if (j.width <= 390) {
    await expect(names).toHaveValue("QUALIFICATION_NEWER_DRAFT");
    await expect(value).toHaveValue("synthetic-newer-dummy");
  } else {
    await expect(names).toHaveValue("");
    await expect(value).toHaveValue("");
  }
  await expect(modal.getByText("synthetic-dummy-value", { exact: true })).toHaveCount(0);
  const secretNotice = notifications.getByText("Secret saved for future command spawns", {
    exact: true,
  });
  await expect(secretNotice).toBeVisible();
  await captureComposed(j, "managed-newer-draft");
  await expect(secretNotice).toHaveCount(0);
  await activate(j, modal.getByRole("button", { name: "Close", exact: true }));
  await expect(modal).toHaveCount(0);
  // The desktop session sidebar links to the public projects view; its creation
  // action there retains the managed Add repository label. Return through that
  // same project after cancellation so the parent draft remains part of the journey.
  if (j.width >= 768) await menuAction(j, "All projects");
  await menuAction(j, "Add repository");
  const repository = j.root.getByRole("dialog", { name: "Add repository", exact: true });
  await repository.getByLabel("Find repository", { exact: true }).fill("qualification");
  await activate(j, repository.getByRole("button", { name: /arcee-ai\/qualification/ }));
  await activate(j, repository.getByRole("button", { name: "Branch: main", exact: true }));
  await j.root.getByRole("combobox", { name: "Find branch", exact: true }).fill("long-branch");
  await activate(j, j.root.getByRole("option", { name: composedBranch, exact: true }));
  await activate(j, repository.getByRole("button", { name: "Clone repository", exact: true }));
  await expect(
    repository.getByText("Controlled clone pending; no repository is published", { exact: true }),
  ).toBeVisible();
  await activate(j, repository.getByRole("button", { name: "Cancel clone", exact: true }));
  await expect(
    repository.getByText("Clone cancelled; staging checkout removed", { exact: true }),
  ).toBeVisible();
  expect(state.cloneStarts).toBe(1);
  expect(state.cloneCancels).toBe(1);
  expect(state.secretWrites).toBe(1);
  await activate(j, repository.getByRole("button", { name: "Cancel", exact: true }));
  await expect(repository).toHaveCount(0);
  if (j.width >= 768)
    await activate(
      j,
      j.root.getByRole("button", { name: /Composed qualification project/ }).first(),
    );
}

async function inspectorComposed(j: Journey, id: string) {
  const childPrompt = "COMPOSED_CHILD";
  j.harness.provider.enqueue(
    "composed-child",
    { token: childPrompt },
    { kind: "text", text: "Child inspection complete without modifying files." },
  );
  const started = await startForegroundChild(j.request, j.harness, id, childTitle, childPrompt);
  expect(started.ok()).toBe(true);
  const child = ((await started.json()) as { child_session_id: string }).child_session_id;
  j.harness.provider.enqueue(
    "composed-status",
    { token: "COMPOSED_PARENT_STATUS" },
    {
      kind: "function_call",
      name: "subagent_status",
      stream: "request",
      callId: "composed-status",
      arguments: { child_session_id: child, _nac: null },
    },
  );
  j.harness.provider.enqueue(
    "composed-files",
    { functionOutputCallId: "composed-status" },
    {
      kind: "function_call",
      name: "glob",
      stream: "request",
      callId: "composed-files",
      arguments: { pattern: "*.txt" },
    },
  );
  j.harness.provider.enqueue(
    "composed-parent-finished",
    { functionOutputCallId: "composed-files" },
    { kind: "text", stream: "request", text: "Composed parent origin retained." },
  );
  const run = await j.request.post(`${j.harness.baseUrl}/sessions/${id}/runs`, {
    data: { prompt: "COMPOSED_PARENT_STATUS" },
  });
  expect(run.status()).toBe(202);
  await waitForRunIdle(j.request, j.harness, id);
  await expect(j.root.getByText("Composed parent origin retained.", { exact: true })).toBeVisible();
  if (j.width < 768)
    await activate(j, j.root.getByRole("button", { name: "Open panel", exact: true }));
  else {
    const show = j.root.getByRole("button", { name: "Show panel", exact: true });
    if (await show.isVisible()) await activate(j, show);
  }
  await activate(j, j.root.getByRole("tab", { name: "Insights", exact: true }));
  // Compact inspector panes depend on their container, including two packed
  // instances in a wide viewport. Follow the public return-to-list affordance.
  const openList = j.root.getByRole("button", { name: "Open list", exact: true });
  if (await openList.isVisible()) await activate(j, openList);
  await activate(
    j,
    j.root.getByRole("button", { name: j.width < 768 ? "Show All" : "All actions", exact: true }),
  );
  await activate(j, j.root.getByRole("button", { name: "Tools & reasoning", exact: true }));
  // Chat badges and singleton rows share this label. Only the public list's
  // expandable action group owns aria-expanded and the child-status segments.
  const activity = j.root
    .getByRole("button", { name: /^Total activity:/ })
    .and(j.root.locator("button[aria-expanded]"));
  await expect(activity).toHaveCount(1);
  if ((await activity.getAttribute("aria-expanded")) === "false") await activate(j, activity);
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  await activate(j, j.root.getByRole("button", { name: `${childTitle}, Check`, exact: true }));
  const status = j.root.getByRole("group", { name: "Session status", exact: true });
  const jump = status.getByRole("button", { name: childTitle, exact: true });
  await expect(status).toHaveAttribute("aria-current", "true");
  const anchor = await status.boundingBox();
  await activate(j, jump);
  const back = j.root.getByRole("button", { name: "Back to Insights", exact: true });
  const panelDraft = j.root
    .locator("form")
    .filter({ has: j.page.getByRole("switch", { name: "Run in the background" }) })
    .getByRole("textbox", { name: "Send a message" });
  await expect(panelDraft).toHaveCount(1);
  await panelDraft.fill("Exact unsent child-preview draft");
  await activate(j, j.root.getByRole("button", { name: "Open", exact: true }));
  const browserEndpoint =
    j.transport === "packed" ? new URL("/fixture-runtime", j.page.url()).href : j.harness.baseUrl;
  const parentEvents = new URL(
    `${browserEndpoint.replace(/\/$/, "")}/sessions/${encodeURIComponent(id)}/events/stream`,
  );
  // Wait for the returning page's own parent stream before sampling the later model call.
  await Promise.all([
    j.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        response.request().resourceType() === "eventsource" &&
        url.origin === parentEvents.origin &&
        url.pathname === parentEvents.pathname &&
        response.status() === 200 &&
        (response.headers()["content-type"] ?? "").startsWith("text/event-stream")
      );
    }),
    activate(j, j.root.getByRole("button", { name: /, parent chat$/i })),
  ]);
  await expect(panelDraft).toHaveValue("Exact unsent child-preview draft");
  const later = new ScriptGate();
  j.harness.provider.enqueue(
    "composed-later",
    { token: "COMPOSED_LATER" },
    {
      kind: "text",
      stream: "request",
      reasoning: "Later activity retains the original parent origin.",
      text: "Later activity settled.",
    },
    later,
  );
  try {
    const accepted = await j.request.post(`${j.harness.baseUrl}/sessions/${id}/runs`, {
      data: { prompt: "COMPOSED_LATER" },
    });
    expect(accepted.status()).toBe(202);
    await later.accepted;
    expect(
      j.harness.provider.requests.find((entry) => entry.matchedStep === "composed-later")?.body,
    ).toMatchObject({ stream: true });
    expect(
      (await (await j.request.get(`${j.harness.baseUrl}/sessions/${id}`)).json()).active_run,
    ).toBeTruthy();
    later.release();
    await waitForRunIdle(j.request, j.harness, id);
    await expect(panelDraft).toHaveValue("Exact unsent child-preview draft");
  } finally {
    later.release();
  }
  if (j.width < 768) await activate(j, back);
  else {
    // Keyboard Back activation owns the wide detail-focus restoration check.
    await back.focus();
    await expect(back).toBeFocused();
    await j.page.keyboard.press("Enter");
  }
  await expect(status).toHaveAttribute("aria-current", "true");
  await expect
    .poll(async () => Math.abs((await status.boundingBox())!.y - anchor!.y))
    .toBeLessThanOrEqual(2);
  if (j.width < 768) {
    await activate(j, openList);
    await activate(j, j.root.getByRole("tab", { name: "Insights", exact: true }));
    const selected = j.root.getByRole("button", { name: `${childTitle}, Check`, exact: true });
    await expect(selected).toBeVisible();
    await activate(j, selected);
    await expect(status).toHaveAttribute("aria-current", "true");
    // Pointer list picks preserve their own interaction contract. Keyboard Back owns detail focus.
    await activate(j, jump);
    await expect(panelDraft).toHaveValue("Exact unsent child-preview draft");
    await expect(back).toBeVisible();
    for (let tab = 0; tab < 20; tab += 1) {
      if (await back.evaluate((element) => element.matches(":focus"))) break;
      await j.page.keyboard.press("Tab");
    }
    await expect(back).toBeFocused();
    await j.page.keyboard.press("Enter");
    await expect(status).toHaveAttribute("aria-current", "true");
  }
  await expect(j.root.getByRole("region", { name: "Insights detail", exact: true })).toBeFocused();
  await captureComposed(j, "inspector-parent-return");
  j.harness.provider.assertConsumed();
}

for (const transport of ["standalone", "packed"] as const) {
  for (const width of composedWidths) {
    test(`composed launch, settings, managed and inspector ${transport} at ${width}px`, async ({
      harness,
      request,
      page: defaultPage,
    }, info) => {
      test.setTimeout(240_000);
      const packed =
        transport === "packed"
          ? await (async () => {
              const project = await createProject(request, harness);
              const id = await createSession(request, harness, "direct", project);
              return {
                id,
                fixture: await startPackedPresentation(harness, id, { twoInstances: true }),
              };
            })()
          : undefined;
      const baseUrl = packed?.fixture.baseUrl ?? harness.baseUrl;
      const endpoint = packed ? `${baseUrl}/fixture-runtime` : harness.baseUrl;
      let boundary: ComposedFixture | undefined;
      let zoomContext: Awaited<ReturnType<typeof openNameZoom>> | undefined;
      const failures: unknown[] = [];
      const forbidden: string[] = [],
        errors: string[] = [];
      const packedPage = ownPackedCapturePage(
        baseUrl,
        async (page, name) => {
          const close = page
            .getByRole("region", { name: `${name} presentation`, exact: true })
            .getByRole("button", { name: "Close packed runtime", exact: true });
          if (await close.isVisible()) await close.click();
        },
        async (page) => {
          await expect(page.locator("[data-nac-runtime]")).toHaveCount(0);
        },
      );
      const cleanup = ownComposedCleanup(() => boundary, packedPage);
      const prepare = async (page: Page) => {
        if (packed) packedPage.retain(page);
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.protocol === "http:" || url.protocol === "https:") {
            if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
              forbidden.push(url.origin);
              return route.abort("blockedbyclient");
            }
          }
          return route.fallback();
        });
        boundary = await installComposedFixture(page, request, harness, endpoint, width);
      };
      try {
        const source =
          process.env.NAC_QUALIFICATION_SOURCE_REVISION ??
          execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
        // The real service identity is read directly, never from the mocked managed/status visual data.
        const identity = await request.get(
          `${harness.baseUrl}/product-context${packed ? `?session_id=${packed.id}` : ""}`,
        );
        expect(identity.ok()).toBe(true);
        const facts = (await identity.json()) as {
          build: { source_revision: string; build_id: string };
        };
        expect(facts.build.source_revision).toBe(source);
        expect(facts.build.build_id.length).toBeGreaterThan(0);
        let page = defaultPage;
        if (width === 195) {
          zoomContext = await openNameZoom(
            info,
            baseUrl,
            prepare,
            { width: 390, height: 1000 },
            cleanup.beforeContextClose,
          );
          page = zoomContext.page;
          expect(zoomContext.zoom).toBe(2);
          await expect
            .poll(() =>
              page.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth),
            )
            .toBe(195);
          expect(
            await page.evaluate(
              () => (globalThis as unknown as { devicePixelRatio: number }).devicePixelRatio,
            ),
          ).toBe(2);
        } else {
          await page.setViewportSize({ width, height: 1000 });
          await prepare(page);
          await page.goto(baseUrl);
        }
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        if (!boundary) throw new Error("Composed boundary was not installed before navigation");
        const root = packed
          ? page.getByRole("region", { name: "Left presentation", exact: true })
          : page.locator("[data-nac-runtime]");
        const right = page.getByRole("region", { name: "Right presentation", exact: true });
        const rightComposer = right.getByRole("combobox", { name: "Message", exact: true });
        const host = page.getByRole("textbox", { name: "Host draft", exact: true });
        if (packed) {
          await rightComposer.fill("Unrelated Right draft must remain unchanged");
          await host.fill("Unrelated host draft must remain unchanged");
        }
        const journey: Journey = {
          page,
          root,
          request,
          harness,
          fixture: boundary,
          width,
          info,
          transport,
        };
        if (transport === "packed" && width === 195)
          await recordPackedOverflow(journey, "packed195-before-launch");
        const id = await launchComposed(journey);
        await conversationComposed(journey, id);
        await settingsComposed(journey);
        await managedComposed(journey);
        await expect(root.getByRole("combobox", { name: "Message", exact: true })).toHaveValue(
          "Unsent parent chat draft survives settings and managed setup",
        );
        await inspectorComposed(journey, id);
        if (packed) {
          await expect(rightComposer).toHaveValue("Unrelated Right draft must remain unchanged");
          await expect(host).toHaveValue("Unrelated host draft must remain unchanged");
          await expect(right.getByLabel("Right native location", { exact: true })).toHaveText(
            `/session/${packed.id}/files`,
          );
          await expect(page.getByLabel("Product location", { exact: true })).toHaveText("/");
          await expect(page.locator("#sentinel")).toHaveCSS("font-family", "monospace");
          await expect(page.locator("#sentinel")).toHaveCSS("padding", "11px");
          await expect(page.locator("body")).toHaveCSS("margin", "17px");
          await expect(page.locator("body > [inert]")).toHaveCount(0);
          expect(
            boundary.calls.filter(
              (call) =>
                call.binding?.endsWith("-Right") &&
                ["POST", "PUT", "PATCH", "DELETE"].includes(call.method) &&
                call.path !== "/providers/models",
            ),
          ).toEqual([]);
          if (width === 1440) {
            for (const font of packed.fixture.fontAssets) {
              const response = await request.get(new URL(`/native-assets/${font}`, baseUrl).href);
              expect(response.status()).toBe(200);
              expect(
                createHash("sha256")
                  .update(await response.body())
                  .digest("hex"),
              ).toBe(packed.fixture.fontSha256[font]);
            }
          }
          await packedPage.dispose();
          await expect
            .poll(() =>
              page.evaluate(() =>
                Object.values(
                  (
                    globalThis as unknown as {
                      __packedQualification: () => Record<
                        string,
                        { closed: boolean; openStreams: number }
                      >;
                    }
                  ).__packedQualification(),
                ).every((entry) => entry.closed && entry.openStreams === 0),
              ),
            )
            .toBe(true);
        }
        expect(forbidden).toEqual([]);
        expect(errors).toEqual([]);
        await info.attach("exact composed qualification receipt", {
          contentType: "application/json",
          body: JSON.stringify({
            source,
            producer: facts.build,
            transport,
            width,
            zoom: zoomContext?.zoom ?? 1,
            packageSha256: packed?.fixture.tarballSha256 ?? null,
            packageIntegrity: packed?.fixture.integrity ?? null,
            peers: packed?.fixture.peerVersions ?? null,
            calls: boundary.calls,
            operations: boundary.state,
            limitation:
              "Controlled local provider/managed/MCP boundaries, supported dark, reduced motion, emulated touch/IME; no physical device, OS AT/IME or signed ALL541 host acceptance.",
          }),
        });
      } catch (error) {
        failures.push(error);
      } finally {
        await finishPresentation(failures, [
          () => cleanup.dispose(),
          () => zoomContext?.context.close(),
          () => packed?.fixture.stop(),
        ]);
      }
    });
  }
}
