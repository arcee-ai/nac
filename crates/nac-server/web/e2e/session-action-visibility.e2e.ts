import { createProject, createSession, expect, test } from "./harness";
import { startPackedPresentation } from "./packed-presentation-fixture";
import { recordSessionAction } from "./session-action-geometry";

test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated local packed consumer");

for (const mode of [
  { width: 1440, touch: true },
  { width: 768, touch: true },
  { width: 390, touch: true },
  { width: 1440, touch: false },
]) {
  test.describe(`packed session actions ${mode.width}px touch=${mode.touch}`, () => {
    test.use({ orchestration: "1", hasTouch: mode.touch });
    test("preserves tab space, hover, keyboard and real pointer interception", async ({
      harness,
      page,
      request,
    }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: mode.width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const project = await createProject(request, harness);
      const id = await createSession(request, harness, "direct", project);
      // The shipped design route renders the production atoms inside the installed package.
      const fixture = await startPackedPresentation(harness, id, {
        initialPaths: { Single: "/design" },
      });
      try {
        await page.goto(fixture.baseUrl);
        const root = page.locator("[data-nac-runtime]");
        const tab = root.locator(".chat-session-tab").filter({
          has: page.getByRole("button", { name: "Rewrite the store layer", exact: true }),
        });
        const trigger = tab.locator(".session-name-tab-trigger");
        const actions = tab.locator(".session-name-tab-actions");
        const disclosure = actions.getByRole("button", { name: "View full name", exact: true });
        await tab.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        const initial = await recordSessionAction(disclosure, info, "tab-before-input");
        expect(initial.media["(hover: none)"]).toBe(mode.touch);
        expect(initial.media["(hover: hover)"]).toBe(!mode.touch);
        if (mode.touch) {
          await expect(actions).toHaveCSS("opacity", "1");
          await expect(actions).toHaveCSS("pointer-events", "auto");
          await expect(trigger).toHaveCSS("padding-right", mode.width < 768 ? "64px" : "56px");
          expect(initial.centerHit).toBe(true);
        } else {
          await expect(actions).toHaveCSS("opacity", "0");
          await expect(actions).toHaveCSS("pointer-events", "none");
          await tab.hover();
          await expect(actions).toHaveCSS("opacity", "1");
          expect((await recordSessionAction(disclosure, info, "tab-hover")).centerHit).toBe(true);
          await trigger.click();
          await page.mouse.move(0, 0);
          await page.keyboard.press("Tab");
          await expect(disclosure).toBeFocused();
          await expect(actions).toHaveCSS("opacity", "1");
          await expect(trigger).toHaveCSS("padding-right", "56px");
        }
        const reserved = await tab.evaluate((element) => {
          const title = element.querySelector("[data-session-tab-title]")!.getBoundingClientRect();
          const controls = element
            .querySelector(".session-name-tab-actions")!
            .getBoundingClientRect();
          return { titleRight: title.right, actionsLeft: controls.left };
        });
        expect(reserved.titleRight).toBeLessThanOrEqual(reserved.actionsLeft + 0.5);
        // A genuinely covering element must still prevent an ordinary pointer action.
        await page.evaluate(() => {
          const browser = globalThis as unknown as {
            document: {
              createElement(tag: string): { id: string; style: { cssText: string } };
              body: { append(node: unknown): void };
            };
          };
          const cover = browser.document.createElement("div");
          cover.id = "session-action-test-occluder";
          // Cover the viewport so Playwright's normal scroll cannot move the
          // target outside a small fixed cover and accidentally invalidate the control.
          cover.style.cssText =
            "position:fixed;inset:0;z-index:2147483647;background:magenta;pointer-events:auto";
          browser.document.body.append(cover);
        });
        expect((await recordSessionAction(disclosure, info, "covered-tab-action")).centerHit).toBe(
          false,
        );
        await expect(disclosure.click({ timeout: 1000 })).rejects.toThrow(
          /intercepts pointer events/,
        );
        await page.locator("#session-action-test-occluder").evaluate((node) => node.remove());
        await disclosure.click({ timeout: 5000 });
        const dialog = root.getByRole("dialog", { name: "Full session name", exact: true });
        await expect(dialog).toContainText("Rewrite the store layer");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(page.locator("#sentinel")).toHaveCSS("font-family", "monospace");
        await expect(page.locator("#sentinel")).toHaveCSS("padding", "11px");
        await expect(page.getByLabel("Product location")).toHaveText("/");
        expect(
          fixture.calls.filter((call) => ["PUT", "PATCH", "DELETE"].includes(call.method)),
        ).toEqual([]);
      } finally {
        await fixture.stop();
      }
    });
  });
}
