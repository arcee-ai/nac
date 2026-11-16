import { expect, test } from "./harness";
import { captureSetup, installSetupFixture, withSetupBaselines } from "./setup-visual-fixture";

test.use({ orchestration: "0" });
test.skip(
  !!process.env.NAC_E2E_REMOTE,
  "Controlled SSH boundary requires the disposable local harness",
);

for (const width of [1440, 768, 390]) {
  test(`SSH launch draft retains explicit connection and nested path ownership at ${width}px`, async ({
    harness,
    page,
    request,
  }, info) =>
    withSetupBaselines(async (baseline) => {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await baseline.serve(page, harness.baseUrl);
      await installSetupFixture(page, request, harness, width);
      const attempts: unknown[] = [];
      let fail = true;
      // This is the SSH external boundary, not an actual remote host or real credential.
      await page.route(`${harness.baseUrl}/ssh/browse`, (route) => {
        const payload = route.request().postDataJSON();
        attempts.push(payload);
        if (fail)
          return route.fulfill({
            status: 422,
            json: {
              error: "Controlled SSH fixture is offline. Check the host and try Connect again.",
            },
          });
        return route.fulfill({
          json: {
            path: "/home/fixture/workspace",
            home: "/home/fixture",
            parent: "/home/fixture",
            entries: [],
            truncated: false,
          },
        });
      });
      await page.goto(harness.baseUrl);
      await page.getByRole("button", { name: "Get Started", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New Project", exact: true });
      await dialog.getByRole("button", { name: "SSH", exact: true }).click();
      const host = dialog.getByPlaceholder("example@192.0.2.10 or build-box");
      await host.fill("build-box");
      await host.focus();
      expect(attempts).toHaveLength(0);
      const connect = dialog.getByRole("button", { name: "Connect", exact: true });
      await captureSetup(page, info, width, "ssh-draft", host);
      const port = dialog.getByPlaceholder("22", { exact: true });
      await port.fill("99999");
      await connect.click();
      await expect(
        dialog.getByText("Port must be an integer between 1 and 65535.", { exact: true }),
      ).toBeVisible();
      expect(attempts).toHaveLength(0);
      await port.fill("");
      await connect.click();
      await expect(dialog.getByText(/Controlled SSH fixture is offline/)).toBeVisible();
      expect(attempts).toEqual([
        {
          ssh_host: "build-box",
          ssh_port: null,
          ssh_identity_file: null,
          path: null,
          hidden: false,
        },
      ]);
      await captureSetup(page, info, width, "ssh-error", connect);
      fail = false;
      await connect.click();
      await expect(dialog.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
      expect(attempts).toHaveLength(2);
      await expect(host).toHaveValue("build-box");
      await expect(port).toHaveValue("");
      await dialog.getByRole("button", { name: "Select a model", exact: true }).click();
      await page.getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first().click();
      await expect(
        dialog.getByRole("button", { name: "Create Project", exact: true }),
      ).toBeEnabled();
      await captureSetup(
        page,
        info,
        width,
        "ssh-connected",
        dialog.getByText("SSH config", { exact: true }),
      );
      const folder = dialog
        .getByRole("button", { name: /Working Folder|\/home\/fixture\/workspace/ })
        .first();
      await folder.click();
      const picker = page.getByRole("dialog", {
        name: "Select Working Folder on build-box",
        exact: true,
      });
      await expect(picker).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await expect(folder).toBeFocused();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      expect(
        (await (await request.get(`${harness.baseUrl}/projects`)).json()).projects,
      ).toHaveLength(0);
      await info.attach("controlled-ssh-boundary.json", {
        body: JSON.stringify({
          attempts,
          realSSH: false,
          scope:
            "UI draft, explicit Connect, validation, retry, ready-to-launch and nested path/cancel; actual remote execution not claimed",
        }),
        contentType: "application/json",
      });
    }));
}
