import { test, expect, _electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// This opt-in development probe creates no engine, renderer or store. It can
// observe Electron/OS submission/failure only. A signed package and human native
// show/click/withdraw observation remain separate acceptance evidence.
test("actual Electron notification adapter uses private profile and withdraws its OS request", async () => {
  test.skip(process.platform !== "darwin", "Selected Mac development lane");
  test.skip(
    process.env.NAC_ELECTRON_NOTIFICATION_OS !== "1",
    "Opt-in actual OS submission probe",
  );
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nac-notification-e2e-"),
  );
  let app;
  try {
    for (const name of ["home", "data", "tmp", "xdg"])
      await fs.mkdir(path.join(directory, name));
    const fixture = path.join(directory, "notification-fixture.cjs");
    await fs.writeFile(
      fixture,
      `
      const {app, Notification} = require('electron');
      app.setPath('userData', process.env.NAC_NOTIFICATION_DATA);
      const {ElectronNotificationDelivery} = require(process.env.NAC_NOTIFICATION_MODULE);
      const {destination} = require(process.env.NAC_NOTIFICATION_STATE);
      app.whenReady().then(() => {
        const delivery = new ElectronNotificationDelivery({Notification});
        delivery.shouldPresent = () => true;
        const target = destination('a'.repeat(64), 'private-fixture-chat', 'private-fixture-occurrence');
        global.notificationFixture = {delivery, target, supported: Notification.isSupported()};
      });
      app.on('before-quit', () => global.notificationFixture?.delivery.retire());
    `,
    );
    app = await _electron.launch({
      args: [fixture],
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
        HOME: path.join(directory, "home"),
        TMPDIR: path.join(directory, "tmp"),
        XDG_CONFIG_HOME: path.join(directory, "xdg"),
        NAC_HOME: path.join(directory, "home"),
        NAC_NOTIFICATION_DATA: path.join(directory, "data"),
        NAC_NOTIFICATION_MODULE: path.resolve(
          __dirname,
          "../src/notification-delivery.cjs",
        ),
        NAC_NOTIFICATION_STATE: path.resolve(
          __dirname,
          "../src/notification-state.cjs",
        ),
      },
    });
    await expect
      .poll(() =>
        app!.evaluate(() => Boolean((globalThis as any).notificationFixture)),
      )
      .toBe(true);
    const result = await app.evaluate(async () => {
      const fixture = (globalThis as any).notificationFixture;
      const settings = await fixture.delivery.settings();
      if (!fixture.supported)
        return { supported: false, submitted: false, settings, retained: 0 };
      const submitted = await fixture.delivery.add(
        fixture.target,
        "Request completed",
      );
      fixture.delivery.withdrawProfile(fixture.target.profile);
      return {
        supported: true,
        submitted,
        settings,
        retained: fixture.delivery.notifications.size,
      };
    });
    expect(result.retained).toBe(0);
    console.log("Private native notification probe:", JSON.stringify(result));
    expect(["system-managed", "unavailable"]).toContain(result.settings.status);
    const receipt = test.info().outputPath("notification-submission.json");
    await fs.mkdir(path.dirname(receipt), { recursive: true });
    await fs.writeFile(
      receipt,
      JSON.stringify(
        {
          ...result,
          observedBanner: false,
          observedHumanClick: false,
          limitation:
            "OS submission callback is not signed native banner/click/withdraw qualification",
        },
        null,
        2,
      ) + "\n",
    );
    await test.info().attach("notification-submission.json", {
      path: receipt,
      contentType: "application/json",
    });
  } finally {
    if (app) await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
