import { test, expect, root, type Candidate } from "./fixture";
import { _electron, type ElectronApplication } from "@playwright/test";
import { preparePackagedInspector } from "./packaged-inspector";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

async function stop(app: ElectronApplication) {
  const process = app.process();
  if (process.exitCode !== null || process.signalCode !== null) return;
  await app
    .evaluate(({ app, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      app.quit();
    })
    .catch(() => {});
  await expect
    .poll(() => process.exitCode !== null || process.signalCode !== null, { timeout: 30000 })
    .toBe(true);
}
async function launch(c: Candidate) {
  const packaged = process.env.NAC_ELECTRON_APP;
  const executablePath = packaged ? path.join(packaged, "Contents/MacOS/NAC") : undefined;
  const started = _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(packaged ? ["--inspect-brk=0"] : [path.join(root, "desktop/electron")]),
      "--directory",
      c.workspace,
      "--store-path",
      path.join(c.directory, "store.db"),
    ],
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
      HOME: path.join(c.directory, "home"),
      NAC_HOME: path.join(c.directory, "nac-home"),
      XDG_CONFIG_HOME: path.join(c.directory, "xdg"),
      TMPDIR: path.join(c.directory, "tmp"),
      NAC_E2E_API_KEY: "nac-e2e-dummy-only",
      NAC_ORCHESTRATION: "1",
      MODELS_DEV_URL: `${c.provider.baseUrl}/models-dev`,
      BROWSER: "none",
      NAC_ELECTRON_ENGINE: path.join(root, "target/release/nac-web"),
      NAC_ELECTRON_RESOURCES: path.join(root, "target/electron-resources"),
      NAC_ELECTRON_DATA_HOME: path.join(c.directory, "electron-data"),
    },
  });
  const [app] = await Promise.all([
    started,
    executablePath ? preparePackagedInspector(executablePath, c.workspace) : Promise.resolve(),
  ]);
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
  return { app, page };
}

