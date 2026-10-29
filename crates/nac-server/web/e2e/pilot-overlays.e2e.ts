import fs from "node:fs/promises";
import path from "node:path";
import { createProject, createSession, expect, test } from "./harness";

test.skip(!!process.env.NAC_E2E_REMOTE, "Requires isolated pilot fixtures");
test.use({ orchestration: "0" });

test("rename and delete preserve the responsive pilot journey and accessibility", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const project = await createProject(request, harness, { name: "Pilot verification" });
  const id = await createSession(request, harness, "direct", project);
  const title = "Pilot overlay";
  const presentation = await request.put(`${harness.baseUrl}/sessions/${id}/presentation`, {
    data: { title, pinned: false, expected_version: 0 },
  });
  expect(presentation.ok()).toBe(true);
  // An optional immutable dev bundle uses the same isolated API and fixture data.
  // This is visual baseline capture, not a claim of running dev's server code.
  const baseline = process.env.NAC_PILOT_BASELINE_DIST;
  if (baseline) {
    await page.route(`${harness.baseUrl}/assets/dist/**`, async (route) => {
      const relative = new URL(route.request().url()).pathname.slice("/assets/dist/".length);
      const file = path.resolve(baseline, relative);
      if (!file.startsWith(path.resolve(baseline) + path.sep)) return route.abort();
      const contentType = file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "application/octet-stream";
      await route.fulfill({ body: await fs.readFile(file), contentType });
    });
    await page.route(
      (url) => url.origin === new URL(harness.baseUrl).origin && url.pathname === "/",
      async (route) => {
        await route.fulfill({
          body: await fs.readFile(path.join(baseline, "index.html")),
          contentType: "text/html",
        });
      },
    );
  }
  const captures: string[] = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${harness.baseUrl}/?pilotViewport=${viewport.width}#/session/${id}/files`);
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    if (viewport.width < 768) {
      const menu = page.getByRole("button", { name: "Open the menu", exact: true });
      await expect(menu).toBeVisible();
      await menu.click();
      await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toBeVisible();
    } else {
      const expand = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await expand.isVisible()) await expand.click();
    }
    for (const theme of ["dark", "light"]) {
      for (const action of ["Rename", "Delete"]) {
        const opener = page.getByRole("button", { name: `${action} ${title}`, exact: true });
        if (viewport.width < 768 && !(await opener.isVisible())) {
          await page.getByRole("button", { name: "Open the menu", exact: true }).click();
        }
        await expect(opener).toBeVisible();
        await opener.focus();
        await opener.click();
        const dialog = page.getByRole(action === "Delete" && !baseline ? "alertdialog" : "dialog", {
          name: `${action} session`,
          exact: true,
        });
        await expect(dialog).toBeVisible();
        // The product is dark-only. Exercise existing light token plumbing without
        // representing it as a user-selectable theme.
        await page.evaluate((theme) => {
          type ThemeRoot = {
            classList: { remove: (...names: string[]) => void; add: (name: string) => void };
            setAttribute: (name: string, value: string) => void;
          };
          const { document } = globalThis as unknown as {
            document: {
              documentElement: ThemeRoot;
              querySelectorAll: (selector: string) => Iterable<ThemeRoot>;
            };
          };
          for (const root of [
            document.documentElement,
            ...document.querySelectorAll("[data-nac-runtime]"),
          ]) {
            root.classList.remove("light", "dark");
            root.classList.add(theme);
            root.setAttribute("data-theme", theme);
          }
        }, theme);
        await page.evaluate(() =>
          (
            globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
          ).document.fonts.ready.then(() => undefined),
        );
        await expect
          .poll(async () => {
            const bounds = await dialog.boundingBox();
            return bounds ? bounds.x + bounds.width : Infinity;
          })
          .toBeLessThanOrEqual(viewport.width + 1);
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
        await expect(cancel).toBeInViewport();
        await expect(
          dialog.getByRole("button", {
            name: action === "Rename" ? "Save" : "Delete session",
            exact: true,
          }),
        ).toBeInViewport();
        if (!baseline && action === "Rename") {
          await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
        }
        const name = `${baseline ? "dev" : "candidate"}-${viewport.width}-${theme}-${action.toLowerCase()}.png`;
        const file = info.outputPath(name);
        await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
        captures.push(name);
        await info.attach(name, { path: file, contentType: "image/png" });
        await cancel.click();
        await expect(dialog).toHaveCount(0);
        if (!baseline) await expect(opener).toBeFocused();
      }
    }
  }
  if (!baseline) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${harness.baseUrl}/?pilotJourney=1#/session/${id}/files`);
    const rename = page.getByRole("button", { name: `Rename ${title}`, exact: true });
    await rename.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(rename).toBeFocused();
    await expect(rename).toHaveAccessibleDescription("Rename chat");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await rename.click();
    const dialog = page.getByRole("dialog", { name: "Rename session", exact: true });
    const field = dialog.getByRole("textbox", { name: "Title", exact: true });
    await field.fill("x".repeat(121));
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/session title must not exceed 120 characters/)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(field).toHaveValue("x".repeat(121));
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(rename).toBeFocused();
    await rename.click();
    await expect(field).toHaveValue(title);
    const reopenedCapture = info.outputPath("candidate-rename-reopened.png");
    await page.screenshot({ path: reopenedCapture, animations: "disabled", caret: "hide" });
    await info.attach("canceled rename reopened", {
      path: reopenedCapture,
      contentType: "image/png",
    });
    const cdp = await page.context().newCDPSession(page);
    await field.focus();
    await cdp.send("Input.imeSetComposition", {
      text: "にほん",
      selectionStart: 3,
      selectionEnd: 3,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 229,
      nativeVirtualKeyCode: 229,
      isKeypad: false,
    });
    await expect(dialog).toBeVisible();
    await cdp.send("Input.insertText", { text: "日本" });
    await field.fill("Pilot renamed");
    const writes: string[] = [];
    page.on("request", (req) => {
      if (["PUT", "DELETE"].includes(req.method()) && req.url().includes(`/sessions/${id}`))
        writes.push(req.method());
    });
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual(["PUT"]);
    const remove = page.getByRole("button", { name: "Delete Pilot renamed", exact: true });
    await remove.click();
    const alert = page.getByRole("alertdialog", { name: "Delete session", exact: true });
    await expect(alert).toHaveAccessibleDescription(/cannot be undone/);
    await alert.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(remove).toBeFocused();
    expect(writes).toEqual(["PUT"]);
    await remove.click();
    await alert.getByRole("button", { name: "Delete session", exact: true }).dblclick();
    await expect(alert).toHaveCount(0);
    await expect(remove).toHaveCount(0);
    expect(writes).toEqual(["PUT", "DELETE"]);
  }
  await info.attach("pilot capture contract", {
    contentType: "application/json",
    body: JSON.stringify({
      captures,
      baseline: baseline ?? null,
      notes:
        "Actual production bundles and controlled isolated API. Light tokens applied explicitly; 720px capture is a 200% layout equivalent, not physical device/browser zoom. No real screen reader or OS input method driven.",
    }),
  });
});
