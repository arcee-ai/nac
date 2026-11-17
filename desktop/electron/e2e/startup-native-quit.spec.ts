import { test, expect, root } from "./fixture";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

test("real startup Quit sheet preserves a verified engine across a long Cancel", async ({
  candidate: c,
}, info) => {
  test.skip(
    process.env.NAC_ELECTRON_NATIVE_READY_CUA !== "1",
    "Requires explicit real native Cancel on this private fixture",
  );
  test.setTimeout(180000);
  const evidence = path.join(c.directory, "startup-sheet.jsonl");
  await c.app.evaluate(({ dialog }) => {
    (globalThis as any).__realReadyDialog = dialog.showMessageBox.bind(dialog);
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  process.kill(c.enginePid, "SIGKILL");
  await expect.poll(async () => c.app.windows().length).toBe(0);
  console.log(
    "Private native startup Quit fixture",
    JSON.stringify({ pid: c.app.process().pid, directory: c.directory, evidence }),
  );
  await c.app.evaluate(({ app, dialog }, evidence) => {
    const require = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json");
    const fs = require("node:fs");
    const main = require(app.getAppPath());
    const { Engine } = require(app.getAppPath() + "/src/engine.cjs");
    const record = (event: string, details = {}) =>
      fs.appendFileSync(
        evidence,
        JSON.stringify({
          event,
          time: performance.now(),
          phase: main.getState().phase,
          ...details,
        }) + "\n",
      );
    const emit = Engine.prototype.emit;
    Engine.prototype.emit = function (kind: string, ...args: any[]) {
      if (kind === "ready") record("engine-ready");
      return emit.call(this, kind, ...args);
    };
    app.on("browser-window-created", () => record("window-created"));
    dialog.showMessageBox = (...args: any[]) => {
      const options = args[args.length - 1];
      if (options.type === "error") return Promise.resolve({ response: 0 });
      record("native-dialog-enter", {
        parentless: args[0] === undefined,
        version: process.versions.electron,
      });
      const result = (globalThis as any).__realReadyDialog(...args);
      record("native-api-return");
      return result.then((choice: any) => {
        record("native-choice", { response: choice.response });
        return choice;
      });
    };
    setImmediate(() => {
      void main.retry();
      setTimeout(() => record("timer"), 10);
      app.quit();
      record("quit-call-return");
    });
  }, evidence);
  const rows = async () =>
    (await fs.readFile(evidence, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const state = () =>
    c.app.evaluate(({ app }) =>
      process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
        .getState(),
    );
  await expect.poll(async () => (await state()).receipt).not.toBeNull();
  const ready = await state();
  const pid = ready.enginePid;
  const helper = Number(
    execFileSync("/bin/ps", ["-p", String(pid), "-o", "ppid="], { encoding: "utf8" }).trim(),
  );
  expect(
    execFileSync("/bin/ps", ["-p", String(helper), "-o", "ppid=,comm="], {
      encoding: "utf8",
    }).trim(),
  ).toMatch(new RegExp(`^${c.app.process().pid}\\s+.*\\/engine-launcher$`));
  c.ownedPids.push(pid, helper);
  expect(ready.phase).toBe("confirming");
  console.log(
    "Verified startup ready under native sheet; holding past unchanged30sdeadline",
    JSON.stringify({ pid, incarnation: ready.receipt.incarnation }),
  );
  await new Promise((resolve) => setTimeout(resolve, 35000));
  const held = await state();
  expect(held).toEqual(ready);
  const parent = await c.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      count: BrowserWindow.getAllWindows().length,
      url: win.webContents.getURL(),
      preload: win.webContents.getLastWebPreferences().preload,
    };
  });
  expect(parent.count).toBe(1);
  expect(parent.url).toMatch(/^data:text\/html/);
  expect(parent.preload).toBeFalsy();
  console.log("Native sheet held35s AFTER verifiedready; ordinary Cancel now", c.directory);
  const successor = c.app.waitForEvent("window", { timeout: 90000 });
  await expect
    .poll(async () => (await rows()).some((row) => row.event === "native-choice"), {
      timeout: 90000,
    })
    .toBe(true);
  c.page = await successor;
  await c.page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
  const after = await state();
  expect(after.enginePid).toBe(ready.enginePid);
  expect(after.receipt).toEqual(ready.receipt);
  expect(after.failure).toBeNull();
  const observed = await rows();
  console.log("Actual asynchronous startup-sheet timeline", JSON.stringify(observed));
  const entered = observed.findIndex((row) => row.event === "native-dialog-enter");
  const returned = observed.findIndex((row) => row.event === "native-api-return");
  expect(observed[entered]).toMatchObject({
    parentless: false,
    phase: "confirming",
    version: "45.3.2",
  });
  expect(observed.find((row) => row.event === "native-choice").response).toBe(0);
  const choice = observed.findIndex((row) => row.event === "native-choice");
  const readyEvent = observed.find((row) => row.event === "engine-ready");
  expect(returned).toBeLessThan(choice);
  expect(readyEvent.phase).toBe("confirming");
  expect(observed[choice].time - readyEvent.time).toBeGreaterThan(35000);
  expect(observed.slice(entered + 1, choice).some((row) => row.event === "timer")).toBe(true);
  expect(observed.slice(entered + 1, choice).some((row) => row.event === "window-created")).toBe(
    false,
  );
  expect(await c.app.windows()).toHaveLength(1);
  expect(c.provider.requests).toHaveLength(0);
  await fs.writeFile(
    info.outputPath("actual-startup-sheet.json"),
    JSON.stringify(
      {
        case: "verified startup remains behind native Quit sheet past30s; Cancel preserves same owned engine",
        baseRevision: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        mainSha256: createHash("sha256")
          .update(await fs.readFile(path.join(root, "desktop/electron/src/main.cjs")))
          .digest("hex"),
        electron: "45.3.2",
        enginePid: ready.enginePid,
        custodyPid: helper,
        receiptBefore: ready.receipt,
        receiptAfter: after.receipt,
        verifiedReadyHoldMs: observed[choice].time - readyEvent.time,
        timeline: observed,
      },
      null,
      2,
    ),
  );
  console.log(
    "Native Cancel outcome verified; waiting for controller cleanup release",
    c.directory,
  );
  await expect
    .poll(
      () =>
        fs.access(path.join(c.directory, "allow-cleanup")).then(
          () => true,
          () => false,
        ),
      { timeout: 90000 },
    )
    .toBe(true);
});