test("cross-Quit/new-port text requires review and deliberate Restore; acknowledged clear stays cleared", async ({
  candidate: c,
}, info) => {
  const project = await c.project(),
    session = await c.session("direct", project);
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, session);
  c.provider.enqueue(
    "storage-visible-history",
    { token: "STORAGE_VISIBLE_HISTORY" },
    { kind: "text", text: "Storage fixture history is ready.", stream: true },
  );
  await c.page.getByRole("combobox", { name: "Message" }).fill("STORAGE_VISIBLE_HISTORY");
  await c.page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    c.page.getByText("Storage fixture history is ready.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await c.api(`/sessions/${session}`)).active_run == null)
    .toBe(true);
  const originalRequests = c.provider.requests.length;
  const text = "  Fixture draft 雪 — review before restoring\nDo not send automatically.  ";
  await c.page.getByRole("combobox", { name: "Message" }).fill(text);
  const profile = await c.app.evaluate(({ app }) => {
    const state = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState();
    return state.storage?.profile;
  });
  const home = await fs.realpath(path.join(c.directory, "home"));
  const checkpoint = profile
    ? path.join(
        home,
        "Library/Application Support/NAC/Presentation/dev",
        profile,
        "checkpoint.json",
      )
    : null;
  if (checkpoint)
    await expect
      .poll(async () =>
        (await fs.readFile(checkpoint, "utf8").catch(() => "")).includes("Fixture draft"),
      )
      .toBe(true);
  await stop(c.app);
  let successor: ElectronApplication | undefined;
  const successorPids: number[] = [];
  try {
    let next = await launch(c);
    successor = next.app;
    const current = await next.app.evaluate(({ app }) =>
      process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
        .getState(),
    );
    successorPids.push(current.enginePid);
    expect(new URL(next.page.url()).origin).not.toBe(c.endpoint);
    await next.page.evaluate((id) => {
      location.hash = `/session/${id}/files`;
    }, session);
    const composer = next.page.getByRole("combobox", { name: "Message" });
    await expect(composer).toBeVisible();
    await expect(next.page.getByRole("button", { name: "Model", exact: true })).toContainText(
      "GPT-5.6 Sol",
    );
    await expect(next.page.getByText("Loading session controls…", { exact: true })).toHaveCount(0);
    await expect(
      next.page.getByText("Storage fixture history is ready.", { exact: true }),
    ).toBeVisible();
    await expect(
      next.page.getByRole("status", { name: "Loading conversation", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        next.page
          .getByText("Storage fixture history is ready.", { exact: true })
          .evaluate((node) => {
            let opacity = 1;
            for (let parent: Element | null = node; parent; parent = parent.parentElement)
              opacity *= Number(getComputedStyle(parent).opacity);
            return opacity;
          }),
      )
      .toBe(1);
    const hidePanel = next.page.getByRole("button", { name: "Hide panel", exact: true });
    if (await hidePanel.isVisible()) await hidePanel.click();
    await next.page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    const beforeReview = info.outputPath("cross-launch-before-review.png");
    await next.page.screenshot({ path: beforeReview, scale: "css" });
    await info.attach("cross-launch-before-review", {
      path: beforeReview,
      contentType: "image/png",
    });
    await expect(composer).toHaveValue("");
    await expect(
      next.page.getByText(
        "Recovered text may be stale or already sent. Check the transcript before restoring it.",
        { exact: true },
      ),
    ).toBeVisible();
    await next.page.getByRole("button", { name: "Restore to composer", exact: true }).click();
    await expect(composer).toHaveValue(text);
    const afterRestore = info.outputPath("cross-launch-after-explicit-restore.png");
    await next.page.screenshot({ path: afterRestore, scale: "css" });
    await info.attach("cross-launch-after-explicit-restore", {
      path: afterRestore,
      contentType: "image/png",
    });
    expect(c.provider.requests).toHaveLength(originalRequests);
    await composer.fill("");
    if (checkpoint)
      await expect
        .poll(async () =>
          Object.values(JSON.parse(await fs.readFile(checkpoint, "utf8")).values.drafts).every(
            (raw: any) => {
              const saved = JSON.parse(raw);
              return saved.drafts.length === 0 && !saved.recoveries?.length;
            },
          ),
        )
        .toBe(true);
    await stop(next.app);
    successor = undefined;
    next = await launch(c);
    successor = next.app;
    successorPids.push(
      await next.app.evaluate(
        ({ app }) =>
          process
            .getBuiltinModule("module")
            .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
            .getState().enginePid,
      ),
    );
    await next.page.evaluate((id) => {
      location.hash = `/session/${id}/files`;
    }, session);
    await expect(next.page.getByRole("combobox", { name: "Message" })).toHaveValue("");
    await expect(
      next.page.getByRole("button", { name: "Restore to composer", exact: true }),
    ).toHaveCount(0);
    expect(c.provider.requests).toHaveLength(originalRequests);
  } finally {
    if (successor) await stop(successor);
    for (const pid of successorPids)
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
  }
});

test("Swift-compatible v1 fixture imports preference and review-only text after a clean ownership handoff", async ({
  candidate: c,
}) => {
  const session = await c.session();
  const binding = await c.app.evaluate(({ app }) => {
    const state = process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState();
    return { digest: state.storage.profile, receipt: state.receipt };
  });
  await stop(c.app);
  const profile = binding.digest;
  const identity = {
    owner: `desktop-${profile}`,
    profile,
    organization: "local",
    host: "local",
    store: profile,
    track: "dev",
  };
  const fields = ["owner", "profile", "organization", "host", "store", "track"] as const;
  const values = {
    preferences: { "nac.sidebar.open": "false" },
    drafts: {
      ["nac:prompt-drafts:v2:" + JSON.stringify(fields.map((key) => identity[key]))]:
        JSON.stringify({
          version: 2,
          binding: fields.map((key) => identity[key]),
          drafts: [[session, "Swift fixture import — never automatically sent"]],
        }),
    },
  };
  const checkpoint = path.join(
    await fs.realpath(path.join(c.directory, "home")),
    "Library/Application Support/NAC/Presentation/dev",
    profile,
    "checkpoint.json",
  );
  const original = JSON.stringify({ version: 1, profile, values });
  await fs.writeFile(checkpoint, original, { mode: 0o600 });
  const next = await launch(c);
  try {
    await next.page.evaluate((id) => {
      location.hash = `/session/${id}/files`;
    }, session);
    await expect(next.page.getByRole("combobox", { name: "Message" })).toHaveValue("");
    await expect(
      next.page.getByText("Swift fixture import — never automatically sent", { exact: true }),
    ).toBeVisible();
    await expect(
      next.page.getByRole("button", { name: "Restore to composer", exact: true }),
    ).toBeVisible();
    expect(c.provider.requests).toHaveLength(0);
    // Import alone is a read. Original source is untouched until a deliberate
    // presentation mutation receives its atomic revision acknowledgment.
    expect(await fs.readFile(checkpoint, "utf8")).toBe(original);
  } finally {
    await stop(next.app);
  }
});

test("native notification menu keeps opt-out and reset reachable while an exact storage ACK is delayed", async ({
  candidate: c,
}) => {
  const state = () =>
    c.app.evaluate(({ app }) =>
      process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
        .getState(),
    );
  await expect.poll(async () => (await state()).notifications.loaded).toBe(true);
  const helper = (await state()).storage.checkpointPid;
  expect(
    execFileSync("/bin/ps", ["-p", String(helper), "-o", "ppid=,comm="], {
      encoding: "utf8",
    }).trim(),
  ).toMatch(new RegExp(`^${c.app.process().pid}\\s+.*\\/checkpoint-helper$`));
  c.ownedPids.push(helper);
  process.kill(helper, "SIGSTOP");
  try {
    await c.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById("notifications-enable")!;
      item.click(item);
    });
    await expect.poll(async () => (await state()).storage.pending).toBeGreaterThan(0);
    expect(
      await c.app.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("notifications-enable")!.enabled,
      ),
    ).toBe(true);
    await c.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById("notifications-enable")!;
      item.click(item);
    });
    expect((await state()).notifications.enabled).toBe(false);
    expect(
      await c.app.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("notifications-reset")!.enabled,
      ),
    ).toBe(true);
    await c.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById("notifications-reset")!;
      item.click(item);
    });
    expect((await state()).notifications.enabled).toBe(false);
  } finally {
    process.kill(helper, "SIGCONT");
  }
  await expect.poll(async () => (await state()).storage.pending).toBe(0);
  await c.app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById("notifications-reset")!;
    item.click(item);
  });
  await expect.poll(async () => (await state()).notifications.saving).toBe(false);
  expect((await state()).notifications.enabled).toBe(false);
  expect(c.provider.requests).toHaveLength(0);
});
