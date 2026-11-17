import { test, expect } from "./fixture";

test("a genuine child-frame load failure preserves the workspace and owned engine", async ({
  candidate: c,
}) => {
  await c.app.evaluate(({ BrowserWindow, dialog }) => {
    (globalThis as any).__loadFailureRows = [];
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    BrowserWindow.getAllWindows()[0].webContents.on(
      "did-fail-load",
      (_event, code, description, url, isMainFrame) => {
        (globalThis as any).__loadFailureRows.push({ code, description, url, isMainFrame });
      },
    );
  });
  await c.page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "failure-frame";
    document.body.appendChild(frame);
  });
  const frame = await c.page.locator("#failure-frame").elementHandle();
  const child = await frame!.contentFrame();
  // Browser automation initiates a real subframe load; the production DOM
  // navigation guard remains installed and no failure event is synthesized.
  await child!.goto("http://127.0.0.1:1/frame-load-failure").catch(() => {});
  await expect
    .poll(() => c.app.evaluate(() => (globalThis as any).__loadFailureRows))
    .toEqual(expect.arrayContaining([expect.objectContaining({ isMainFrame: false })]));
  const rows = await c.app.evaluate(() => (globalThis as any).__loadFailureRows);
  console.log("Actual child-frame navigation failures", JSON.stringify(rows));
  expect(rows.some((row: any) => row.isMainFrame === false && row.code !== -3)).toBe(true);
  const state = await c.app.evaluate(({ app }) =>
    process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState(),
  );
  expect(state.failure).toBeNull();
  expect(state.enginePid).toBe(c.enginePid);
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
});

test("a genuine main-frame load failure replaces the document and retains the verified engine", async ({
  candidate: c,
}) => {
  const initial = await c.app.evaluate(({ app }) =>
    process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState(),
  );
  const originalPage = c.page;
  await c.app.evaluate(({ BrowserWindow, dialog }) => {
    (globalThis as any).__loadFailureRows = [];
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    (globalThis as any).__failedMainContents = contents;
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      (globalThis as any).__loadFailureRows.push({ code, description, url, isMainFrame });
    });
    void contents.loadURL("http://127.0.0.1:1/main-load-failure").catch(() => {});
  });
  await expect
    .poll(() => c.app.evaluate(() => (globalThis as any).__loadFailureRows))
    .toEqual(expect.arrayContaining([expect.objectContaining({ isMainFrame: true, code: -312 })]));
  await expect.poll(() => c.app.windows().filter((page) => page !== originalPage).length).toBe(1);
  c.page = c.app.windows().find((page) => page !== originalPage)!;
  await c.page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      c.app.evaluate(
        ({ app }) =>
          process
            .getBuiltinModule("module")
            .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
            .getState().recovery.pending,
      ),
    )
    .toBe(false);
  const recovered = await c.app.evaluate(({ app }) =>
    process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState(),
  );
  expect(recovered.enginePid).toBe(initial.enginePid);
  expect(recovered.receipt).toEqual(initial.receipt);
  expect(recovered.failure).toBeNull();
  expect(await c.app.evaluate(() => (globalThis as any).__failedMainContents.isDestroyed())).toBe(
    true,
  );
  expect(new URL(c.page.url()).origin).toBe(c.endpoint);
  expect(c.app.windows()).toHaveLength(1);
  expect(c.provider.requests).toHaveLength(0);
});
