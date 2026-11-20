import fs from "node:fs/promises";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test } from "./harness";
import { openNameZoom } from "./session-name-zoom";
import { auditSetupTargets } from "./setup-target-audit";
import { captureSetup, installSetupFixture } from "./setup-visual-fixture";

test.use({ orchestration: "0", hasTouch: true });
test.skip(!!process.env.NAC_E2E_REMOTE, "Requires a disposable local setup store");

for (const zoomed of [false, true]) {
  test(`setup actual44px targets and wrapped actions at ${zoomed ? "real200percent195CSS" : "390CSS"}`, async ({
    harness,
    page: defaultPage,
    request,
  }, info) => {
    test.setTimeout(90_000);
    const zoom = zoomed ? await openNameZoom(info, harness.baseUrl) : null;
    const page = zoom?.page ?? defaultPage;
    const failures: string[] = [];
    const audit = async (name: string, root?: Locator) => {
      const dialog =
        root ??
        page
          .locator(
            '[data-slot="dialog-content"][data-state="open"]:not([data-covered]):visible, [data-slot="sheet-content"][data-state="open"]:not([data-covered]):visible',
          )
          .last();
      failures.push(...(await auditSetupTargets(dialog, info, name)));
      await captureSetup(page, info, 390, `${zoomed ? "zoom200-" : ""}targets-${name}`);
    };
    try {
      await page.setViewportSize({ width: 390, height: 900 });
      expect(
        await page.locator("html").evaluate((node) => node.ownerDocument.defaultView!.innerWidth),
      ).toBe(zoomed ? 195 : 390);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await installSetupFixture(page, request, harness, 390);
      const loginCalls: string[] = [];
      await page.route(`${harness.baseUrl}/auth`, (route) =>
        route.fulfill({ json: { providers: [] } }),
      );
      await page.route(`${harness.baseUrl}/auth/codex/login`, (route) => {
        loginCalls.push(route.request().method());
        return route.fulfill({
          json: {
            provider: "codex",
            login_id: "target-audit",
            verification_uri: `${harness.baseUrl}/health`,
            user_code: "TARGET",
            expires_in_secs: 600,
          },
        });
      });
      await page.route(`${harness.baseUrl}/auth/codex/login/target-audit`, (route) => {
        if (route.request().method() === "DELETE") loginCalls.push("DELETE");
        return route.fulfill({ json: { state: "pending" } });
      });
      await page.goto(harness.baseUrl);
      await page.getByRole("button", { name: "Get Started", exact: true }).click();
      const project = page.getByRole("dialog", { name: "New Project", exact: true });
      await expect(
        project.getByRole("button", { name: "Create Project", exact: true }),
      ).toBeEnabled();
      await audit("project-location");
      await project.getByRole("button", { name: "SSH", exact: true }).click();
      await expect(
        project.getByRole("button", { name: "Create Project", exact: true }),
      ).toBeDisabled();
      await audit("unconnected-ssh");
      await project.getByRole("button", { name: "Close", exact: true }).click();
      expect(
        (await (await request.get(`${harness.baseUrl}/projects`)).json()).projects,
      ).toHaveLength(0);

      await page.goto(`${harness.baseUrl}/#/settings/accounts`);
      const accounts = page.getByRole("region", { name: "Subscriptions", exact: true });
      await expect(
        accounts.getByRole("button", { name: "Sign in with ChatGPT", exact: true }),
      ).toBeVisible();
      expect(loginCalls).toEqual([]);
      await audit("provider-disconnected", accounts);
      const popup = page.waitForEvent("popup");
      await accounts.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
      await (await popup).close();
      await expect(accounts.getByRole("link", { name: "Open ChatGPT", exact: true })).toBeVisible();
      await audit("provider-waiting", accounts);
      await accounts.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(loginCalls).toEqual(["POST", "DELETE"]);

      const ssh = await request.post(`${harness.baseUrl}/ssh-configs`, {
        data: {
          name: "Target audit SSH",
          ssh_host: "build-box",
          ssh_port: null,
          ssh_identity_file: null,
        },
      });
      expect(ssh.ok()).toBe(true);
      // Seed only the disposable server HOME used by this harness.
      await fs.mkdir(path.join(harness.runRoot, "home", ".ssh"), { recursive: true, mode: 0o700 });
      await page.goto(`${harness.baseUrl}/#/settings/ssh`);
      await page.reload();
      const sshDialog = page.getByRole("region", { name: "SSH configs", exact: true });
      await expect(
        sshDialog.getByRole("textbox", { name: "SSH config name", exact: true }),
      ).toHaveValue("Target audit SSH");
      await audit("saved-ssh-three-actions", sshDialog);
      const key = sshDialog.getByRole("button", { name: "Private Key: .ssh/config", exact: true });
      await key.click();
      const keyDialog = page.getByRole("dialog", { name: "Select Private Key", exact: true });
      await expect(keyDialog).toBeVisible();
      await expect(keyDialog.locator("footer").getByRole("button")).toHaveCount(3);
      await expect(keyDialog.getByRole("button", { name: "Select", exact: true })).toBeDisabled();
      await audit("private-key-three-actions");
      await page.keyboard.press("Escape");
      await expect(key).toBeFocused();
      await sshDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await info.attach("target-audit-context.json", {
        body: JSON.stringify(
          {
            zoom: zoom?.zoom ?? 1,
            viewport: 390,
            expectedInnerWidth: zoomed ? 195 : 390,
            actualInnerWidth: await page
              .locator("html")
              .evaluate((node) => node.ownerDocument.defaultView!.innerWidth),
            physicalDevice: false,
            realProviderLogin: false,
            realSSH: false,
            failures,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(failures).toEqual([]);
    } finally {
      await zoom?.context.close();
    }
  });
}
