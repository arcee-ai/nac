import { test, expect, root, type Candidate } from "./fixture";
import { _electron, type ElectronApplication } from "@playwright/test";
import { preparePackagedInspector } from "./packaged-inspector";
import { ScriptGate } from "../../../crates/nac-server/web/e2e/scripted-provider";
import fs from "node:fs/promises";
import path from "node:path";

async function state(c: Candidate) {
  return c.app.evaluate(({ app }) =>
    process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState(),
  );
}

async function menu(c: Candidate, id: string, checked?: boolean) {
  await c.app.evaluate(
    ({ Menu }, { id, checked }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item?.enabled) throw new Error(`Native menu unavailable: ${id}`);
      if (checked !== undefined && item.checked === checked) return;
      item.click(item);
    },
    { id, checked },
  );
}

async function checkpoint(c: Candidate) {
  const current = await state(c);
  return JSON.parse(
    await fs.readFile(
      path.join(
        c.directory,
        "home",
        "Library",
        "Application Support",
        "NAC",
        "Presentation",
        current.receipt.identity.track,
        current.storage.profile,
        "checkpoint.json",
      ),
      "utf8",
    ),
  );
}

async function nativeSubmissions(c: Candidate) {
  return c.app.evaluate(
    () => (globalThis as any).__notificationProbe.submissions,
  );
}

async function closeWorkspace(c: Candidate) {
  const document = await c.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const id = window.webContents.id;
    window.close();
    return id;
  });
  await expect
    .poll(() =>
      c.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(false);
  expect(
    await c.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id,
    ),
  ).toBe(document);
  return document;
}

async function installNativeDouble(app: ElectronApplication) {
  // Native-only deterministic double installed by the trusted controller.
  // Real Notification instances, MAIN coordinator, preload, Rust and shared
  // React navigation remain in use; no OS banner or permission claim is made.
  await app.evaluate(({ Notification, ipcMain, app, BrowserWindow }) => {
    const probe = {
      submissions: [] as { id: string; title: string; body: string }[],
      handles: new Map<string, any>(),
      closed: [] as string[],
      targetAcks: [] as { request: number; outcome: string }[],
      trace: [] as Record<string, unknown>[],
      traceOverflow: false,
    };
    (globalThis as any).__notificationProbe = probe;
    const facts = () => {
      const window = BrowserWindow.getAllWindows()[0];
      return {
        visible: window?.isVisible(),
        focused: window?.isFocused(),
        minimized: window?.isMinimized(),
        appHidden: app.isHidden(),
      };
    };
    const record = (kind: string, values: Record<string, unknown> = {}) => {
      if (probe.trace.length >= 64) {
        probe.traceOverflow = true;
        return;
      }
      probe.trace.push({
        order: probe.trace.length,
        kind,
        ...facts(),
        ...values,
      });
    };
    ipcMain.on("nac:native", (_event, value) => {
      if (value?.kind === "target_settled")
        probe.targetAcks.push({
          request: value.request,
          outcome: value.outcome,
        });
      if (
        [
          "ui_ready",
          "ui_retired",
          "session_target_ready",
          "session_target_retired",
          "target_settled",
        ].includes(value?.kind)
      )
        record(value.kind, {
          request: value.request,
          generation: value.generation,
          outcome: value.outcome,
        });
    });
    Notification.isSupported = () => true;
    Notification.getHistory = async () => [];
    Notification.remove = () => {};
    Notification.removeGroup = () => {};
    Notification.prototype.show = function () {
      probe.handles.set(this.id, this);
      probe.submissions.push({
        id: this.id,
        title: this.title,
        body: this.body,
      });
      record("native-show", { index: probe.submissions.length - 1 });
      this.prependListener("click", () =>
        record("native-click", {
          index: probe.submissions.findIndex((value) => value.id === this.id),
          previouslyClosed: probe.closed.includes(this.id),
        }),
      );
      this.emit("show");
    };
    Notification.prototype.close = function () {
      probe.closed.push(this.id);
      record("native-close", {
        index: probe.submissions.findIndex((value) => value.id === this.id),
      });
      this.emit("close");
    };
  });
}

