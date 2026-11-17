import { test, expect, type Candidate } from "./fixture";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const state = (c: Candidate) =>
  c.app.evaluate(({ app }) =>
    process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState(),
  );
function retain(c: Candidate, pid: number) {
  const helper = Number(
    execFileSync("/bin/ps", ["-p", String(pid), "-o", "ppid="], { encoding: "utf8" }).trim(),
  );
  expect(
    execFileSync("/bin/ps", ["-p", String(helper), "-o", "ppid=,comm="], {
      encoding: "utf8",
    }).trim(),
  ).toMatch(new RegExp(`^${c.app.process().pid}\\s+.*\\/engine-launcher$`));
  c.ownedPids.push(pid, helper);
}
async function pendingStartup(c: Candidate) {
  await c.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  process.kill(c.enginePid, "SIGKILL");
  await expect.poll(async () => c.app.windows().length).toBe(0);
  const evidence = path.join(c.directory, "startup-quit.json");
  await c.app.evaluate(({ app, dialog }, evidence) => {
    const require = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    const fs = require("node:fs");
    const main = require(app.getAppPath());
    const { Engine } = require(app.getAppPath() + "/src/engine.cjs");
    const pending = {
      questions: 0,
      errors: 0,
      parent: 0,
      windows: [] as number[],
      resolve: null as any,
      lateReady: null as any,
    };
    (globalThis as any).__startupQuit = pending;
    const record = () =>
      fs.writeFileSync(
        evidence,
        JSON.stringify({ questions: pending.questions, windows: pending.windows }),
      );
    app.on("browser-window-created", (_event, win) => {
      pending.windows.push(win.id);
      record();
    });
    dialog.showMessageBox = (...args: any[]) => {
      const options = args[args.length - 1];
      if (options.type === "error") {
        pending.errors++;
        return Promise.resolve({ response: 0 });
      }
      pending.questions++;
      pending.parent = args[0]?.id ?? 0;
      record();
      return new Promise((resolve) => {
        pending.resolve = resolve;
      });
    };
    const emit = Engine.prototype.emit;
    Engine.prototype.emit = function (kind: string, ...args: any[]) {
      if (kind === "ready") {
        const listener = this.listeners("ready")[0];
        pending.lateReady = () => listener(...args);
      }
      return emit.call(this, kind, ...args);
    };
    void main.retry();
    app.quit();
    app.quit();
    app.quit();
  }, evidence);
  await expect.poll(async () => (await state(c)).receipt).not.toBeNull();
  const ready = await state(c);
  retain(c, ready.enginePid);
  expect(ready.phase).toBe("confirming");
  await expect
    .poll(() =>
      c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL()),
    )
    .toMatch(/^data:text\/html/);
  const owner = await c.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      id: win.id,
      url: win.webContents.getURL(),
      preload: win.webContents.getLastWebPreferences().preload,
      count: BrowserWindow.getAllWindows().length,
      parent: (globalThis as any).__startupQuit.parent,
      questions: (globalThis as any).__startupQuit.questions,
    };
  });
  expect(owner).toMatchObject({ count: 1, parent: owner.id, questions: 1 });
  expect(owner.url).toMatch(/^data:text\/html/);
  expect(owner.preload).toBeFalsy();
  return { ready, owner, evidence };
}
async function answer(c: Candidate, response: number) {
  await c.app.evaluate((_electron, response) => {
    const pending = (globalThis as any).__startupQuit;
    pending.resolve({ response });
    if (response === 1)
      queueMicrotask(() => {
        pending.lateReady();
      });
  }, response);
}

test.afterEach(async ({ candidate: c }) => {
  // A failed assertion must release this fixture's already pending choice;
  // replacing dialog.showMessageBox alone cannot resolve the original Promise.
  await c.app
    .evaluate(() => (globalThis as any).__startupQuit?.resolve?.({ response: 1 }))
    .catch(() => {});
});

for (const response of [0, 1]) {
  test(`ready startup waits behind one Quit owner until ${response ? "Stop" : "Cancel"}`, async ({
    candidate: c,
  }) => {
    const parent = c.app.process();
    const { ready, owner, evidence } = await pendingStartup(c);
    if (response) {
      await answer(c, 1);
      await expect.poll(() => parent.exitCode).toBe(0);
      expect(JSON.parse(await fs.readFile(evidence, "utf8"))).toEqual({
        questions: 1,
        windows: [owner.id],
      });
    } else {
      const workspace = c.app.waitForEvent("window");
      await answer(c, 0);
      c.page = await workspace;
      await c.page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
      await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
      const after = await state(c);
      expect(after.enginePid).toBe(ready.enginePid);
      expect(after.receipt).toEqual(ready.receipt);
      expect(await c.app.windows()).toHaveLength(1);
      expect(JSON.parse(await fs.readFile(evidence, "utf8"))).toEqual({
        questions: 1,
        windows: [
          owner.id,
          await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id),
        ],
      });
    }
    expect(c.provider.requests).toHaveLength(0);
  });

  test(`startup failure retains the Quit status owner until ${response ? "Stop" : "Cancel"}`, async ({
    candidate: c,
  }) => {
    const parent = c.app.process();
    const { ready, owner } = await pendingStartup(c);
    process.kill(ready.enginePid, "SIGKILL");
    await expect.poll(async () => (await state(c)).enginePid).toBe(0);
    expect((await state(c)).phase).toBe("confirming");
    expect(
      await c.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((win) => win.id),
      ),
    ).toEqual([owner.id]);
    await answer(c, response);
    if (response) {
      await expect.poll(() => parent.exitCode).toBe(0);
    } else {
      await expect.poll(async () => c.app.windows().length).toBe(0);
      expect((await state(c)).failure).not.toBeNull();
      expect(await c.app.evaluate(() => (globalThis as any).__startupQuit.errors)).toBe(1);
      const workspace = c.app.waitForEvent("window");
      await c.app.evaluate(({ app }) => {
        void process
          .getBuiltinModule("module")
          .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
          .retry();
      });
      c.page = await workspace;
      await c.page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
      await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
      const successor = await state(c);
      retain(c, successor.enginePid);
      expect(successor.enginePid).not.toBe(ready.enginePid);
      expect(successor.receipt.incarnation).not.toBe(ready.receipt.incarnation);
      expect(successor.receipt.store).toBe(ready.receipt.store);
    }
    expect(c.provider.requests).toHaveLength(0);
  });
}
