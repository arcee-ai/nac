import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { startPackedPresentation } from "./packed-presentation-fixture";

test.use({ orchestration: "0" });
for (const packed of [false, true]) {
  test(`task Markdown uses verified inventory and routing in ${packed ? "packed" : "native"} presentation`, async ({
    harness,
    page,
    request,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness);
    const caller = await createSession(request, harness, "direct", project);
    const target = await createSession(request, harness, "direct", project);
    const fixture = packed ? await startPackedPresentation(harness, caller) : null;
    let hideTarget = true;
    let failInventory = false;
    let releaseFailure: (() => void) | undefined;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    await page.route("**/sessions", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (failInventory) {
        await failureGate;
        return route.fulfill({ status: 503, body: "Inventory temporarily unavailable" });
      }
      const response = await route.fetch();
      if (!hideTarget) return route.fulfill({ response });
      const entries = (await response.json()) as Array<{ summary: { session_id: string } }>;
      return route.fulfill({
        response,
        json: entries.filter((entry) => entry.summary.session_id !== target),
      });
    });
    let callerLocation = "";
    const expectCaller = async () => {
      if (packed) {
        await expect(page.locator('output[aria-label="Single native location"]')).toHaveText(
          callerLocation,
        );
        await expect(page.getByLabel("Product location")).toHaveText("/");
      } else await expect(page).toHaveURL(new RegExp(`${caller}/insights`));
    };
    try {
      harness.provider.enqueue(
        "task-reference",
        { token: "TASK_REFERENCE_FIXTURE" },
        {
          kind: "text",
          stream: "request",
          text: `[Open research](/session/${target})`,
        },
      );
      await page.goto(
        fixture ? fixture.baseUrl : `${harness.baseUrl}/#/session/${caller}/insights`,
      );
      if (packed) {
        const current = page.locator('output[aria-label="Single native location"]');
        await expect(current).toContainText(`/session/${caller}/`);
        callerLocation = (await current.textContent()) ?? "";
      }
      const composer = page.getByRole("combobox", { name: "Message" });
      await composer.fill("TASK_REFERENCE_FIXTURE");
      await page
        .locator("form")
        .filter({ has: composer })
        .getByRole("button", { name: "Send", exact: true })
        .click();
      const link = page.getByRole("link", { name: "Open research", exact: true });
      await expect(page.getByText(/Open research \(Task unavailable\)/)).toBeVisible();
      await expect(link).toHaveCount(0);
      await expectCaller();
      if (process.env.NAC_TASK_REFERENCE_SCREENSHOT_DIR) {
        await page.screenshot({
          path: `${process.env.NAC_TASK_REFERENCE_SCREENSHOT_DIR}/${packed ? "packed" : "native"}-unavailable.png`,
          animations: "disabled",
        });
      }
      await info.attach("unavailable task reference", {
        body: await page.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
      hideTarget = false;
      const retry = page.getByRole("button", { name: "Check again" });
      expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await retry.focus();
      await page.keyboard.press("Enter");
      await expect(link).toBeVisible();
      await expect(link).toBeFocused();
      await expectCaller();
      // A failed deliberate activation stays in the caller and can be rechecked.
      failInventory = true;
      await page.keyboard.press("Enter");
      const checking = page.getByTitle("Checking task availability");
      await expect(checking).toBeFocused();
      await expect(page.getByText("Checking whether the task is available.")).toHaveAttribute(
        "role",
        "status",
      );
      releaseFailure?.();
      await expect(page.getByText(/Open research \(Task unavailable\)/)).toBeVisible();
      await expect(page.getByText("The task is unavailable.")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      await expect(retry).toBeFocused();
      await expectCaller();
      failInventory = false;
      await page.keyboard.press("Enter");
      await expect(link).toBeVisible();
      await expect(link).toBeFocused();
      await expectCaller();
      await waitForRunIdle(request, harness, caller);
      await expect(page.getByLabel("Loading conversation")).toHaveCount(0);
      if (process.env.NAC_TASK_REFERENCE_SCREENSHOT_DIR) {
        await page.screenshot({
          path: `${process.env.NAC_TASK_REFERENCE_SCREENSHOT_DIR}/${packed ? "packed" : "native"}.png`,
          animations: "disabled",
        });
      }
      await info.attach("task reference", {
        body: await page.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
      await link.focus();
      await page.keyboard.press("Enter");
      if (packed) {
        await expect(page.locator('output[aria-label="Single native location"]')).toHaveText(
          `/session/${target}/insights`,
        );
        await expect(page.getByLabel("Product location")).toHaveText("/");
      } else await expect(page).toHaveURL(new RegExp(`${target}/insights`));
      if (packed) {
        // Return through the host's bound presentation rather than escaping to a URL.
        await page.goto(fixture!.baseUrl);
      } else await page.goto(`${harness.baseUrl}/#/session/${caller}/insights`);
      await expect(page.getByRole("link", { name: "Open research", exact: true })).toBeVisible();
      expect((await request.delete(`${harness.baseUrl}/sessions/${target}`)).ok()).toBe(true);
      await page.getByRole("link", { name: "Open research", exact: true }).click();
      await expect(page.getByText(/Task unavailable/)).toBeVisible();
    } finally {
      releaseFailure?.();
      await fixture?.stop();
    }
  });
}

for (const packed of [false, true]) {
  test(`passive inventory recovery respects keyboard focus in ${packed ? "packed" : "native"} presentation`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness);
    const caller = await createSession(request, harness, "direct", project);
    const target = await createSession(request, harness, "direct", project);
    const fixture = packed ? await startPackedPresentation(harness, caller) : null;
    let failInventory = false;
    await page.route("**/sessions", (route) => {
      if (route.request().method() === "GET" && failInventory)
        return route.fulfill({ status: 503, body: "Inventory temporarily unavailable" });
      return route.continue();
    });
    try {
      harness.provider.enqueue(
        "passive-focus",
        { token: "PASSIVE_FOCUS_FIXTURE" },
        {
          kind: "text",
          stream: "request",
          text: `[Open research](/session/${target})`,
        },
      );
      await page.goto(
        fixture ? fixture.baseUrl : `${harness.baseUrl}/#/session/${caller}/insights`,
      );
      const composer = page.getByRole("combobox", { name: "Message" });
      await composer.fill("PASSIVE_FOCUS_FIXTURE");
      await page
        .locator("form")
        .filter({ has: composer })
        .getByRole("button", { name: "Send", exact: true })
        .click();
      const link = page.getByRole("link", { name: "Open research", exact: true });
      const retry = page.getByRole("button", { name: "Check again" });
      await expect(link).toBeVisible();
      await waitForRunIdle(request, harness, caller);
      const initialLocation = packed
        ? await page.locator('output[aria-label="Single native location"]').textContent()
        : page.url();
      async function failActivation() {
        failInventory = true;
        await link.focus();
        await page.keyboard.press("Enter");
        await expect(retry).toBeFocused();
        failInventory = false;
      }
      async function expectCaller() {
        if (packed)
          await expect(page.locator('output[aria-label="Single native location"]')).toHaveText(
            initialLocation!,
          );
        else await expect(page).toHaveURL(initialLocation!);
      }
      await failActivation();
      await expect(link).toBeVisible({ timeout: 15_000 });
      await expect(link).toBeFocused();
      await expectCaller();
      await failActivation();
      await composer.focus();
      await expect(link).toBeVisible({ timeout: 15_000 });
      await expect(composer).toBeFocused();
      await expectCaller();
    } finally {
      await fixture?.stop();
    }
  });
}