async function clickTarget(c: Candidate, index: number, session: string) {
  await c.app.evaluate((_electron, index) => {
    const probe = (globalThis as any).__notificationProbe;
    probe.handles.get(probe.submissions[index].id).emit("click");
  }, index);
  try {
    await expect
      .poll(() => c.page.evaluate(() => location.hash))
      .toContain(`/session/${session}`);
  } catch (error) {
    console.log(
      "Notification target diagnostic",
      JSON.stringify(
        await c.app.evaluate((_electron, index) => {
          const probe = (globalThis as any).__notificationProbe;
          return {
            index,
            acknowledgments: probe.targetAcks,
            previouslyClosed: probe.closed.includes(
              probe.submissions[index].id,
            ),
            trace: probe.trace,
            traceOverflow: probe.traceOverflow,
          };
        }, index),
      ),
    );
    throw error;
  }
}

async function stop(app: ElectronApplication) {
  const owned = app.process();
  if (owned.exitCode !== null || owned.signalCode !== null) return;
  await app
    .evaluate(({ app, dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
      app.quit();
    })
    .catch(() => {});
  await expect
    .poll(() => owned.exitCode !== null || owned.signalCode !== null, {
      timeout: 30000,
    })
    .toBe(true);
}

async function relaunch(c: Candidate) {
  const packaged = process.env.NAC_ELECTRON_APP;
  const executablePath = packaged
    ? path.join(packaged, "Contents/MacOS/NAC")
    : undefined;
  const started = _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(packaged
        ? ["--inspect-brk=0"]
        : [path.join(root, "desktop/electron")]),
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
    executablePath
      ? preparePackagedInspector(executablePath, c.workspace)
      : Promise.resolve(),
  ]);
  await installNativeDouble(app);
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
  return { app, page };
}

