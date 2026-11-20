import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./harness";
import { FAKE_DEVICE_CODE, ProviderDeviceAuthDouble } from "./provider-device-auth-double";
import { openSettingsSection } from "./settings-focus";

// The e2e program has no DOM library; these name only what the page code reads.
type DomNode = { parentElement: DomNode | null; scrollTop: number };
declare function getComputedStyle(element: DomNode): { overflowY: string };
declare const navigator: { clipboard: { readText(): Promise<string> } };

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

/** Fully on screen, and reached without scrolling anything inside the dialog. */
async function expectReachableWithoutScrolling(page: Page, target: Locator) {
  const box = await target.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  expect(
    await target.evaluate((element: DomNode) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === "auto" || overflowY === "scroll") && node.scrollTop > 0) return true;
      }
      return false;
    }),
  ).toBe(false);
}

for (const viewport of VIEWPORTS) {
  test(`connects a provider from Accounts & keys at ${viewport.width}px`, async ({
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

    // Hold the account check before opening Settings so no sign-in action can
    // appear until the service confirms the accounts are signed out.
    auth.holdCheck();
    await page.goto(harness.baseUrl);
    const account = await openSettingsSection(page, "Accounts & keys");
    await expect(account.getByText("ChatGPT sign-in", { exact: true })).toBeVisible();
    await expect(account.getByText("Checking connection…", { exact: true }).first()).toBeVisible();
    await expect(account.getByRole("button", { name: /Sign in/ })).toHaveCount(0);
    await expectReachableWithoutScrolling(page, account.getByRole("status").first());
    await shot("1-checking");

    auth.releaseCheck();
    const signIn = account.getByRole("button", {
      name: "Sign in with ChatGPT",
      exact: true,
    });
    await expect(signIn).toBeVisible();
    await expectReachableWithoutScrolling(page, signIn);
    await shot("2-signed-out");

    const popup = page.waitForEvent("popup");
    await signIn.click();
    await (await popup).close();
    await expect(account.getByTestId("provider-device-code")).toHaveText(FAKE_DEVICE_CODE);
    const copy = account.getByRole("button", {
      name: "Copy code",
      exact: true,
    });
    await expectReachableWithoutScrolling(page, copy);
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
    await expectReachableWithoutScrolling(page, account.getByText("Signed in", { exact: true }));
    await shot("4-signed-in");
    expect(auth.starts).toEqual(["codex"]);
    expect(auth.logouts).toEqual([]);
  });
}
