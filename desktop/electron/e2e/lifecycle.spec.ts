import { test, expect, root, type Candidate } from "./fixture";
import fs from "node:fs";
import path from "node:path";
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
    c.ownedPids.push(restarted.enginePid);
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
