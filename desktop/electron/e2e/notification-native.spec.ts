import { test, expect } from "./fixture";
import fs from "node:fs/promises";
import path from "node:path";

// Opt-in evidence probe, separate from mandatory deterministic notification.spec.
// It preserves real native show/close and standard OS permission/Focus behavior.
// No permission query, authorization override, system settings or OS input.
test.skip(!process.env.NAC_ELECTRON_APP, "Current packaged app is required");
test.skip(
  process.env.NAC_ELECTRON_NOTIFICATION_OS !== "1",
  "Explicit opt-in native OS attempt",
);
test("optional current package submits a real semantic notification and records native evidence limits", async ({
  candidate: c,
}, info) => {
  const read = () =>
    c.app.evaluate(({ app }) =>
      process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
        .getState(),
    );
  const supported = await c.app.evaluate(({ app, Notification }) => {
    if (!app.isPackaged)
      throw new Error("Native evidence requires packaged runtime");
    const probe = {
      invocations: 0,
      showEvents: 0,
      failedEvents: 0,
      closeInvocations: 0,
      closeEvents: 0,
      clickEvents: 0,
    };
    (globalThis as any).__realNotificationProbe = probe;
    const show = Notification.prototype.show,
      close = Notification.prototype.close;
    Notification.prototype.show = function () {
      ++probe.invocations;
      this.once("show", () => ++probe.showEvents);
      this.once("failed", () => ++probe.failedEvents);
      this.once("close", () => ++probe.closeEvents);
      this.on("click", () => ++probe.clickEvents);
      return show.call(this);
    };
    Notification.prototype.close = function () {
      ++probe.closeInvocations;
      return close.call(this);
    };
    return Notification.isSupported();
  });
  await expect
    .poll(async () => (await read()).notifications?.loaded)
    .toBe(true);
  await c.app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById(
      "notifications-enable",
    )!;
    if (!item.enabled || item.checked)
      throw new Error("Expected fresh private default-off preference");
    item.click(item);
  });
  await expect
    .poll(
      async () => (await read()).notifications.observer?.projectionAvailable,
    )
    .toBe(true);
  const session = await c.session();
  await c.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await expect
    .poll(() =>
      c.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(false);
  c.provider.enqueue(
    "real-packaged-notification",
    { token: "PRIVATE_NATIVE_NOTIFICATION" },
    {
      kind: "text",
      text: "Private packaged notification fixture.",
      stream: "request",
    },
  );
  await c.api(`/sessions/${session}/runs`, {
    prompt: "PRIVATE_NATIVE_NOTIFICATION",
  });
  await expect
    .poll(async () => (await read()).notifications.unreadCompletions)
    .toBe(1);
  await expect
    .poll(
      async () => {
        const value = await read();
        const native = await c.app.evaluate(
          () => (globalThis as any).__realNotificationProbe,
        );
        return (
          !supported ||
          value.notifications.deliveryUncertain ||
          native.showEvents > 0
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);
  const current = await read();
  const checkpoint = path.join(
    await fs.realpath(path.join(c.directory, "home")),
    "Library/Application Support/NAC/Presentation",
    current.receipt.identity.track,
    current.storage.profile,
    "checkpoint.json",
  );
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(checkpoint, "utf8")).native.notifications
          .receipts.length,
    )
    .toBe(0);
  const accounted = (await read()).notifications;
  await c.app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById(
      "notifications-enable",
    )!;
    if (!item.checked)
      throw new Error("Notification preference unexpectedly off");
    item.click(item);
  });
  await expect
    .poll(async () => {
      const value = (await read()).notifications;
      return !value.enabled && !value.saving;
    })
    .toBe(true);
  const native = await c.app.evaluate(
    () => (globalThis as any).__realNotificationProbe,
  );
  const evidence = {
    scope: "optional packaged real native submission attempt",
    build: current.receipt.identity,
    supported,
    native,
    submission: {
      attempted: native.invocations > 0,
      adapterSchedulingAcknowledged:
        native.showEvents > 0 && !accounted.deliveryUncertain,
      electronFailureEvent: native.failedEvents > 0,
      uncertain: accounted.deliveryUncertain,
    },
    semanticAccounting: {
      unreadCompletions: accounted.unreadCompletions,
      deliveryUncertain: accounted.deliveryUncertain,
    },
    optOutDurable: true,
    providerRequests: c.provider.requests.length,
    osObservation: {
      physicalBanner: "unobserved",
      humanClick: "unobserved",
      physicalWithdrawal: "unobserved",
    },
    limitations: [
      "Native show event is not physical banner proof or signed distribution qualification.",
      "No OS authorization/settings change or human notification input was performed.",
      "Native close/remove calls do not establish visual OS withdrawal.",
    ],
  };
  const receipt = info.outputPath("packaged-native-notification.json");
  await fs.mkdir(path.dirname(receipt), { recursive: true });
  await fs.writeFile(receipt, JSON.stringify(evidence, null, 2) + "\n");
  await info.attach("packaged-native-notification", {
    path: receipt,
    contentType: "application/json",
  });
  console.log("Packaged native notification attempt", JSON.stringify(evidence));
  expect(c.provider.requests).toHaveLength(1);
  c.provider.assertConsumed();
});
