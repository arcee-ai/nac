import { createSession, expect, test } from "./harness";

test("browser without a desktop bridge retains shared New Chat and focus", async ({
  harness,
  page,
  request,
}) => {
  const id = await createSession(request, harness, "direct");
  await page.goto(`${harness.baseUrl}/#/session/${id}`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  expect(await page.evaluate(() => Reflect.has(globalThis, "__nacDesktop"))).toBe(false);
  await composer.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+O" : "Control+Shift+O");
  const dialog = page.getByRole("dialog", { name: "New Chat", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(composer).toBeFocused();
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
  const id = await createSession(request, harness, "direct");
  await page.goto(`${harness.baseUrl}/#/session/${id}`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  await composer.focus();
  const mutations: string[] = [];
  page.on("request", (event) => {
    if (event.method() !== "GET" && new URL(event.url()).pathname !== "/providers/models") {
      mutations.push(`${event.method()} ${new URL(event.url()).pathname}`);
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
  expect(await dispatch(1, "settings")).toBe(true);
  const settings = page.getByRole("dialog", { name: "Configurations", exact: true });
  await expect(settings).toBeVisible();
  expect(await dispatch(1, "settings")).toBe(false);
  expect(await dispatch(2, "newSession")).toBe(false); // Current modal owns focus.
  await expect(settings).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(composer).toBeFocused();
  expect(await dispatch(3, "newSession")).toBe(true);
  const chat = page.getByRole("dialog", { name: "New Chat", exact: true });
  await expect(chat).toBeVisible();
  expect(await dispatch(3, "newSession")).toBe(false);
  await expect(chat).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(composer).toBeFocused();
  expect(mutations).toEqual([]);
  // Scripted browser delivery qualifies only this optional UI adapter. Actual
  // AppKit menus, WK frame provenance and trusted Edit input have native tests.
});
