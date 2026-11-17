import { _electron } from "@playwright/test";
import { test, expect, root } from "./fixture";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("installed Electron validates options after an absent message-box parent", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nac-dialog-arity-"));
  const entry = path.join(directory, "entry.cjs");
  await fs.writeFile(
    entry,
    `const { app } = require("electron");
app.setPath("userData", ${JSON.stringify(directory)});
app.setPath("sessionData", ${JSON.stringify(directory)});
app.on("window-all-closed", () => {});
`,
  );
  const app = await _electron.launch({
    args: [entry],
    env: { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory },
  });
  try {
    const result = await app.evaluate(({ BrowserWindow, dialog }) => {
      const errors = [];
      for (const parent of [undefined, null]) {
        try {
          // Invalid recognized options must fail in the real installed API
          // before opening native UI. Dropped options would miss this check.
          dialog.showMessageBox(parent as any, {
            type: "invalid-quit-fixture-type" as any,
            message: "Quit NAC?",
            buttons: ["Cancel", "Stop and Quit"],
          });
          errors.push(null);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      return {
        errors,
        windows: BrowserWindow.getAllWindows().length,
        version: process.versions.electron,
      };
    });
    expect(result.windows).toBe(0);
    expect(result.errors).toEqual(["Invalid message box type", "Invalid message box type"]);
    console.log("Installed windowless dialog validation", JSON.stringify(result));
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true });
  }
});

test("windowless startup failure preserves real native Quit options and Cancel/Stop", async ({}, info) => {
  test.skip(
    process.env.NAC_ELECTRON_NATIVE_QUIT_CUA !== "1",
    "Requires explicit native Cancel/Stop clicks on this private no-engine fixture",
  );
  test.setTimeout(180000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nac-windowless-quit-"));
  for (const folder of ["home", "nac-home", "xdg", "tmp"])
    await fs.mkdir(path.join(directory, folder));
  const entry = path.join(directory, "entry.cjs");
  const evidence = path.join(directory, "native.json");
  await fs.writeFile(
    entry,
    `const { dialog } = require("electron");
const actual = dialog.showMessageBox.bind(dialog);
const fs = require("node:fs");
const evidence = ${JSON.stringify(evidence)};
const fixture = globalThis.__windowlessQuit = { calls: [], results: [] };
const record = () => fs.writeFileSync(evidence, JSON.stringify({ calls: fixture.calls, results: fixture.results }));
dialog.showMessageBox = (...args) => {
  const options = args[args.length - 1];
  if (options.type === "error") return Promise.resolve({ response: 0 });
  fixture.calls.push({ arity: args.length, firstUndefined: args[0] === undefined,
    message: options.message, buttons: options.buttons, cancelId: options.cancelId,
    phase: fixture.main.getState().phase, version: process.versions.electron });
  record();
  // This native parentless Mac modal must be dismissed through its real UI.
  return actual(...args).then(result => { fixture.results.push(result); record(); return result; });
};
fixture.main = require(${JSON.stringify(path.join(root, "desktop/electron/src/main.cjs"))});
`,
  );
  const app = await _electron.launch({
    args: [entry, "--invalid-windowless-fixture-option"],
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: path.join(directory, "home"),
      NAC_HOME: path.join(directory, "nac-home"),
      XDG_CONFIG_HOME: path.join(directory, "xdg"),
      TMPDIR: path.join(directory, "tmp"),
      NAC_ELECTRON_DATA_HOME: path.join(directory, "electron-data"),
    },
  });
  const parent = app.process();
  const state = () => app.evaluate(() => (globalThis as any).__windowlessQuit.main.getState());
  try {
    await expect.poll(async () => (await state()).failure).toContain("Use --directory");
    expect((await state()).enginePid).toBe(0);
    expect(await app.windows()).toHaveLength(0);
    console.log(
      "Private native Quit fixture",
      JSON.stringify({ pid: parent.pid, entry, evidence }),
    );
    await app.evaluate(({ app }) => {
      setImmediate(() => app.quit());
    });
    await expect
      .poll(
        async () =>
          JSON.parse(await fs.readFile(evidence, "utf8").catch(() => '{"results":[]}')).results
            .length,
        { timeout: 90000 },
      )
      .toBe(1);
    const cancelled = JSON.parse(await fs.readFile(evidence, "utf8"));
    expect(cancelled.calls[0]).toMatchObject({
      message: "Quit NAC?",
      buttons: ["Cancel", "Stop and Quit"],
      cancelId: 0,
      phase: "confirming",
    });
    expect(cancelled.results[0].response).toBe(0);
    expect((await state()).phase).toBe("running");
    expect((await state()).enginePid).toBe(0);
    expect(await app.windows()).toHaveLength(0);
    expect(parent.exitCode).toBeNull();
    console.log("Native Cancel preserved the windowless application; select Stop and Quit next");
    await app.evaluate(({ app }) => {
      setImmediate(() => app.quit());
    });
    await expect.poll(() => parent.exitCode, { timeout: 90000 }).toBe(0);
    const accepted = JSON.parse(await fs.readFile(evidence, "utf8"));
    expect(accepted.calls).toHaveLength(2);
    expect(accepted.results.map((result: any) => result.response)).toEqual([0, 1]);
    await fs.writeFile(
      info.outputPath("actual-windowless-native-quit.json"),
      JSON.stringify(accepted, null, 2),
    );
    await info.attach("actual-windowless-native-quit", {
      body: JSON.stringify(accepted, null, 2),
      contentType: "application/json",
    });
    console.log("Real windowless native Quit", JSON.stringify(accepted));
  } finally {
    if (parent.exitCode === null && parent.signalCode === null)
      throw new Error(
        `Exact no-engine native fixture still needs its ordinary Quit choice: ${parent.pid}`,
      );
    await fs.rm(directory, { recursive: true });
  }
});
