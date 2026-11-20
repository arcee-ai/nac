import { expect, test } from "./harness";
import { FAKE_DEVICE_CODE, ProviderDeviceAuthDouble } from "./provider-device-auth-double";
import { openSettingsSection } from "./settings-focus";

declare const navigator: { clipboard: { readText(): Promise<string> } };

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test(`connects a provider from provider connections at ${viewport.width}px`, async ({
    harness,
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: harness.baseUrl,
    });
    const auth = await ProviderDeviceAuthDouble.install(page, harness.baseUrl);
    const shot = (stage: string) =>
      page.screenshot({
        path: testInfo.outputPath(`after-${viewport.width}-${stage}.png`),
      });

    // Hold the account list before opening the settings view so the pending
    // state is observable for the two supported sign-in providers.
    auth.holdCheck();
    await page.goto(harness.baseUrl);
    await openSettingsSection(page, "Models & providers");
    const account = page.getByRole("region", { name: "Provider connections", exact: true });
    await expect(account.getByText("Checking connection…", { exact: true }).first()).toBeVisible();
    await expect(account.getByRole("button", { name: /Sign in/ })).toHaveCount(0);
    await shot("1-checking");

    auth.releaseCheck();
    const signIn = account.getByRole("button", {
      name: "Sign in with ChatGPT",
      exact: true,
    });
    await expect(signIn).toBeVisible();
    await signIn.scrollIntoViewIfNeeded();
    await shot("2-signed-out");

    const popup = page.waitForEvent("popup");
    await signIn.click();
    await (await popup).close();
    await expect(account.getByTestId("provider-device-code")).toHaveText(FAKE_DEVICE_CODE);
    const copy = account.getByRole("button", {
      name: "Copy code",
      exact: true,
    });
    await copy.scrollIntoViewIfNeeded();
    await expect(account.getByRole("link", { name: "Open ChatGPT" })).toBeVisible();
    await expect(account.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await copy.focus();
    await page.keyboard.press("Enter");
    await expect(account.getByText("Code copied", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FAKE_DEVICE_CODE);
    await shot("3-device-code-copied");

    auth.approve();
    await expect(account.getByText("Signed in", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(account.getByTestId("provider-device-code")).toHaveCount(0);
    await shot("4-signed-in");
    expect(auth.starts).toEqual(["codex"]);
    expect(auth.logouts).toEqual([]);
  });
}