test("main semantic observer stays off by default and delivers bounded hidden completion/decision navigation without replay", async ({
  candidate: c,
}) => {
  await installNativeDouble(c.app);
  await expect
    .poll(async () => (await state(c)).notifications?.loaded)
    .toBe(true);
  let notifications = (await state(c)).notifications;
  expect(notifications.enabled).toBe(false);
  expect(notifications.observer?.tasks ?? 0).toBe(0);
  expect(notifications.observer?.retries ?? 0).toBe(0);
  expect(await nativeSubmissions(c)).toEqual([]);

  await menu(c, "notifications-enable", true);
  await expect
    .poll(async () => {
      const value = (await state(c)).notifications;
      return (
        value.enabled && !value.saving && value.observer?.projectionAvailable
      );
    })
    .toBe(true);
  const saved = (await checkpoint(c)).native.notifications;
  expect(saved.enabled).toBe(true);
  expect(saved.cutoff).toMatch(/^[0-9a-f-]{36}:\d+$/);
  expect(saved.frontier).toBe(saved.cutoff);
  expect(saved.receipts).toEqual([]);
  expect(await nativeSubmissions(c)).toEqual([]);

  const completedSession = await c.session();
  const decisionSession = await c.session();
  const identity = await state(c);
  const document = await closeWorkspace(c);
  expect(
    await c.app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const prefs = contents.getLastWebPreferences();
      return {
        sandbox: prefs.sandbox,
        isolation: prefs.contextIsolation,
        node: prefs.nodeIntegration,
        throttling: contents.getBackgroundThrottling(),
      };
    }),
  ).toEqual({ sandbox: true, isolation: true, node: false, throttling: true });

  const completionGate = new ScriptGate();
  c.provider.enqueue(
    "notification-completed",
    { token: "NOTIFICATION_COMPLETION" },
    {
      kind: "text",
      text: "Private notification completion fixture.",
      stream: "request",
    },
    completionGate,
  );
  await c.api(`/sessions/${completedSession}/runs`, {
    prompt: "NOTIFICATION_COMPLETION",
  });
  await completionGate.accepted;
  completionGate.release();
  await expect
    .poll(
      async () =>
        (await c.api(`/sessions/${completedSession}`)).active_run == null,
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await nativeSubmissions(c)).map((value: any) => value.title),
    )
    .toEqual(["Request completed"]);
  await expect
    .poll(async () => (await state(c)).notifications.unreadCompletions)
    .toBe(1);
  await expect
    .poll(
      async () => (await checkpoint(c)).native.notifications.receipts.length,
    )
    .toBe(0);
  expect((await checkpoint(c)).native.notifications.frontier).not.toBe(
    saved.frontier,
  );
  expect((await state(c)).enginePid).toBe(identity.enginePid);
  expect((await state(c)).receipt.incarnation).toBe(
    identity.receipt.incarnation,
  );

  // A single native callback routes only its retained session. It cannot
  // submit another prompt, answer a question or create a remembered grant.
  await clickTarget(c, 0, completedSession);
  await expect
    .poll(() =>
      c.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(true);
  expect(
    await c.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id,
    ),
  ).toBe(document);
  expect(c.provider.requests).toHaveLength(1);

  await closeWorkspace(c);
  // Exercise ordinary application Hide as well as a closed workspace. The
  // original click must handle native focus ordering; do not pre-focus it.
  await c.app.evaluate(({ app }) => app.hide());
  await expect
    .poll(() => c.app.evaluate(({ app }) => app.isHidden()))
    .toBe(true);
  c.provider.enqueue(
    "notification-question",
    { token: "NOTIFICATION_DECISION" },
    {
      kind: "function_call",
      name: "request_question",
      callId: "notification-question",
      stream: "request",
      arguments: {
        request_id: "notification-choice",
        text: "Private notification decision fixture",
        choices: ["JSON", "CSV"],
        responder_class: "human_decision",
      },
    },
  );
  await c.api(`/sessions/${decisionSession}/runs`, {
    prompt: "NOTIFICATION_DECISION",
  });
  await expect
    .poll(
      async () =>
        (await c.api(`/sessions/${decisionSession}/questions`))[0]?.status,
    )
    .toBe("pending");
  await expect
    .poll(async () =>
      (await nativeSubmissions(c)).map((value: any) => value.title),
    )
    .toEqual(["Request completed", "Decision needed"]);
  await clickTarget(c, 1, decisionSession);
  expect(
    (await c.api(`/sessions/${decisionSession}/questions`))[0].status,
  ).toBe("pending");
  const permissions = await c.api(`/sessions/${decisionSession}/permissions`);
  expect(permissions.grants).toHaveLength(0);
  expect(c.provider.requests).toHaveLength(2);
  expect((await state(c)).notifications.observer.tasks).toBe(1);
  expect((await state(c)).notifications.observer.retries).toBe(0);

  const lateSession = await c.session();
  const lateGate = new ScriptGate();
  c.provider.enqueue(
    "notification-late-off",
    { token: "NOTIFICATION_AFTER_OFF" },
    {
      kind: "text",
      text: "Private completion after opt-out.",
      stream: "request",
    },
    lateGate,
  );
  await closeWorkspace(c);
  await c.api(`/sessions/${lateSession}/runs`, {
    prompt: "NOTIFICATION_AFTER_OFF",
  });
  await lateGate.accepted;
  await menu(c, "notifications-enable", false);
  await expect
    .poll(async () => {
      const value = (await state(c)).notifications;
      return !value.enabled && !value.saving && value.observer.tasks === 0;
    })
    .toBe(true);
  expect((await checkpoint(c)).native.notifications.enabled).toBe(false);
  lateGate.release();
  await expect
    .poll(
      async () => (await c.api(`/sessions/${lateSession}`)).active_run == null,
    )
    .toBe(true);
  await c.app.evaluate(({ app }) => app.emit("activate"));
  await expect
    .poll(() =>
      c.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(true);
  await c.page.evaluate(() => {
    location.hash = "/";
  });
  await expect.poll(() => c.page.evaluate(() => location.hash)).toBe("#/");
  await c.app.evaluate(() => {
    const probe = (globalThis as any).__notificationProbe;
    for (const handle of probe.handles.values()) {
      handle.emit("show");
      handle.emit("click");
    }
  });
  await menu(c, "notifications-reset");
  await expect
    .poll(async () => (await state(c)).notifications.saving)
    .toBe(false);
  expect((await checkpoint(c)).native?.notifications ?? null).toBeNull();
  expect((await state(c)).notifications.unreadCompletions).toBe(0);
  expect(await c.page.evaluate(() => location.hash)).toBe("#/");
  expect(
    (await c.api(`/sessions/${decisionSession}/questions`))[0].status,
  ).toBe("pending");
  expect(await nativeSubmissions(c)).toHaveLength(2);
  c.provider.assertConsumed();
});

