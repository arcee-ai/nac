import { test, expect, root, type Candidate } from "./fixture";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const { Engine } = require("../src/engine.cjs");

async function state(c: Candidate) {
  return c.app.evaluate(({ app }) =>
    process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState(),
  );
}
async function retry(c: Candidate) {
  await c.app.evaluate(({ app }) => {
    const main = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath());
    void main.retry();
    void main.retry();
  });
}
function retainEngineCustody(c: Candidate, enginePid: number) {
  const custodyPid = Number(
    execFileSync("/bin/ps", ["-p", String(enginePid), "-o", "ppid="], { encoding: "utf8" }).trim(),
  );
  const custody = execFileSync("/bin/ps", ["-p", String(custodyPid), "-o", "ppid=,comm="], {
    encoding: "utf8",
  }).trim();
  expect(custody).toMatch(new RegExp(`^${c.app.process().pid}\\s+.*\\/engine-launcher$`));
  c.ownedPids.push(enginePid, custodyPid);
}
function gone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

test("actual shell requires explicit Retry after crash and contention without replaying input", async ({
  candidate: c,
}) => {
  const project = await c.project(),
    session = await c.session("direct", project);
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, session);
  const composer = c.page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  await composer.fill("Unsubmitted input must never be replayed");
  const initial = await state(c);
  await c.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  process.kill(c.enginePid, "SIGKILL");
  await expect.poll(() => gone(c.enginePid)).toBe(true);
  await expect.poll(async () => (await state(c)).enginePid).toBe(0);
  await expect.poll(async () => !!(await state(c)).failure).toBe(true);
  expect(c.provider.requests).toHaveLength(0);
  const resources = path.join(root, "target/electron-resources");
  const identity = JSON.parse(
    fs.readFileSync(path.join(resources, "engine-identity.json"), "utf8"),
  );
  const occupier = new Engine({
    executable: path.join(root, "target/release/nac-web"),
    launcher: path.join(resources, "engine-launcher"),
    identity,
    schema: initial.receipt.schema,
    configuration: {
      cwd: fs.realpathSync(c.workspace),
      store: initial.receipt.store,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: path.join(c.directory, "home"),
        NAC_HOME: path.join(c.directory, "nac-home"),
        XDG_CONFIG_HOME: path.join(c.directory, "xdg"),
        NAC_E2E_API_KEY: "nac-e2e-dummy-only",
        MODELS_DEV_URL: `${c.provider.baseUrl}/models-dev`,
      },
    },
  });
  const ready = new Promise((resolve, reject) => {
    occupier.once("ready", resolve);
    occupier.once("failure", reject);
  });
  try {
    occupier.launch();
    await ready;
    await retry(c);
    await expect
      .poll(async () => (await state(c)).failure)
      .toContain("Another NAC process owns the selected store");
    await expect.poll(async () => (await state(c)).enginePid).toBe(0);
    expect(occupier.pid).toBeGreaterThan(0);
    expect(occupier.receipt).not.toBeNull();
    // A failed candidate does not attach, kill the occupier or invent a store.
    expect(await c.app.windows()).toHaveLength(0);
    expect(c.provider.requests).toHaveLength(0);
    await occupier.stop();
    const window = c.app.waitForEvent("window");
    await retry(c);
    const page = await window;
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await expect(page.getByText("Electron fixture project", { exact: true }).first()).toBeVisible();
    c.page = page;
    const restarted = await state(c);
    retainEngineCustody(c, restarted.enginePid);
    expect(restarted.enginePid).toBeGreaterThan(0);
    expect(restarted.enginePid).not.toBe(c.enginePid);
    expect(restarted.receipt.store).toBe(initial.receipt.store);
    expect(restarted.receipt.incarnation).not.toBe(initial.receipt.incarnation);
    expect(c.provider.requests).toHaveLength(0);
  } finally {
    await occupier.stop();
  }
});

test("duplicate Quit shares one delayed native choice and Cancel preserves exact document", async ({
  candidate: c,
}) => {
  const before = await state(c);
  const document = await c.app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id,
  );
  await c.app.evaluate(({ app, dialog }) => {
    const pending = { count: 0, resolve: null as null | ((value: any) => void) };
    (globalThis as any).__quitFixture = pending;
    dialog.showMessageBox = async () => {
      pending.count++;
      return new Promise((resolve) => {
        pending.resolve = resolve;
      });
    };
    app.quit();
    app.quit();
    app.quit();
  });
  await expect.poll(() => c.app.evaluate(() => (globalThis as any).__quitFixture.count)).toBe(1);
  expect((await state(c)).phase).toBe("confirming");
  await c.app.evaluate(() =>
    (globalThis as any).__quitFixture.resolve({ response: 0, checkboxChecked: false }),
  );
  await expect.poll(async () => (await state(c)).phase).toBe("running");
  expect((await state(c)).enginePid).toBe(before.enginePid);
  expect(
    await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id),
  ).toBe(document);
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
});

