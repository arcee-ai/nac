import { test, expect } from "./fixture";
import fs from "node:fs/promises";
import path from "node:path";

test("production workspace streams, asks permission and a question, and keeps Mac document on close", async ({
  candidate: c,
}) => {
  const project = await c.project();
  const session = await c.session("direct", project);
  for (const behavior of ["orchestrator", "direct-with-orchestrator"]) {
    const id = await c.session(behavior, project);
    expect((await c.api(`/sessions/${id}`)).metadata.behavior).toBe(behavior);
  }
  await fs.writeFile(path.join(c.directory, "outside.txt"), "Electron tool result\n");
  c.provider.enqueue(
    "read",
    { token: "ELECTRON_JOURNEY" },
    {
      kind: "function_call",
      name: "read",
      callId: "electron-read",
      arguments: { path: path.join(c.directory, "outside.txt") },
      stream: true,
    },
  );
  c.provider.enqueue(
    "read-result",
    { functionOutputCallId: "electron-read" },
    {
      kind: "text",
      text: "Electron streamed tool journey completed.",
      stream: true,
    },
  );
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, session);
  const composer = c.page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  await composer.fill("ELECTRON_JOURNEY");
  await c.page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(c.page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  await c.page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(
    c.page.getByText("Electron streamed tool journey completed.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await c.api(`/sessions/${session}`)).active_run == null)
    .toBe(true);
  c.provider.enqueue(
    "question",
    { token: "ELECTRON_QUESTION" },
    {
      kind: "function_call",
      name: "request_question",
      callId: "electron-question",
      stream: true,
      arguments: {
        request_id: "electron-choice",
        text: "Choose the development output format",
        choices: ["JSON", "CSV"],
        responder_class: "human_decision",
      },
    },
  );
  await composer.fill("ELECTRON_QUESTION");
  await c.page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    c.page.getByText("Choose the development output format", { exact: true }),
  ).toBeVisible();
  // A pending human decision must survive window close and Dock activation.
  const before = await c.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const id = win.webContents.id;
    win.close();
    return id;
  });
  await expect
    .poll(() => c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false);
  await c.app.evaluate(({ app }) => app.emit("activate"));
  await expect
    .poll(() => c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true);
  expect(
    await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id),
  ).toBe(before);
  await expect(
    c.page.getByText("Choose the development output format", { exact: true }),
  ).toBeVisible();
  // Cancel protected Quit preserves the exact engine, document and decision.
  await c.app.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    app.quit();
    app.quit();
  });
  await expect(composer).toBeVisible();
  expect(c.app.process().exitCode).toBeNull();
  expect((await c.api(`/sessions/${session}/questions`))[0].status).toBe("pending");
  c.provider.enqueue(
    "answered",
    { token: "Structured question response" },
    {
      kind: "text",
      text: "The selected JSON answer reached the exact continuation.",
      stream: true,
    },
  );
  await c.page.getByRole("button", { name: "JSON", exact: true }).click();
  await c.page.getByRole("button", { name: "Send answer", exact: true }).click();
  await expect(
    c.page.getByText("The selected JSON answer reached the exact continuation.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await c.api(`/sessions/${session}/questions`))[0].continuation_state)
    .toBe("delivered");
  c.provider.enqueue(
    "coding-command",
    { token: "ELECTRON_CODE_CHANGE" },
    {
      kind: "function_call",
      name: "write",
      callId: "electron-code-change",
      stream: true,
      arguments: {
        path: "answer.js",
        content: "export const answer = 42;\n",
        expected_revision: null,
      },
    },
  );
  c.provider.enqueue(
    "coding-result",
    { functionOutputCallId: "electron-code-change" },
    {
      kind: "text",
      text: "Created and checked the representative code change.",
      stream: true,
    },
  );
  await composer.fill("ELECTRON_CODE_CHANGE");
  await c.page.getByRole("button", { name: "Send", exact: true }).click();
  const writeDecision = c.page.getByRole("button", { name: "Allow once", exact: true });
  const codeFinished = c.page.getByText("Created and checked the representative code change.", {
    exact: true,
  });
  await expect(writeDecision.or(codeFinished).first()).toBeVisible();
  if (await writeDecision.isVisible()) await writeDecision.click();
  await expect(
    c.page.getByText("Created and checked the representative code change.", { exact: true }),
  ).toBeVisible();
  expect(await fs.readFile(path.join(c.workspace, "answer.js"), "utf8")).toBe(
    "export const answer = 42;\n",
  );
  c.provider.assertConsumed();
});