test("persisted opt-in/frontier survives a cold app/new-port restart and retired document clicks stay stale", async ({
  candidate: c,
}) => {
  await installNativeDouble(c.app);
  await expect
    .poll(async () => (await state(c)).notifications?.loaded)
    .toBe(true);
  await menu(c, "notifications-enable", true);
  await expect
    .poll(
      async () => (await state(c)).notifications.observer?.projectionAvailable,
    )
    .toBe(true);
  const session = await c.session();
  await closeWorkspace(c);
  c.provider.enqueue(
    "notification-restart",
    { token: "NOTIFICATION_RESTART" },
    {
      kind: "text",
      text: "Private persisted notification fixture.",
      stream: "request",
    },
  );
  await c.api(`/sessions/${session}/runs`, { prompt: "NOTIFICATION_RESTART" });
  await expect
    .poll(async () =>
      (await nativeSubmissions(c)).map((value: any) => value.title),
    )
    .toEqual(["Request completed"]);
  await expect
    .poll(
      async () => (await checkpoint(c)).native.notifications.receipts.length,
    )
    .toBe(0);
  const saved = (await checkpoint(c)).native.notifications;
  expect(saved.unreadCompletions).toBe(1);
  const original = await state(c),
    document = c.page;

  await menu(c, "workspace-reload");
  await expect.poll(() => document.isClosed()).toBe(true);
  await expect
    .poll(
      async () =>
        (await c.app.windows()).filter(
          (page) => !page.isClosed() && page.url().startsWith(c.endpoint),
        ).length,
    )
    .toBe(1);
  c.page = (await c.app.windows()).find(
    (page) => !page.isClosed() && page.url().startsWith(c.endpoint),
  )!;
  await expect.poll(async () => (await state(c)).recovery.pending).toBe(false);
  const route = await c.page.evaluate(() => location.hash);
  await c.app.evaluate(() => {
    const probe = (globalThis as any).__notificationProbe;
    probe.handles.get(probe.submissions[0].id).emit("click");
  });
  expect(await c.page.evaluate(() => location.hash)).toBe(route);
  expect(await nativeSubmissions(c)).toHaveLength(1);
  expect(c.provider.requests).toHaveLength(1);
  expect((await state(c)).receipt.incarnation).toBe(
    original.receipt.incarnation,
  );
  await stop(c.app);

  let successor: ElectronApplication | undefined;
  let enginePid = 0;
  try {
    const next = await relaunch(c);
    successor = next.app;
    const currentCandidate = { ...c, app: next.app, page: next.page };
    await expect
      .poll(
        async () =>
          (await state(currentCandidate)).notifications?.observer
            ?.projectionAvailable,
      )
      .toBe(true);
    const current = await state(currentCandidate);
    enginePid = current.enginePid;
    expect(new URL(next.page.url()).origin).not.toBe(c.endpoint);
    expect(current.receipt.incarnation).not.toBe(original.receipt.incarnation);
    expect(current.storage.profile).toBe(original.storage.profile);
    expect(current.notifications.enabled).toBe(true);
    expect(current.notifications.unreadCompletions).toBe(1);
    expect(
      (await checkpoint(currentCandidate)).native.notifications.frontier,
    ).toBe(saved.frontier);
    expect(
      (await checkpoint(currentCandidate)).native.notifications.cutoff,
    ).toBe(saved.cutoff);
    expect(await nativeSubmissions(currentCandidate)).toEqual([]);
    expect(c.provider.requests).toHaveLength(1);
    c.provider.assertConsumed();
  } finally {
    if (successor) await stop(successor);
    if (enginePid)
      await expect
        .poll(
          () => {
            try {
              process.kill(enginePid, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 30000 },
        )
        .toBe(false);
  }
});

test("healthy checkpoint with invalid native notifications permits explicit menu Reset while retaining preferences and drafts", async ({
  candidate: c,
}) => {
  const session = await c.session();
  const original = await state(c);
  await stop(c.app);
  const profile = original.storage.profile,
    track = original.receipt.identity.track;
  const binding = [
    `desktop-${profile}`,
    profile,
    "local",
    "local",
    profile,
    track,
  ];
  const values = {
    preferences: {
      "nac.sidebar.open": "false",
      // Keep Reset isolated from Focus's legitimate first-use Inbox write.
      "nac.inbox.read.v1": JSON.stringify({ since: Date.now(), runs: {} }),
    },
    drafts: {
      ["nac:prompt-drafts:v2:" + JSON.stringify(binding)]: JSON.stringify({
        version: 2,
        binding,
        drafts: [
          [
            session,
            "Private malformed-notification recovery draft; never send.",
          ],
        ],
      }),
    },
  };
  const file = path.join(
    await fs.realpath(path.join(c.directory, "home")),
    "Library/Application Support/NAC/Presentation",
    track,
    profile,
    "checkpoint.json",
  );
  const source = JSON.stringify({
    version: 2,
    profile,
    values,
    native: { notifications: { enabled: "invalid", receipts: [] } },
  });
  await fs.writeFile(file, source, { mode: 0o600 });
  let successor: ElectronApplication | undefined;
  let enginePid = 0;
  try {
    const next = await relaunch(c);
    successor = next.app;
    const current = { ...c, app: next.app, page: next.page };
    await expect
      .poll(async () => (await state(current)).notifications?.resettable)
      .toBe(true);
    const before = await state(current);
    enginePid = before.enginePid;
    expect(before.storage.available).toBe(true);
    expect(before.notifications.loaded).toBe(false);
    expect(before.notifications.enabled).toBe(false);
    expect(before.notifications.observer?.tasks ?? 0).toBe(0);
    expect(await fs.readFile(file, "utf8")).toBe(source);
    expect(
      await next.app.evaluate(({ Menu }) => ({
        enable: Menu.getApplicationMenu()!.getMenuItemById(
          "notifications-enable",
        )!.enabled,
        reset: Menu.getApplicationMenu()!.getMenuItemById(
          "notifications-reset",
        )!.enabled,
      })),
    ).toEqual({ enable: false, reset: true });
    await menu(current, "notifications-reset");
    await expect
      .poll(async () => {
        const value = (await state(current)).notifications;
        return (
          value.loaded && !value.enabled && !value.saving && !value.suspended
        );
      })
      .toBe(true);
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    expect(saved.native?.notifications ?? null).toBeNull();
    expect(saved.values).toEqual(values);
    expect(await nativeSubmissions(current)).toEqual([]);
    expect(c.provider.requests).toHaveLength(0);
  } finally {
    if (successor) await stop(successor);
    if (enginePid)
      await expect
        .poll(
          () => {
            try {
              process.kill(enginePid, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 30000 },
        )
        .toBe(false);
  }
});

test("notification clicks preserve a focused retained draft and consume unretained-editor and IME deferrals without replay", async ({
  candidate: c,
}) => {
  await installNativeDouble(c.app);
  await expect
    .poll(async () => (await state(c)).notifications?.loaded)
    .toBe(true);
  const project = await c.project();
  const source = await c.session("direct", project);
  const target = await c.session("direct", project);
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, source);
  const composer = c.page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  const draft =
    "  Retained private draft 雪\nNever submit from a notification.  ";
  await composer.fill(draft);
  await expect(composer).toHaveAttribute("data-nac-retained-draft", "");
  const draftIsSaved = () =>
    checkpoint(c)
      .then((saved) =>
        Object.values(saved.values.drafts).some((raw: any) =>
          JSON.parse(raw).drafts.some(
            (entry: string[]) => entry[0] === source && entry[1] === draft,
          ),
        ),
      )
      .catch(() => false);
  await expect.poll(draftIsSaved).toBe(true);
  await menu(c, "notifications-enable", true);
  await expect
    .poll(
      async () => (await state(c)).notifications.observer?.projectionAvailable,
    )
    .toBe(true);

  const completeWhileHidden = async (index: number, token: string) => {
    await closeWorkspace(c);
    // A notification/target ACK does not retire Rust's run operation. Observe
    // canonical settlement before the next deliberate POST, never retry input.
    await expect
      .poll(async () => (await c.api(`/sessions/${target}`)).active_run == null)
      .toBe(true);
    c.provider.enqueue(
      `notification-editor-${index}`,
      { token },
      {
        kind: "text",
        text: `Private notification target ${index}.`,
        stream: "request",
      },
    );
    await c.api(`/sessions/${target}/runs`, { prompt: token });
    await expect
      .poll(async () => (await nativeSubmissions(c)).length)
      .toBe(index + 1);
    await expect
      .poll(
        async () => (await checkpoint(c)).native.notifications.receipts.length,
      )
      .toBe(0);
    await c.app.evaluate((_electron, index) => {
      const probe = (globalThis as any).__notificationProbe;
      probe.handles.get(probe.submissions[index].id).emit("click");
    }, index);
    await expect
      .poll(() =>
        c.app.evaluate(
          () => (globalThis as any).__notificationProbe.targetAcks.length,
        ),
      )
      .toBe(index + 1);
    return c.app.evaluate(
      () => (globalThis as any).__notificationProbe.targetAcks.at(-1).outcome,
    );
  };
  const refuseLateReplay = async (index: number) => {
    await c.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await c.app.evaluate((_electron, index) => {
      const probe = (globalThis as any).__notificationProbe;
      probe.handles.get(probe.submissions[index].id).emit("click");
    }, index);
    expect(await c.page.evaluate(() => location.hash)).toContain(
      `/session/${source}`,
    );
    expect(
      await c.app.evaluate(
        () => (globalThis as any).__notificationProbe.targetAcks.length,
      ),
    ).toBe(index + 1);
    await expect(composer).toHaveValue(draft);
    expect(await draftIsSaved()).toBe(true);
  };

  await composer.focus();
  expect(
    await c.page.evaluate(() =>
      document.activeElement?.hasAttribute("data-nac-retained-draft"),
    ),
  ).toBe(true);
  expect(await completeWhileHidden(0, "NOTIFICATION_RETAINED_EDITOR")).toBe(
    "opened",
  );
  await expect
    .poll(() => c.page.evaluate(() => location.hash))
    .toContain(`/session/${target}`);
  expect(await draftIsSaved()).toBe(true);
  expect(c.provider.requests).toHaveLength(1);
  await c.page.evaluate((id) => {
    location.hash = `/session/${id}/files`;
  }, source);
  await expect(composer).toHaveValue(draft);

  // A private DOM fixture isolates the ordinary unretained input guard without
  // introducing a modal, which would independently forbid navigation.
  await c.page.evaluate(() => {
    const editor = document.createElement("input");
    editor.id = "notification-unretained-editor";
    editor.value = "Private unretained editor text";
    document.body.append(editor);
    editor.focus();
  });
  expect(await c.page.evaluate(() => document.activeElement?.id)).toBe(
    "notification-unretained-editor",
  );
  expect(await completeWhileHidden(1, "NOTIFICATION_UNRETAINED_EDITOR")).toBe(
    "deferred",
  );
  expect(await c.page.evaluate(() => location.hash)).toContain(
    `/session/${source}`,
  );
  expect(
    await c.page.locator("#notification-unretained-editor").inputValue(),
  ).toBe("Private unretained editor text");
  await c.page.evaluate(() =>
    document.getElementById("notification-unretained-editor")!.remove(),
  );
  await composer.focus();
  await refuseLateReplay(1);
  expect(c.provider.requests).toHaveLength(2);

  // Synthetic composition events exercise the existing guard only; this is
  // separate from native IME/input qualification.
  await composer.dispatchEvent("compositionstart", { bubbles: true });
  expect(await completeWhileHidden(2, "NOTIFICATION_IME_EDITOR")).toBe(
    "deferred",
  );
  expect(await c.page.evaluate(() => location.hash)).toContain(
    `/session/${source}`,
  );
  await composer.dispatchEvent("compositionend", { bubbles: true });
  await composer.focus();
  await refuseLateReplay(2);
  expect(c.provider.requests).toHaveLength(3);
  expect(await nativeSubmissions(c)).toHaveLength(3);
  c.provider.assertConsumed();
});
