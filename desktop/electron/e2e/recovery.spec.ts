import { test, expect, showTerminalPanel, type Candidate } from "./fixture";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prepareNewShell, workspacePage } from "./ui-readiness";

async function state(c: Candidate) {
  return c.app.evaluate(({ app }) =>
    process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState(),
  );
}
async function replacement(c: Candidate, previous: number) {
  await expect.poll(() => c.page.isClosed()).toBe(true);
  await expect
    .poll(async () =>
      c.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((window) => window.webContents.getURL().startsWith("http://127.0.0.1:"))
          .map((window) => window.webContents.id),
      ),
    )
    .not.toContain(previous);
  c.page = await workspacePage(c.app, c.endpoint);
  await expect.poll(async () => (await state(c)).recovery.pending).toBe(false);
  return c.page;
}
test("renderer crash retires the document while approval, queue and PTY retain the original engine without replay", async ({
  candidate: c,
}, info) => {
  const session = await c.session();
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/terminal`;
  }, session);
  const pane = await showTerminalPanel(c.page);
  await prepareNewShell(pane);
  await pane.getByRole("button", { name: /^New shell$/i }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
  await c.page.keyboard.type("printf x >> recovery-input.txt; echo $$ > recovery-shell.pid");
  await c.page.keyboard.press("Enter");
  await expect
    .poll(() => fs.readFile(path.join(c.workspace, "recovery-input.txt"), "utf8").catch(() => ""))
    .toBe("x");
  c.ownedPids.push(
    Number((await fs.readFile(path.join(c.workspace, "recovery-shell.pid"), "utf8")).trim()),
  );
  await c.page.getByRole("button", { name: "Hide panel", exact: true }).click();
  await expect(pane).not.toBeVisible();
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, session);
  const outside = path.join(c.directory, "recovery-outside.txt");
  await fs.writeFile(outside, "fixture only");
  c.provider.enqueue(
    "recovery-approval",
    { token: "RECOVERY_APPROVAL" },
    {
      kind: "function_call",
      name: "read",
      callId: "recovery-read",
      arguments: { path: outside },
      stream: true,
    },
  );
  c.provider.enqueue(
    "recovery-denial-result",
    { functionOutputCallId: "recovery-read" },
    { kind: "text", text: "The denied read was not repeated.", stream: true },
  );
  c.provider.enqueue(
    "recovery-queued",
    { token: "Queued fixture must stay queued" },
    { kind: "text", text: "One canonical queued delivery.", stream: true },
  );
  await c.page.getByRole("combobox", { name: "Message" }).fill("RECOVERY_APPROVAL");
  await c.page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(c.page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  const queued = await c.api(`/sessions/${session}/inbox`, {
    delivery: "queue",
    prompt: "Queued fixture must stay queued",
  });
  await expect(c.page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  const before = await state(c);
  const permissions = await c.api(`/sessions/${session}/permissions`);
  const document = await c.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().startsWith("http:"),
    )!;
    const id = window.webContents.id;
    window.webContents.forcefullyCrashRenderer();
    return id;
  });
  await replacement(c, document);
  expect(new URL(c.page.url()).hash).toBe(`#/session/${session}/files`);
  await expect(c.page.getByRole("combobox", { name: "Message" })).toBeVisible();
  await expect
    .poll(async () => (await c.api(`/sessions/${session}/permissions`)).requests.length)
    .toBe(0);
  const after = await state(c);
  expect(after.enginePid).toBe(before.enginePid);
  expect(after.receipt).toEqual(before.receipt);
  expect((await c.api(`/sessions/${session}/permissions`)).grants).toEqual(permissions.grants);
  await expect
    .poll(
      async () =>
        (await c.api(`/sessions/${session}/inbox`)).find((item: any) => item.id === queued.id)
          ?.status,
    )
    .toBe("delivered");
  await expect
    .poll(
      () =>
        c.provider.requests.filter((request) => request.matchedStep === "recovery-queued").length,
    )
    .toBe(1);
  expect(
    c.provider.requests.filter((request) => request.matchedStep === "recovery-approval"),
  ).toHaveLength(1);
  expect(await fs.readFile(path.join(c.workspace, "recovery-input.txt"), "utf8")).toBe("x");
  expect(
    await c.page.evaluate(() => Reflect.get(window, "__nacRequireTerminalAcknowledgement")),
  ).toBe(true);
  const capture = info.outputPath("recovered-original-engine-route.png");
  await c.page.screenshot({ path: capture });
  await info.attach("recovered-original-engine-route", { path: capture, contentType: "image/png" });
});

