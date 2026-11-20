import { createProject, createSession, expect, test } from "./harness";

test("browser without a desktop bridge retains the shared new-session chord and focus", async ({
  harness,
  page,
  request,
}) => {
  const project = await createProject(request, harness);
  const id = await createSession(request, harness, "direct", project);
  await page.goto(`${harness.baseUrl}/#/session/${id}`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  expect(await page.evaluate(() => Reflect.has(globalThis, "__nacDesktop"))).toBe(false);
  // The shared chord needs this session's project from the hydrated global list.
  await expect(page.locator('[data-sidebar="true"] button[aria-current="page"]')).toHaveCount(1);
  await composer.focus();
  const mac = await page.evaluate("/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)");
  await page.keyboard.press(mac ? "Meta+Shift+O" : "Control+Shift+O");
  // The one new-session flow is Home's composer, preset to this session's
  // project and focused; nothing is created until the user sends.
  await expect(page).toHaveURL(`${harness.baseUrl}/#/?project=${project}`);
  const start = page.getByRole("textbox", { name: "What should we work on?", exact: true });
  await expect(start).toBeFocused();
  await page.goBack();
  await expect(composer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/session/${id}`));
  expect((await (await request.get(`${harness.baseUrl}/sessions`)).json()).length).toBe(1);
});

test("injected UI capability opens shared owners once without submitting a session", async ({
  harness,
  page,
  request,
}) => {
  await page.addInitScript(() => {
    let owner: ((message: unknown) => boolean) | undefined;
    Reflect.set(globalThis, "__nacDesktop", {
      connect(callback: (message: unknown) => boolean) {
        owner = callback;
        return () => {
          if (owner === callback) owner = undefined;
        };
      },
    });
    Reflect.set(
      globalThis,
      "__desktopFixtureDispatch",
      (message: unknown) => owner?.(message) ?? false,
    );
  });
  const project = await createProject(request, harness);
  const id = await createSession(request, harness, "direct", project);
  await page.goto(`${harness.baseUrl}/#/session/${id}`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  // New Session needs this route's project from the hydrated global list.
  await expect(page.locator('[data-sidebar="true"] button[aria-current="page"]')).toHaveCount(1);
  await composer.focus();
  const mutations: string[] = [];
  page.on("request", (event) => {
    const route = new URL(event.url()).pathname;
    // Both POST routes resolve model catalogs; neither saves configuration or
    // admits a session. Keep every other non-GET operation in the mutation guard.
    const catalogQuery = event.method() === "POST" && route === "/providers/models";
    if (event.method() !== "GET" && !catalogQuery) {
      mutations.push(`${event.method()} ${route}`);
    }
  });
  const dispatch = (request: number, action: string) =>
    page.evaluate(
      ({ request, action }) => {
        const send = Reflect.get(globalThis, "__desktopFixtureDispatch") as (
          message: unknown,
        ) => boolean;
        return send({ version: 1, request, action });
      },
      { request, action },
    );
  // Settings is a full page now: the command navigates to Models & providers.
  expect(await dispatch(1, "settings")).toBe(true);
  const settings = page.getByRole("main", { name: "Models & providers", exact: true }).first();
  await expect(settings).toBeVisible();
  await expect(page).toHaveURL(`${harness.baseUrl}/#/settings/models`);
  expect(await dispatch(1, "settings")).toBe(false); // A replayed request never reruns.
  await page.goBack();
  await expect(composer).toBeVisible();
  // A modal that owns focus still refuses a command.
  await page.getByRole("button", { name: "Session menu", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Session", exact: true })
    .getByRole("button", { name: "Session settings", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Session settings", exact: true });
  await expect(modal).toBeVisible();
  expect(await dispatch(2, "newSession")).toBe(false); // Current modal owns focus.
  await expect(modal).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`#/session/${id}`));
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await composer.focus();
  expect(await dispatch(3, "newSession")).toBe(true);
  // New session opens Home's composer for this project; it submits nothing.
  await expect(page).toHaveURL(`${harness.baseUrl}/#/?project=${project}`);
  const start = page.getByRole("textbox", { name: "What should we work on?", exact: true });
  await expect(start).toBeFocused();
  expect(await dispatch(3, "newSession")).toBe(false);
  await expect(page).toHaveURL(`${harness.baseUrl}/#/?project=${project}`);
  expect(mutations).toEqual([]);
  // Scripted browser delivery qualifies only this optional UI adapter. Actual
  // AppKit menus, WK frame provenance and trusted Edit input have native tests.
});
