import { _electron } from "@playwright/test";
import { test, expect, root } from "./fixture";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function gone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

test("startup without custody settlement keeps a visible protected cleanup status", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nac-electron-cleanup-"));
  const resources = path.join(directory, "resources");
  await fs.mkdir(resources);
  for (const folder of ["home", "nac-home", "xdg", "workspace", "tmp"])
    await fs.mkdir(path.join(directory, folder));
  for (const file of ["manifest.json", "engine-identity.json", "checkpoint-helper"])
    await fs.copyFile(
      path.join(root, "target/electron-resources", file),
      path.join(resources, file),
    );
  const helper = path.join(resources, "engine-launcher");
  // This exact fault helper never executes argv or spawns Rust/descendants.
  // Its exit deliberately supplies no settlement receipt.
  await fs.writeFile(
    helper,
    '#!/bin/sh\nprintf \'%s\\n\' "$$" > "$NAC_FAULT_HELPER_PID"\nexit 0\n',
    { mode: 0o700 },
  );
  const helperPidFile = path.join(directory, "helper.pid");
  const app = await _electron.launch({
    args: [
      path.join(root, "desktop/electron"),
      "--directory",
      path.join(directory, "workspace"),
      "--store-path",
      path.join(directory, "store.db"),
    ],
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: path.join(directory, "home"),
      NAC_HOME: path.join(directory, "nac-home"),
      XDG_CONFIG_HOME: path.join(directory, "xdg"),
      TMPDIR: path.join(directory, "tmp"),
      NAC_ELECTRON_ENGINE: path.join(root, "target/release/nac-web"),
      NAC_ELECTRON_RESOURCES: resources,
      NAC_ELECTRON_DATA_HOME: path.join(directory, "electron-data"),
      NAC_FAULT_HELPER_PID: helperPidFile,
    },
  });
  const parent = app.process();
  let helperPid = 0;
  const state = () =>
    app.evaluate(({ app }) =>
      process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
        .getState(),
    );
  try {
    await expect.poll(() => fs.readFile(helperPidFile, "utf8").catch(() => "")).toMatch(/^\d+\n$/);
    helperPid = Number(await fs.readFile(helperPidFile, "utf8"));
    await expect.poll(() => gone(helperPid)).toBe(true);
    await expect.poll(async () => !!(await state()).failure).toBe(true);
    const page = await app.firstWindow({ timeout: 3000 });
    await expect(page.getByText(/Waiting for the owned engine to finish cleanup/)).toBeVisible();
    const document = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id,
    );
    const preferences = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    expect(preferences.sandbox).toBe(true);
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.preload).toBeFalsy();
    expect(await page.evaluate(() => typeof (window as any).__nacDesktop)).toBe("undefined");
    expect(await page.evaluate(() => typeof (window as any).require)).toBe("undefined");
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
      ),
    ).toBe(true);
    const statusOrigin = page.url();
    await page.evaluate(() => {
      window.open("https://example.invalid/unrequested");
      location.href = "https://example.invalid/unsafe-navigation";
    });
    await app.evaluate(() => new Promise((resolve) => setImmediate(resolve)));
    expect(page.url()).toBe(statusOrigin);
    expect(await app.windows()).toHaveLength(1);
    expect(
      await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content"),
    ).toContain("default-src 'none'");
    await app.evaluate(({ app, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      app.quit();
    });
    await expect.poll(async () => (await state()).phase).toBe("running");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
      .toBe(false);
    await app.evaluate(({ app }) => app.emit("activate"));
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
      .toBe(true);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id),
    ).toBe(document);
    await app.evaluate(({ app }) => {
      void process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
        .retry();
    });
    expect((await state()).enginePid).toBe(0);
    expect(await app.windows()).toHaveLength(1);
    await app.evaluate(({ app, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      app.quit();
    });
    await expect
      .poll(async () => (await state()).phase, { timeout: 29000 })
      .toBe("pending-cleanup");
    await expect(page.getByText(/still waiting for the original engine cleanup/)).toBeVisible();
    expect(parent.exitCode).toBeNull();
    expect(parent.signalCode).toBeNull();
    expect((await state()).enginePid).toBe(0);
    expect(await fs.readFile(helperPidFile, "utf8")).toBe(`${helperPid}\n`);
  } finally {
    // This fault fixture never spawned a Rust leader. Before killing only our
    // retained Electron parent, independently reject any unexpected Rust child.
    const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter(Boolean)
      .map((m) => ({ pid: Number(m![1]), ppid: Number(m![2]), command: m![3] }));
    const descendants = new Set([parent.pid!]);
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows)
        if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
          descendants.add(row.pid);
          changed = true;
        }
    }
    expect(
      rows.filter(
        (row) => descendants.has(row.pid) && /\/(nac-web|engine-launcher)$/.test(row.command),
      ),
    ).toEqual([]);
    if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
    await expect.poll(() => parent.exitCode !== null || parent.signalCode !== null).toBe(true);
    if (helperPid) await expect.poll(() => gone(helperPid)).toBe(true);
    await fs.rm(directory, { recursive: true });
  }
});
