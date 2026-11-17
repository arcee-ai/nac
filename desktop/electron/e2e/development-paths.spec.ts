import { test, expect, root } from "./fixture";
import { execFileSync } from "node:child_process";
import path from "node:path";

test.skip(!!process.env.NAC_ELECTRON_APP, "Development defaults apply only to the unpackaged app");
test.use({ developmentPathOverrides: false });

test("normal prepared development launch opens the workspace and owns its cancellable native helper without path overrides", async ({
  candidate: c,
}) => {
  expect(
    await c.app.evaluate(() => ({
      engine: process.env.NAC_ELECTRON_ENGINE,
      resources: process.env.NAC_ELECTRON_RESOURCES,
    })),
  ).toEqual({ engine: undefined, resources: undefined });
  const engineCommand = execFileSync("/bin/ps", ["-p", String(c.enginePid), "-o", "comm="], {
    encoding: "utf8",
  }).trim();
  expect(engineCommand).toBe(path.join(root, "target/release/nac-web"));
  const helperPath = path.join(
    root,
    "target/electron-resources/NAC Folder Picker.app/Contents/MacOS/native-folder-picker",
  );
  const helpers = () =>
    execFileSync("/bin/ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter(
        (parts) =>
          Number(parts[1]) === c.app.process().pid && parts.slice(2).join(" ") === helperPath,
      )
      .map((parts) => Number(parts[0]));
  await c.app.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    app.show();
    app.dock?.show();
    window.show();
    window.focus();
    app.focus({ steal: true });
  });
  await expect.poll(() => c.page.evaluate(() => document.hasFocus())).toBe(true);
  await c.page.evaluate((initial) => {
    const controller = new AbortController();
    const state = { controller, settled: false, selected: undefined as string | null | undefined };
    (window as any).__defaultPathPicker = state;
    void (window as any).__nacLocalPaths
      .chooseDirectory(initial, controller.signal)
      .then((selected: string | null) => {
        state.selected = selected;
        state.settled = true;
      });
  }, c.workspace);
  await expect.poll(helpers).toHaveLength(1);
  c.ownedPids.push(...helpers());
  await c.page.evaluate(() => (window as any).__defaultPathPicker.controller.abort());
  await expect
    .poll(() => c.page.evaluate(() => (window as any).__defaultPathPicker.settled))
    .toBe(true);
  expect(await c.page.evaluate(() => (window as any).__defaultPathPicker.selected)).toBeNull();
  await expect.poll(helpers).toHaveLength(0);
  await expect(c.page.getByText("No projects yet", { exact: true })).toBeVisible();
});
