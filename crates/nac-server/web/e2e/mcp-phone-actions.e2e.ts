import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { createSession } from "./harness";
import { openNameZoom } from "./session-name-zoom";
import {
  observePhoneWheel,
  readMcpInnerScrollOwner,
  requireMcpInnerScrollOwner,
  researchStalledMcpScroll,
  runMcpCaseWithCleanup,
} from "./mcp-phone-wheel-diagnostic";
import {
  assertTargets,
  capture,
  disabledDraft,
  evidence,
  expect,
  geometry,
  loopbackOnly,
  openDraft,
  openList,
  settle,
  test,
  type Geometry,
} from "./mcp-phone-actions-fixture";

test.use({ orchestration: "0", hasTouch: true });
test.skip(
  !!process.env.NAC_E2E_REMOTE,
  "Requires disposable disabled MCP fixtures and loopback egress guard",
);
const selected = process.env.NAC_MCP_PHONE_F1_MODE ?? "GREEN";
const environments = [
  { name: "native390", width: 390, zoom: 1 },
  { name: "actual195", width: 390, zoom: 2 },
  { name: "native161", width: 161, zoom: 1 },
];
const seeded = "f1_saved";
async function seed(request: APIRequestContext, base: string) {
  const response = await request.post(`${base}/mcp_library/servers`, {
    data: {
      name: seeded,
      enabled: false,
      required: false,
      transport: "stdio",
      protocol: "legacy",
      command: "/disabled-f1-fixture",
      args: [],
      env: {},
      env_vars: [],
      headers: {},
      env_headers: {},
      approval: "ask",
      denied_tools: [],
      tool_approvals: {},
    },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).enabled).toBe(false);
}
async function savedForm(list: Locator, page: Page) {
  await list.getByRole("button", { name: seeded, exact: true }).click();
  return page.getByRole("dialog", { name: seeded, exact: true });
}
for (const mode of ["RED", "GREEN"] as const)
  test.describe(`MCP phone F1 ${mode}`, () => {
    test.skip(
      selected !== mode,
      `${mode} is an explicit phase; old RED is never a default CI pass`,
    );
    for (const environment of environments.filter(
      (e) => mode === "GREEN" || e.name !== "native161",
    ))
      test(environment.name, async ({ harness, page: defaultPage, request }, info) => {
        test.setTimeout(120_000);
        let page = defaultPage;
        let closeZoom: (() => Promise<void>) | undefined;
        let release = () => {};
        await runMcpCaseWithCleanup(
          async () => {
            await seed(request, harness.baseUrl);
            const prepare = async (p: Page) => {
              await p.setViewportSize({ width: environment.width, height: 1000 });
              await loopbackOnly(p);
            };
            if (environment.zoom === 2) {
              const z = await openNameZoom(info, harness.baseUrl, prepare);
              page = z.page;
              closeZoom = () => z.context.close();
              expect(z.zoom).toBe(2);
            } else await prepare(page);
            await page.emulateMedia({ reducedMotion: "reduce" });
            const build = (await (await request.get(`${harness.baseUrl}/product-context`)).json())
              .build;
            if (process.env.NAC_EXPECTED_SOURCE_REVISION)
              expect(build.source_revision).toBe(process.env.NAC_EXPECTED_SOURCE_REVISION);
            await evidence(info, "f1-identity.json", {
              mode,
              environment,
              build,
              workerPid: process.pid,
              baselineTestSourceIsSeparateFromCompiledProduct: mode === "RED",
            });
            const id = await createSession(request, harness, "direct");
            const writes: { method: string; path: string; enabled?: boolean }[] = [];
            page.on("request", (r) => {
              const path = new URL(r.url()).pathname;
              if (path.startsWith("/mcp_library/servers") && r.method() !== "GET")
                writes.push({
                  method: r.method(),
                  path,
                  enabled: r.method() === "DELETE" ? undefined : r.postDataJSON()?.enabled,
                });
            });
            await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
            const list = await openList(page);
            const states: { state: string; geometry: Geometry }[] = [];
            const collect = async (state: string, dialog: Locator, labels: string[]) => {
              await settle(dialog, info, state);
              states.push({ state, geometry: await geometry(dialog, labels) });
              await evidence(info, "f1-all-targets-before-floor.json", states);
              await capture(page, info, `f1-${mode}-${environment.name}-${state}`);
            };
            await collect("list", list, ["Close"]);
            await list.getByRole("button", { name: "Add server", exact: true }).click();
            const catalog = page.getByRole("dialog", { name: "Add server", exact: true });
            await collect("catalog", catalog, ["Close"]);
            await catalog.getByRole("button", { name: "Custom", exact: true }).click();
            let draft = page.getByRole("dialog", { name: "Custom server", exact: true });
            await disabledDraft(draft, "f1_created");
            await collect("draft", draft, ["Save", "Cancel", "Close"]);
            await draft.getByRole("button", { name: "Cancel", exact: true }).click();
            await expect(draft).toHaveCount(0);
            await catalog.getByRole("button", { name: "Close", exact: true }).click();
            await expect(catalog).toHaveCount(0);
            let saved = await savedForm(list, page);
            await collect("saved", saved, ["Save", "Cancel", "Delete server", "Close"]);
            await saved.getByRole("button", { name: "Close", exact: true }).click();
            await expect(saved).toHaveCount(0);
            expect(states.flatMap((s) => s.geometry.targets)).toHaveLength(9);
            expect(writes).toHaveLength(0);
            await evidence(info, "f1-before-size-oracle.json", {
              states,
              writes,
              savedFixtureDisabled: true,
            });
            for (const state of states) {
              expect(state.geometry.viewport.width).toBe(environment.width / environment.zoom);
              if (environment.zoom === 2) expect(state.geometry.viewport.dpr).toBe(2);
            }
            assertTargets(states);
            if (mode === "RED") return;
            saved = await savedForm(list, page);
            const last = saved.getByRole("button", { name: "Test connection", exact: true });
            await settle(saved, info, "reading-before-wheel");
            const nativeFieldset = saved.locator("fieldset");
            await expect(nativeFieldset).toHaveJSProperty("disabled", false);
            const scrollOwner = nativeFieldset.locator(":scope > div");
            await expect(scrollOwner).toHaveCount(1);
            requireMcpInnerScrollOwner(await scrollOwner.evaluate(readMcpInnerScrollOwner));
            const ownerBox = await scrollOwner.boundingBox();
            expect(ownerBox).not.toBeNull();
            const beforeScroll = await scrollOwner.evaluate(
              (element) => (element as unknown as { scrollTop: number }).scrollTop,
            );
            await page.mouse.move(
              ownerBox!.x + ownerBox!.width / 2,
              ownerBox!.y + Math.min(ownerBox!.height / 2, 100),
            );
            const wheelDiagnosticEnabled =
              environment.name === "actual195" || environment.name === "native161";
            let wheelObservation: Awaited<ReturnType<typeof observePhoneWheel>> | undefined;
            const diagnosticErrors: { phase: string; attempt: number; error: string }[] = [];
            let diagnosticAttempt = 0;
            if (wheelDiagnosticEnabled) {
              try {
                wheelObservation = await observePhoneWheel(scrollOwner, {
                  x: ownerBox!.x + ownerBox!.width / 2,
                  y: ownerBox!.y + Math.min(ownerBox!.height / 2, 100),
                });
              } catch (error) {
                diagnosticErrors.push({ phase: "install", attempt: 0, error: String(error) });
              }
            }
            let wheelPollFailed = false;
            let wheelPrimary: unknown;
            try {
              await expect
                .poll(async () => {
                  if (wheelDiagnosticEnabled) diagnosticAttempt++;
                  if (wheelObservation) {
                    try {
                      await wheelObservation.evaluate((record) => record.before());
                    } catch (error) {
                      diagnosticErrors.push({
                        phase: "before",
                        attempt: diagnosticAttempt,
                        error: String(error),
                      });
                    }
                  }
                  await page.mouse.wheel(0, 600);
                  const remaining = scrollOwner.evaluate((element) => {
                    const owner = element as unknown as {
                      scrollTop: number;
                      scrollHeight: number;
                      clientHeight: number;
                    };
                    return owner.scrollHeight - owner.clientHeight - owner.scrollTop;
                  });
                  if (wheelObservation) {
                    // This is the original read: its rejection must escape the diagnostic catch.
                    const distance = await remaining;
                    try {
                      await wheelObservation.evaluate(
                        (record, value) => record.after(value),
                        distance,
                      );
                    } catch (error) {
                      diagnosticErrors.push({
                        phase: "after",
                        attempt: diagnosticAttempt,
                        error: String(error),
                      });
                    }
                  }
                  return remaining;
                })
                .toBeLessThanOrEqual(1);
            } catch (error) {
              wheelPollFailed = true;
              wheelPrimary = error;
              throw error;
            } finally {
              if (wheelDiagnosticEnabled) {
                let telemetry: unknown = null;
                if (wheelObservation) {
                  try {
                    telemetry = await wheelObservation.evaluate((record) => record.finish());
                  } catch (error) {
                    diagnosticErrors.push({
                      phase: "finish",
                      attempt: diagnosticAttempt,
                      error: String(error),
                    });
                  } finally {
                    try {
                      await wheelObservation.dispose();
                    } catch (error) {
                      diagnosticErrors.push({
                        phase: "dispose",
                        attempt: diagnosticAttempt,
                        error: String(error),
                      });
                    }
                  }
                }
                try {
                  await evidence(info, "f1-wheel-diagnostic.json", {
                    wheelPollFailed,
                    diagnosticAttempt,
                    installed: !!wheelObservation,
                    status:
                      !wheelObservation || diagnosticErrors.length > 0
                        ? "incomplete"
                        : "captured-unverified",
                    diagnosticErrors,
                    telemetry,
                  });
                } catch (error) {
                  diagnosticErrors.push({
                    phase: "persist",
                    attempt: diagnosticAttempt,
                    error: String(error),
                  });
                  // Diagnostic persistence must not replace the original assertion failure.
                  console.error("F1 wheel diagnostic evidence persistence failed", error);
                }
                if (wheelPollFailed) {
                  try {
                    await researchStalledMcpScroll({
                      page,
                      info,
                      form: saved,
                      reopen: async (timeout) => {
                        await list
                          .getByRole("button", { name: seeded, exact: true })
                          .click({ timeout });
                        return page.getByRole("dialog", { name: seeded, exact: true });
                      },
                      primary: wheelPrimary,
                      telemetry,
                      diagnosticErrors,
                    });
                  } catch (error) {
                    // The pending throw remains the SAME original wheel/read/assertion error.
                    console.error(
                      "F1 post-stall research incomplete; original failure retained",
                      error,
                    );
                  }
                }
              }
            }
            await settle(saved, info, "reading-after-wheel");
            const actualOwnerOverflow = await scrollOwner.evaluate((element) => {
              const owner = element as unknown as { scrollWidth: number; clientWidth: number };
              return { scrollWidth: owner.scrollWidth, clientWidth: owner.clientWidth };
            });
            await evidence(info, "f1-actual-scroll-owner-overflow.json", actualOwnerOverflow);
            expect(actualOwnerOverflow.scrollWidth).toBeLessThanOrEqual(
              actualOwnerOverflow.clientWidth + 1,
            );
            const lastBox = await last.boundingBox();
            const clearance = await geometry(saved, [
              "Save",
              "Cancel",
              "Delete server",
              "Close",
              "Test connection",
            ]);
            const afterScroll = await scrollOwner.evaluate(
              (element) => (element as unknown as { scrollTop: number }).scrollTop,
            );
            await evidence(info, "f1-last-field-clearance.json", {
              lastBox,
              ownerBox,
              beforeScroll,
              afterScroll,
              gesture: "trusted mouse wheel",
              layout: clearance,
            });
            expect(afterScroll).toBeGreaterThan(beforeScroll);
            expect(lastBox!.x).toBeGreaterThanOrEqual(clearance.consumer!.x);
            expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(clearance.consumer!.right);
            expect(lastBox!.y).toBeGreaterThanOrEqual(Math.max(0, ownerBox!.y));
            expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(clearance.viewport.height);
            expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(
              ownerBox!.y + ownerBox!.height,
            );
            expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(clearance.footer!.y);
            expect(
              clearance.targets.find((target) => target.label === "Test connection")!.centerHit,
            ).toBe(true);
            await saved.getByRole("button", { name: "Cancel", exact: true }).click();
            await expect(saved).toHaveCount(0);
            await expect(list.getByRole("button", { name: seeded, exact: true })).toBeFocused();
            draft = await openDraft(list, page);
            await disabledDraft(draft, "f1_discard");
            const name = draft.getByRole("textbox", { name: "Server name", exact: true });
            await name.click();
            await name.dispatchEvent("keydown", { key: "Escape", isComposing: true, keyCode: 229 });
            await expect(draft).toBeVisible();
            await page.keyboard.press("Tab");
            await draft.getByRole("button", { name: "Close", exact: true }).click();
            await expect(draft).toHaveCount(0);
            expect(writes).toHaveLength(0);
            await expect(
              catalog.getByRole("button", { name: "Custom", exact: true }),
            ).toBeFocused();
            await catalog.getByRole("button", { name: "Custom", exact: true }).click();
            draft = page.getByRole("dialog", { name: "Custom server", exact: true });
            await disabledDraft(draft, "f1_created");
            let attempts = 0;
            const pending = new Promise<void>((resolve) => (release = resolve));
            await page.route(`${harness.baseUrl}/mcp_library/servers`, async (route) => {
              if (route.request().method() !== "POST") return route.continue();
              expect(route.request().postDataJSON().enabled).toBe(false);
              attempts++;
              if (attempts === 1)
                return route.fulfill({
                  status: 403,
                  json: { error: "F1 controlled disabled-fixture rejection" },
                });
              await pending;
              return route.continue();
            });
            await draft.getByRole("button", { name: "Save", exact: true }).click();
            await expect(draft.getByRole("alert")).toContainText("F1 controlled");
            await draft.getByRole("button", { name: "Save", exact: true }).click();
            await expect(
              draft.getByRole("button", { name: "Saving…", exact: true }),
            ).toBeDisabled();
            await expect(draft.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
            release();
            await expect(draft).toHaveCount(0);
            expect(attempts).toBe(2);
            saved = await savedForm(list, page);
            await saved
              .getByRole("textbox", { name: "Command", exact: true })
              .fill("/disabled-f1-updated");
            await saved.getByRole("button", { name: "Save", exact: true }).click();
            await expect(saved).toHaveCount(0);
            saved = await savedForm(list, page);
            await saved.getByRole("button", { name: "Delete server", exact: true }).click();
            await expect(saved).toHaveCount(0);
            const remaining = (
              await (await request.get(`${harness.baseUrl}/mcp_library/servers`)).json()
            ).servers;
            expect(remaining.map((s: { name: string }) => s.name)).toEqual(["f1_created"]);
            expect(remaining.every((s: { enabled: boolean }) => !s.enabled)).toBe(true);
            expect(writes.filter((w) => w.method === "POST")).toHaveLength(2);
            expect(writes.filter((w) => ["PUT", "PATCH"].includes(w.method))).toHaveLength(1);
            expect(writes.filter((w) => w.method === "DELETE")).toHaveLength(1);
            expect(
              writes.filter((w) => w.method !== "DELETE").every((w) => w.enabled === false),
            ).toBe(true);
            expect(writes.some((w) => w.path.endsWith("/test"))).toBe(false);
            await evidence(info, "f1-green-actions.json", {
              writes,
              acceptedCreates: 1,
              acceptedUpdates: 1,
              acceptedDeletes: 1,
              allMcpFixturesDisabled: true,
              realMcpProcessOrProbe: false,
              syntheticCompositionNotOSIME: true,
            });
          },
          async () => {
            release();
            await closeZoom?.();
          },
        );
      });
  });