test("actual failed GET replaces transport/runtime once and retains the same engine", async ({
  candidate: c,
}) => {
  const session = await c.session(),
    before = await state(c);
  const document = await c.app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id,
  );
  let failed = 0;
  await c.page.route("**/*", async (route) => {
    if (
      route.request().method() === "GET" &&
      ["fetch", "xhr"].includes(route.request().resourceType())
    ) {
      ++failed;
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/terminal`;
  }, session);
  await expect.poll(() => failed).toBeGreaterThan(0);
  await replacement(c, document);
  await expect(c.page.getByRole("combobox", { name: "Message" })).toBeVisible();
  expect(failed).toBeGreaterThan(0);
  expect((await state(c)).receipt).toEqual(before.receipt);
  expect((await state(c)).enginePid).toBe(before.enginePid);
  expect(c.provider.requests).toHaveLength(0);
});

test("Quit Cancel during document retirement defers reload until the original choice settles", async ({
  candidate: c,
}) => {
  const before = await state(c);
  await c.app.evaluate(({ app, dialog, BrowserWindow }) => {
    let answer: (value: any) => void;
    Reflect.set(globalThis, "recoveryQuitAnswer", (response: number) =>
      answer({ response, checkboxChecked: false }),
    );
    dialog.showMessageBox = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    app.quit();
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();
  });
  await expect.poll(async () => (await state(c)).phase).toBe("confirming");
  expect((await state(c)).enginePid).toBe(before.enginePid);
  await c.app.evaluate(() => Reflect.get(globalThis, "recoveryQuitAnswer")(0));
  await expect.poll(async () => (await state(c)).phase).toBe("running");
  await expect.poll(async () => (await state(c)).recovery.pending).toBe(false);
  await expect
    .poll(async () => (await c.app.windows()).some((page) => page.url().startsWith(c.endpoint)))
    .toBe(true);
  c.page = (await c.app.windows()).find((page) => page.url().startsWith(c.endpoint))!;
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
  expect((await state(c)).receipt).toEqual(before.receipt);
});

test("Quit Stop during a crashed document joins original cleanup without a successor", async ({
  candidate: c,
}) => {
  const before = await state(c),
    process = c.app.process();
  await c.app.evaluate(({ app, dialog, BrowserWindow }) => {
    let answer: (value: any) => void;
    Reflect.set(globalThis, "recoveryQuitAnswer", (response: number) =>
      answer({ response, checkboxChecked: false }),
    );
    dialog.showMessageBox = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    app.quit();
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();
  });
  await expect.poll(async () => (await state(c)).phase).toBe("confirming");
  expect((await state(c)).enginePid).toBe(before.enginePid);
  await c.app.evaluate(() => Reflect.get(globalThis, "recoveryQuitAnswer")(1));
  await expect
    .poll(() => process.exitCode !== null || process.signalCode !== null, { timeout: 30000 })
    .toBe(true);
  expect(c.provider.requests).toHaveLength(0);
});

test("protected Quit waits for accepted checkpoint writes and exact helper close after engine cleanup", async ({
  candidate: c,
}) => {
  const applicationProcess = c.app.process();
  const session = await c.session();
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, session);
  const composer = c.page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  const initial = await state(c),
    helper = initial.storage.checkpointPid;
  expect(helper).toBeGreaterThan(0);
  const custody = execFileSync("/bin/ps", ["-p", String(helper), "-o", "ppid=,comm="], {
    encoding: "utf8",
  }).trim();
  expect(custody).toMatch(new RegExp(`^${c.app.process().pid}\\s+.*\\/checkpoint-helper$`));
  c.ownedPids.push(helper);
  process.kill(helper, "SIGSTOP"); // Exact retained private fixture child only.
  try {
    await composer.fill("Delayed checkpoint must drain before Quit");
    await expect.poll(async () => (await state(c)).storage.pending).toBeGreaterThan(0);
    await c.app.evaluate(({ app, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      app.quit();
    });
    await expect.poll(async () => (await state(c)).enginePid).toBe(0);
    expect(c.app.process().exitCode).toBeNull();
    expect((await state(c)).phase).toBe("stopping");
    expect((await state(c)).storage.pending).toBeGreaterThan(0);
  } finally {
    process.kill(helper, "SIGCONT");
  }
  await expect
    .poll(() => applicationProcess.exitCode !== null || applicationProcess.signalCode !== null, {
      timeout: 30000,
    })
    .toBe(true);
});

test("deterministic suspend/resume retires document and revalidates the exact engine and route", async ({
  candidate: c,
}) => {
  const session = await c.session(),
    before = await state(c);
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, session);
  await expect(c.page.getByRole("combobox", { name: "Message" })).toBeVisible();
  await c.app.evaluate(({ powerMonitor }) => powerMonitor.emit("suspend"));
  await expect.poll(async () => (await state(c)).recovery.suspended).toBe(true);
  await expect
    .poll(async () => (await c.app.windows()).some((page) => page.url().startsWith("data:")))
    .toBe(true);
  expect((await state(c)).receipt).toEqual(before.receipt);
  await c.app.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
  await expect.poll(async () => (await state(c)).recovery.pending).toBe(false);
  c.page = await workspacePage(c.app, c.endpoint);
  await expect(c.page.getByRole("combobox", { name: "Message" })).toBeVisible();
  expect(new URL(c.page.url()).hash).toBe(`#/session/${session}/files`);
  expect((await state(c)).receipt).toEqual(before.receipt);
  expect((await state(c)).enginePid).toBe(before.enginePid);
  expect(
    await c.page.evaluate(() => Reflect.get(window, "__nacRequireTerminalAcknowledgement")),
  ).toBe(true);
  expect(c.provider.requests).toHaveLength(0);
});

test("engine death while deterministically suspended remains an explicit restart after cleanup", async ({
  candidate: c,
}) => {
  await c.app.evaluate(({ powerMonitor, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    powerMonitor.emit("suspend");
  });
  await expect.poll(async () => (await state(c)).recovery.suspended).toBe(true);
  process.kill(c.enginePid, "SIGKILL"); // Exact fixture-owned Rust leader only.
  await expect.poll(async () => (await state(c)).enginePid).toBe(0);
  await c.app.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
  await expect.poll(async () => Boolean((await state(c)).failure)).toBe(true);
  expect((await state(c)).enginePid).toBe(0);
  expect(c.provider.requests).toHaveLength(0);
  await expect
    .poll(
      async () =>
        (await c.app.windows()).filter(
          (page) => !page.isClosed() && page.url().startsWith(c.endpoint),
        ).length,
    )
    .toBe(0);
});

test("automatic renderer recovery is bounded and explicit menu reload retains the original engine", async ({
  candidate: c,
}) => {
  const before = await state(c);
  const crash = () =>
    c.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().startsWith("http:"),
      )!;
      const id = window.webContents.id;
      window.webContents.forcefullyCrashRenderer();
      return id;
    });
  await replacement(c, await crash());
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
  await crash();
  await expect
    .poll(async () =>
      (await c.app.windows()).some((page) => !page.isClosed() && page.url().startsWith("data:")),
    )
    .toBe(true);
  expect((await state(c)).recovery.attempts).toBe(1);
  expect((await state(c)).enginePid).toBe(before.enginePid);
  await c.app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById("workspace-reload")!;
    item.click();
  });
  await expect.poll(async () => (await state(c)).recovery.pending).toBe(false);
  c.page = await workspacePage(c.app, c.endpoint);
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
  expect((await state(c)).receipt).toEqual(before.receipt);
});