test("late native hide preserves visible activity while genuine close and reopen retain the document", async ({
  candidate: c,
}) => {
  await c.app.evaluate(({ BrowserWindow }) => {
    (globalThis as any).__visibilityFrame = BrowserWindow.getAllWindows()[0].webContents.mainFrame;
  });
  const session = await c.session();
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, session);
  const composer = c.page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  const document = await c.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win.isVisible()) throw new Error("Fixture window must already be visible");
    // Reproduce the observed AppKit callback ordering without changing the OS:
    // a late hide callback arrives after the same window is visible again.
    win.emit("hide");
    return win.webContents.id;
  });
  await c.app.evaluate(() => new Promise((resolve) => setImmediate(resolve)));
  await c.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(composer).toBeVisible({ timeout: 1500 });
  const closeFacts = await c.app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    let hideEvents = 0;
    const onHide = () => {
      hideEvents++;
    };
    win.on("hide", onHide);
    win.close();
    await new Promise((resolve) => setImmediate(resolve));
    win.removeListener("hide", onHide);
    return {
      hideEvents,
      visible: win.isVisible(),
      retainedFrame: win.webContents.mainFrame === (globalThis as any).__visibilityFrame,
    };
  });
  console.log("Owned close visibility facts", JSON.stringify(closeFacts));
  expect(closeFacts.retainedFrame).toBe(true);
  await expect
    .poll(() => c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false);
  await expect(composer).toBeHidden();
  await c.app.evaluate(({ app }) => app.emit("activate"));
  await expect(composer).toBeVisible();
  expect(
    await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id),
  ).toBe(document);
  expect((await state(c)).enginePid).toBe(c.enginePid);
});

for (const choice of [0, 1]) {
  test(`engine exit during pending Quit retains the owner until ${choice ? "Stop" : "Cancel"} settles`, async ({
    candidate: c,
  }) => {
    const applicationProcess = c.app.process();
    const document = await c.app.evaluate(({ BrowserWindow, app, dialog }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const pending = {
        oldContents: win.webContents,
        resolve: null as null | ((value: any) => void),
        questions: 0,
        errors: 0,
      };
      (globalThis as any).__failureQuitFixture = pending;
      dialog.showMessageBox = async (...args: any[]) => {
        const options = args[args.length - 1];
        if (options.type === "question") {
          pending.questions++;
          return new Promise((resolve) => {
            pending.resolve = resolve;
          });
        }
        pending.errors++;
        return { response: 0, checkboxChecked: false };
      };
      app.quit();
      app.quit();
      return win.webContents.id;
    });
    try {
      await expect
        .poll(() => c.app.evaluate(() => (globalThis as any).__failureQuitFixture.questions))
        .toBe(1);
      expect((await state(c)).phase).toBe("confirming");
      process.kill(c.enginePid, "SIGKILL");
      await expect.poll(() => gone(c.enginePid)).toBe(true);
      await expect.poll(async () => (await state(c)).enginePid).toBe(0);
      const retained = await c.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((win) => win.webContents.id),
      );
      expect(retained).toEqual([document]);
      expect((await state(c)).phase).toBe("confirming");
      await c.app.evaluate(
        (_electron, choice) =>
          (globalThis as any).__failureQuitFixture.resolve({
            response: choice,
            checkboxChecked: false,
          }),
        choice,
      );
      if (choice) {
        await expect.poll(() => applicationProcess.exitCode).toBe(0);
      } else {
        await expect.poll(async () => (await state(c)).phase).toBe("running");
        await expect
          .poll(() => c.app.evaluate(() => (globalThis as any).__failureQuitFixture.errors))
          .toBe(1);
        await expect.poll(async () => c.app.windows().length).toBe(0);
        const nextWindow = c.app.waitForEvent("window");
        await retry(c);
        c.page = await nextWindow;
        await c.page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
        await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
        const restarted = await state(c);
        retainEngineCustody(c, restarted.enginePid);
        const documentAfterRetry = await c.app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id,
        );
        await c.app.evaluate(() => {
          const previous = (globalThis as any).__failureQuitFixture.oldContents;
          previous.emit("did-fail-load", {}, -2);
          previous.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
        });
        await c.app.evaluate(() => new Promise((resolve) => setImmediate(resolve)));
        expect((await state(c)).failure).toBeNull();
        expect((await state(c)).enginePid).toBe(restarted.enginePid);
        expect(
          await c.app.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id,
          ),
        ).toBe(documentAfterRetry);
        await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
      }
    } finally {
      if (applicationProcess.exitCode === null && applicationProcess.signalCode === null) {
        await c.app
          .evaluate(() =>
            (globalThis as any).__failureQuitFixture.resolve?.({
              response: 0,
              checkboxChecked: false,
            }),
          )
          .catch(() => {});
      }
    }
  });
}

