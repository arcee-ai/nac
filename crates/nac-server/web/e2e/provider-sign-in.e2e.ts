import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./harness";
import { FAKE_DEVICE_CODE, ProviderDeviceAuthDouble } from "./provider-device-auth-double";

// The e2e program has no DOM library; these name only what the page code reads.
type DomNode = { parentElement: DomNode | null; scrollTop: number };
declare function getComputedStyle(element: DomNode): { overflowY: string };
declare const navigator: { clipboard: { readText(): Promise<string> } };

test.use({ orchestration: "0" });

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
  test(`connects a provider from the top of configuration management at ${viewport.width}px`, async ({
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

    await page.goto(harness.baseUrl);
    const menu = page.getByRole("button", {
      name: "Open the menu",
      exact: true,
    });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: "Configurations", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Configurations",
      exact: true,
    });
    await dialog
      .getByRole("textbox", { name: "Configuration name", exact: true })
      .fill("Draft survives sign-in");

    // The account list has not answered yet, so nothing may claim signed out.
    auth.holdCheck();
    await dialog.getByRole("button", { name: "OpenAI Responses", exact: true }).click();
    await page.getByRole("button", { name: "ChatGPT Codex Responses", exact: true }).click();
    await expect(page.getByRole("button", { name: "Arcee API (Key)", exact: true })).toHaveCount(0);
    const account = dialog.getByRole("region", {
      name: "Provider account",
      exact: true,
    });
    await expect(account.getByText("Checking connection…", { exact: true })).toBeVisible();
    await expect(account.getByRole("button", { name: /Sign in/ })).toHaveCount(0);
    await expectReachableWithoutScrolling(page, account.getByRole("status"));
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
    await expect(account.getByRole("button", { name: "Open ChatGPT" })).toBeVisible();
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
    await expect(
      dialog.getByRole("textbox", { name: "Configuration name", exact: true }),
    ).toHaveValue("Draft survives sign-in");
    await expect(
      dialog.getByRole("button", {
        name: "ChatGPT Codex Responses",
        exact: true,
      }),
    ).toBeVisible();
    await shot("4-signed-in");
    expect(auth.starts).toEqual(["codex"]);
    expect(auth.logouts).toEqual([]);
  });
}