test("real renderer stays sandboxed and native menus route through the shared guards", async ({
  candidate: c,
}) => {
  expect(
    await c.page.evaluate(() => ({
      require: typeof (window as any).require,
      process: typeof (window as any).process,
    })),
  ).toEqual({ require: "undefined", process: "undefined" });
  expect(
    await c.app.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        sandbox: prefs.sandbox,
        isolation: prefs.contextIsolation,
        node: prefs.nodeIntegration,
        throttling: BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
      };
    }),
  ).toEqual({ sandbox: true, isolation: true, node: false, throttling: true });
  const globals = await c.page.evaluate(() => ({
    desktop: Object.keys((window as any).__nacDesktop ?? {}),
    paths: Object.keys((window as any).__nacLocalPaths ?? {}),
  }));
  expect(globals.desktop).not.toContain("exec");
  expect(globals.desktop).not.toContain("openExternal");
  expect(globals.paths).not.toContain("readFile");
  const roles = await c.app.evaluate(({ Menu }) => {
    const all: string[] = [];
    const walk = (items: any[]) => {
      for (const item of items) {
        if (item.role) all.push(item.role);
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(Menu.getApplicationMenu()!.items);
    return all;
  });
  expect(roles).toContain("copy");
  expect(roles).toContain("paste");
  expect(roles).toContain("undo");
});

test("trusted Chromium terminal input reaches Rust PTY and protected Stop reaps its process", async ({
  candidate: c,
}) => {
  const session = await c.session();
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/terminal`;
  }, session);
  const show = c.page.getByRole("button", { name: "Show panel", exact: true });
  const pane = c.page.getByRole("region", { name: "Session terminal", exact: true });
  await expect(show.or(pane)).toBeVisible();
  if (await show.isVisible()) await show.click();
  await pane.getByRole("button", { name: /^New shell$/i }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
  await c.page.keyboard.type(
    "printf 'ELECTRON_PTY_OUTPUT\\n'; printf owned > electron-input.txt; echo $$ > electron-shell.pid",
  );
  await c.page.keyboard.press("Enter");
  await expect
    .poll(() => fs.readFile(path.join(c.workspace, "electron-input.txt"), "utf8").catch(() => ""))
    .toBe("owned");
  await expect(pane.locator(".xterm-accessibility")).toContainText("ELECTRON_PTY_OUTPUT");
  c.ownedPids.push(
    Number((await fs.readFile(path.join(c.workspace, "electron-shell.pid"), "utf8")).trim()),
  );
  const permissions = await c.api(`/sessions/${session}/permissions`);
  expect(permissions.approval_mode).toBe("manual");
  expect(permissions.requests).toHaveLength(0);
  expect(permissions.grants).toHaveLength(0);
  await c.page.keyboard.type("sleep 120");
  await c.page.keyboard.press("Enter");
  await c.page.keyboard.press("Control+c");
  await c.page.keyboard.type("printf interrupted > electron-interrupt.txt");
  await c.page.keyboard.press("Enter");
  await expect
    .poll(() =>
      fs.readFile(path.join(c.workspace, "electron-interrupt.txt"), "utf8").catch(() => ""),
    )
    .toBe("interrupted");
  await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 850));
  // Fixture teardown invokes the ordinary protected Stop and Quit with the PTY
  // still open, and asserts the owned engine actually exits.
});

test("actual Electron parent death closes its engine channel and settles an open terminal", async ({
  candidate: c,
}) => {
  const session = await c.session();
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/terminal`;
  }, session);
  const pane = c.page.getByRole("region", { name: "Session terminal", exact: true });
  const show = c.page.getByRole("button", { name: "Show panel", exact: true });
  await expect(show.or(pane)).toBeVisible();
  if (await show.isVisible()) await show.click();
  await pane.getByRole("button", { name: /^New shell$/i }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
  await c.page.keyboard.type(
    "echo $$ > parent-death-shell.pid; sleep 120 & echo $! > parent-death-job.pid",
  );
  await c.page.keyboard.press("Enter");
  for (const file of ["parent-death-shell.pid", "parent-death-job.pid"]) {
    await expect
      .poll(() => fs.readFile(path.join(c.workspace, file), "utf8").catch(() => ""))
      .toMatch(/^\d+\s*$/);
    c.ownedPids.push(Number((await fs.readFile(path.join(c.workspace, file), "utf8")).trim()));
  }
  // Only the exact retained Electron ChildProcess is signaled. Rust receives
  // fd3 EOF; no test signal is sent to the engine, terminal or descendants.
  const parent = c.app.process();
  parent.kill("SIGKILL");
  await expect.poll(() => parent.signalCode).toBe("SIGKILL");
});