test("rejected Quit dialog cancels its transaction and preserves work", async ({
  candidate: c,
}) => {
  const initial = await state(c);
  await c.app.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = async () => {
      throw new Error("Fixture native dialog dismissed");
    };
    app.quit();
    app.quit();
  });
  await expect.poll(async () => (await state(c)).phase).toBe("running");
  expect((await state(c)).enginePid).toBe(initial.enginePid);
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
});

test("native application Hide/Show and minimize/restore preserve hidden activity policy", async ({
  candidate: c,
}) => {
  const session = await c.session();
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, session);
  const composer = c.page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  try {
    await c.app.evaluate(({ app, BrowserWindow }) => {
      app.show();
      app.focus({ steal: true });
      BrowserWindow.getAllWindows()[0].focus();
    });
    await expect
      .poll(() =>
        c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
      )
      .toBe(true);
    await c.app.evaluate(({ app }) => app.hide());
    await expect.poll(() => c.app.evaluate(({ app }) => app.isHidden())).toBe(true);
    const hidden = await c.app.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return {
        applicationHidden: app.isHidden(),
        windowVisible: win.isVisible(),
        document: win.webContents.id,
      };
    });
    console.log("Owned native Hide facts", JSON.stringify(hidden));
    expect(hidden.applicationHidden).toBe(true);
    await expect(composer).toBeHidden({ timeout: 1500 });
    await c.app.evaluate(({ app }) => app.emit("activate"));
    await expect.poll(() => c.app.evaluate(({ app }) => app.isHidden())).toBe(false);
    await expect(composer).toBeVisible();
    await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await expect
      .poll(() =>
        c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
      )
      .toBe(true);
    await expect(composer).toBeHidden();
    await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    await expect(composer).toBeVisible();
    expect(
      await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id),
    ).toBe(hidden.document);
    expect((await state(c)).enginePid).toBe(c.enginePid);
  } finally {
    await c.app.evaluate(({ app, BrowserWindow }) => {
      app.show();
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
  }
});

test("explicit Retry waits for original document retirement after engine exit", async ({
  candidate: c,
}) => {
  const originalDocument = await c.app.evaluate(({ BrowserWindow, dialog }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const frame = win.webContents.mainFrame;
    const send = frame.send.bind(frame);
    const pending = { args: null as any[] | null, released: false };
    (globalThis as any).__retirementFixture = {
      pending,
      release: () => {
        if (pending.released) return;
        pending.released = true;
        frame.send = send;
        if (pending.args) send(...pending.args);
      },
    };
    // Trusted controller holds only this exact document's retirement delivery.
    // The production two-second deadline and engine custody remain unchanged.
    frame.send = ((...args: any[]) => {
      if (args[0] === "nac:document" && args[1]?.kind === "retire") {
        pending.args = args;
        return;
      }
      send(...args);
    }) as typeof frame.send;
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    return win.webContents.id;
  });
  try {
    process.kill(c.enginePid, "SIGKILL");
    await expect
      .poll(
        () =>
          c.app.evaluate(({ app, BrowserWindow }) => {
            const main = process
              .getBuiltinModule("module")
              .createRequire(app.getAppPath() + "/package.json")(app.getAppPath());
            const held = !!(globalThis as any).__retirementFixture.pending.args;
            if (held && main.getState().enginePid === 0) {
              void main.retry();
              void main.retry();
              return {
                held,
                enginePid: main.getState().enginePid,
                windows: BrowserWindow.getAllWindows().map((win) => win.webContents.id),
              };
            }
            return null;
          }),
        { intervals: [10], timeout: 1500 },
      )
      .toEqual({ held: true, enginePid: 0, windows: [originalDocument] });
    const early = await state(c);
    expect(early.failure).not.toBeNull();
    // Let the unmodified adapter receive its held retirement request/ACK.
    await c.app.evaluate(() => (globalThis as any).__retirementFixture.release());
    await expect.poll(async () => c.app.windows().length).toBe(0);
    expect((await state(c)).enginePid).toBe(0);
    expect(c.provider.requests).toHaveLength(0);
    const successorWindow = c.app.waitForEvent("window");
    await retry(c);
    c.page = await successorWindow;
    await c.page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
    retainEngineCustody(c, (await state(c)).enginePid);
    expect(await c.app.windows()).toHaveLength(1);
    expect(c.provider.requests).toHaveLength(0);
  } finally {
    await c.app.evaluate(() => (globalThis as any).__retirementFixture.release()).catch(() => {});
    const current = await state(c).catch(() => null);
    if (
      current?.enginePid &&
      current.enginePid !== c.enginePid &&
      !c.ownedPids.includes(current.enginePid)
    ) {
      retainEngineCustody(c, current.enginePid);
    }
  }
});