test("new engine Retry permits fresh terminal input while same-engine reload still requires acknowledgement", async ({
  candidate: c,
}) => {
  // The hosted desktop uses the compact list/detail layout. Exercise it
  // explicitly so a wider local display cannot hide a missed row selection.
  const compactWindow = async () => {
    await c.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().startsWith("http:"))!
        .setSize(1024, 677);
    });
    await expect.poll(() => c.page.evaluate(() => innerWidth)).toBe(1024);
    console.log(
      "Recovery compact viewport",
      await c.page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    );
  };
  await compactWindow();
  const session = await c.session(),
    original = await state(c);
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/terminal`;
  }, session);
  let pane = await showTerminalPanel(c.page);
  await prepareNewShell(pane);
  await pane.getByRole("button", { name: /^New shell$/i }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
  await c.page.keyboard.type("echo $$ > retry-original-shell.pid");
  await c.page.keyboard.press("Enter");
  await expect
    .poll(() =>
      fs.readFile(path.join(c.workspace, "retry-original-shell.pid"), "utf8").catch(() => ""),
    )
    .not.toBe("");
  c.ownedPids.push(
    Number((await fs.readFile(path.join(c.workspace, "retry-original-shell.pid"), "utf8")).trim()),
  );
  const originalTerminals = await c.api<{ terminals: { terminal_id: string }[] }>(
    `/sessions/${session}/user-terminals`,
  );
  expect(originalTerminals.terminals).toHaveLength(1);
  const originalTerminal = originalTerminals.terminals[0].terminal_id;
  const previousDocument = await c.app.evaluate(({ BrowserWindow, Menu }) => {
    const id = BrowserWindow.getAllWindows()[0].webContents.id;
    Menu.getApplicationMenu()!.getMenuItemById("workspace-reload")!.click();
    return id;
  });
  await replacement(c, previousDocument);
  expect((await state(c)).receipt).toEqual(original.receipt);
  await compactWindow();
  pane = await showTerminalPanel(c.page);
  expect(
    (
      await c.api<{ terminals: { terminal_id: string }[] }>(`/sessions/${session}/user-terminals`)
    ).terminals.map((terminal) => terminal.terminal_id),
  ).toEqual([originalTerminal]);
  const originalExecutions = await c.api<{
    executions: {
      id: string;
      origin: string;
      representation: string;
      alive: boolean;
      input: boolean;
      process_state: string;
    }[];
  }>(`/sessions/${session}/executions`);
  expect(originalExecutions.executions.map((execution) => execution.id)).toEqual([
    originalTerminal,
  ]);
  const originalExecution = originalExecutions.executions[0];
  expect(originalExecution).toMatchObject({
    origin: "human",
    representation: "pty",
    alive: true,
    input: true,
  });
  const originalControl = await c.api<{ controller: string }>(
    `/sessions/${session}/executions/${encodeURIComponent(originalTerminal)}/input-control`,
  );
  expect(originalControl.controller).toBe("human");
  console.log("Recovered terminal facts", {
    document: await c.page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      hash: location.hash,
      acknowledgementRequired: Reflect.get(window, "__nacRequireTerminalAcknowledgement"),
    })),
    buttons: await pane.locator("button").evaluateAll((buttons) =>
      buttons.slice(0, 8).map((button) => ({
        name: (button.getAttribute("aria-label") ?? button.textContent ?? "").trim().slice(0, 100),
        terminalTab: button.hasAttribute("data-terminal-tab"),
        visible: button.getClientRects().length > 0,
      })),
    ),
    execution: {
      id: originalExecution.id,
      origin: originalExecution.origin,
      representation: originalExecution.representation,
      alive: originalExecution.alive,
      input: originalExecution.input,
      process_state: originalExecution.process_state,
    },
    control: originalControl,
  });
  // Opening the Focus drawer starts on its list at compact widths. Select the
  // retained shell before expecting its detail's acknowledgement control.
  await pane
    .getByRole("button", {
      name: `Shell 1, ${originalExecution.process_state.replaceAll("_", " ")}`,
      exact: true,
    })
    .click();
  const acknowledgement = c.page.getByRole("button", {
    name: "Acknowledge failure and enable fresh input",
    exact: true,
  });
  await expect(acknowledgement).toBeVisible();
  expect(
    await c.page.evaluate(() => Reflect.get(window, "__nacRequireTerminalAcknowledgement")),
  ).toBe(true);
  await acknowledgement.click();
  await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
  await c.page.keyboard.type("printf acknowledged > retry-same-engine.txt");
  await c.page.keyboard.press("Enter");
  await expect
    .poll(() =>
      fs.readFile(path.join(c.workspace, "retry-same-engine.txt"), "utf8").catch(() => ""),
    )
    .toBe("acknowledged");

  await c.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  process.kill(original.enginePid, "SIGKILL"); // Exact private fixture leader only.
  await expect.poll(async () => (await state(c)).enginePid).toBe(0);
  await expect
    .poll(async () => (await c.app.windows()).filter((page) => !page.isClosed()).length)
    .toBe(0);
  expect((await state(c)).failure).toBeTruthy();
  const nextWindow = c.app.waitForEvent("window");
  await c.app.evaluate(({ app }) => {
    void process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .retry();
  });
  c.page = await nextWindow;
  await c.page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
  const restarted = await state(c);
  expect(restarted.receipt.incarnation).not.toBe(original.receipt.incarnation);
  expect(restarted.enginePid).not.toBe(original.enginePid);
  expect(restarted.receipt.store).toBe(original.receipt.store);
  const custody = Number(
    execFileSync("/bin/ps", ["-p", String(restarted.enginePid), "-o", "ppid="], {
      encoding: "utf8",
    }).trim(),
  );
  expect(
    execFileSync("/bin/ps", ["-p", String(custody), "-o", "ppid=,comm="], {
      encoding: "utf8",
    }).trim(),
  ).toMatch(new RegExp(`^${c.app.process().pid}\\s+.*\\/engine-launcher$`));
  c.ownedPids.push(restarted.enginePid, custody);
  pane = await showTerminalPanel(c.page);
  await expect(pane).toBeVisible();
  await prepareNewShell(pane);
  await pane.getByRole("button", { name: /^New shell$/i }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await expect(
    c.page.getByRole("button", { name: "Acknowledge failure and enable fresh input", exact: true }),
  ).toHaveCount(0);
  await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
  await c.page.keyboard.type(
    "printf fresh > retry-fresh-engine.txt; echo $$ > retry-fresh-shell.pid",
  );
  await c.page.keyboard.press("Enter");
  await expect
    .poll(() =>
      fs.readFile(path.join(c.workspace, "retry-fresh-engine.txt"), "utf8").catch(() => ""),
    )
    .toBe("fresh");
  c.ownedPids.push(
    Number((await fs.readFile(path.join(c.workspace, "retry-fresh-shell.pid"), "utf8")).trim()),
  );
  expect(
    await c.page.evaluate(() => Reflect.get(window, "__nacRequireTerminalAcknowledgement")),
  ).toBeUndefined();
  expect(c.provider.requests).toHaveLength(0);
});
