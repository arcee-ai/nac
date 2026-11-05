import fs from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext, Locator, Page, Route, TestInfo } from "@playwright/test";
import { expect, initializeHarnessWorkspace, type EmbeddedHarness } from "./harness";
import { finishPresentation, PresentationTasks } from "./presentation-lifetime";
import type {
  ManagedCloneOperation,
  ManagedGitHubStatus,
  ManagedHostStatus,
  ModelCatalog,
} from "../src/app/types/api";

export const composedWidths = [1440, 768, 390, 195] as const;
export const composedBranch = "feature/qualification-with-long-branch-and-clear-return-context";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Shared owned workspace for an API-seeded view and its matching public journey. */
export async function initializeComposedWorkspace(
  harness: EmbeddedHarness,
  packed: boolean,
  width: number,
) {
  const matchedRoot = process.env.NAC_PRESENTATION_MATCHED_WORKSPACE_ROOT;
  if (matchedRoot && (!path.isAbsolute(matchedRoot) || path.resolve(matchedRoot) !== matchedRoot))
    throw new Error("Matched workspace root must be an absolute canonical owned path");
  if (matchedRoot) {
    const directory = await fs.lstat(matchedRoot);
    const marker = path.join(matchedRoot, ".nac-all527-owned");
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (await fs.lstat(marker)).isSymbolicLink() ||
      (await fs.readFile(marker, "utf8")) !== matchedRoot + "\n"
    )
      throw new Error("Matched workspace root lacks its exclusive ownership marker");
  }
  const folder = matchedRoot
    ? path.join(
        matchedRoot,
        packed ? "packed" : "standalone",
        String(width),
        "qualification-project",
      )
    : path.join(harness.runRoot, "qualification-project");
  await initializeHarnessWorkspace(folder);
  return folder;
}

/** Controlled external snapshots, not managed controllers or product state diagnostics. */
export async function installComposedFixture(
  page: Page,
  request: APIRequestContext,
  harness: EmbeddedHarness,
  endpoint: string,
  width: number,
) {
  const api = new URL(endpoint);
  const prefix = api.pathname.replace(/\/$/, "");
  const resource = (url: URL) =>
    url.origin === api.origin && url.pathname.startsWith(prefix + "/")
      ? decodeURIComponent(url.pathname.slice(prefix.length))
      : null;
  const folder = await initializeComposedWorkspace(harness, Boolean(prefix), width);
  const response = await request.get(`${harness.baseUrl}/models`);
  expect(response.ok()).toBe(true);
  const catalog = (await response.json()) as ModelCatalog;
  const provider = catalog.providers.find((item) => item.id === "openai-responses");
  if (!provider?.models.length)
    throw new Error("Scripted qualification needs the existing OpenAI catalog contract");
  const models = [
    { ...provider.models[0], id: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" },
    {
      ...provider.models[0],
      id: "gpt-5.6-terra",
      display_name: "GPT-5.6 Terra — long qualification model with readable metadata",
    },
  ];
  const modelFixture: ModelCatalog = {
    ...catalog,
    providers: [
      {
        ...provider,
        auth_status: "ready",
        connection: { base_url: harness.provider.baseUrl, api_key_env: "NAC_E2E_API_KEY" },
        default_base_url: harness.provider.baseUrl,
        managed_base_url: null,
        models,
      },
    ],
  };
  const catalogGate = gate(),
    projectGate = gate(),
    secretGate = gate(),
    loginGate = gate(),
    mcpGate = gate();
  if (width !== 768) catalogGate.release();
  const calls: { method: string; path: string; binding: string | null }[] = [];
  const state = {
    managed: false,
    connected: false,
    projectAttempts: 0,
    sessionCreates: 0,
    configWrites: 0,
    secretWrites: 0,
    loginStarts: 0,
    cloneStarts: 0,
    cloneCancels: 0,
    mcpTests: 0,
    projectPending: false,
    secretPending: false,
    cloneCancelled: false,
    managedReads: 0,
    configured: width !== 768,
    savedNames: [] as string[],
  };
  const github = (): ManagedGitHubStatus => ({
    configured: state.configured,
    connected: state.connected,
    git_configured: state.connected,
    login: state.connected ? "qualification" : null,
    name: state.connected ? "Controlled qualification account" : null,
  });
  const host = (): ManagedHostStatus => ({
    managed: state.managed,
    ready: state.managed,
    logical_host_id: state.managed ? "Controlled host readiness" : "Unconfigured fixture host",
    owner: "fixture@example.test",
    public_hostname: "qualification.example.test",
    repository_root: "/repositories",
    version: "0.0.0",
    product_version: "0.0.0",
    build_id: "CONTROLLED-VISUAL-DATA-NOT-PRODUCER",
    source_revision: "f".repeat(40),
    build_track: "fixture",
    schema_version: 1,
    supported_schema_version: 1,
    minimum_migratable_schema_version: 0,
    migration_state: "ready",
    maintenance_state: "serving",
    model_ready: state.managed,
    model: {
      backend: "openai-responses",
      id: "gpt-5.6-sol",
      endpoint: harness.provider.baseUrl,
      display_name: "Controlled scripted provider",
    },
    github_status: state.connected ? "connected" : "disconnected",
    secret_count: state.savedNames.length,
    project_count: 1,
    session_count: 1,
    checks: [
      {
        name: "Controlled readiness",
        ready: state.managed,
        detail:
          width === 768
            ? "Upgrade authorization is denied; clone staging can still be cancelled and cleaned."
            : "Host ready; external upgrade service is unavailable. No operation runs on mount.",
      },
    ],
  });
  const clone = (): ManagedCloneOperation => ({
    version: 1,
    operation_id: "qualification-clone",
    repository_id: 42,
    repository: "arcee-ai/qualification",
    source_identity: "github:42:arcee-ai/qualification",
    branch: composedBranch,
    destination: "/repositories/qualification",
    project_id: "unpublished-qualification-project",
    project_name: "qualification",
    status: state.cloneCancelled ? "cancelled" : "running",
    progress: state.cloneCancelled
      ? "Clone cancelled; staging checkout removed"
      : "Controlled clone pending; no repository is published",
    reused_existing_checkout: false,
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
  });
  const tasks = new PresentationTasks();
  const match = (url: URL) => resource(url) !== null;
  const handler = (route: Route) => {
    const task = (async () => {
      const request = route.request(),
        method = request.method(),
        name = resource(new URL(request.url()))!;
      calls.push({ method, path: name, binding: request.headers()["x-fixture-binding"] ?? null });
      if (name === "/models" && method === "GET") {
        await catalogGate.promise;
        return route.fulfill({ json: modelFixture });
      }
      if (name === "/providers/models" && method === "POST")
        return route.fulfill({
          json: {
            base_url: harness.provider.baseUrl,
            models: models.map(({ id, display_name }) => ({ id, display_name })),
          },
        });
      if (name === "/store" && method === "GET") {
        const actual = await route.fetch();
        return route.fulfill({
          response: actual,
          json: { ...(await actual.json()), root_cwd: folder },
        });
      }
      if (name === "/projects" && method === "POST") {
        state.projectAttempts += 1;
        if (width === 768 && state.projectAttempts === 1)
          return route.fulfill({
            status: 400,
            json: { error: "Choose a valid Git working folder." },
          });
        state.projectPending = true;
        await projectGate.promise;
        return route.fallback();
      }
      if (name === "/sessions" && method === "POST") state.sessionCreates += 1;
      if (/^\/sessions\/[^/]+\/config$/.test(name) && method === "PATCH") {
        state.configWrites += 1;
        if (width === 768 && state.configWrites === 1)
          return route.fulfill({
            status: 400,
            json: { error: "Configured Deny: review this setting before retrying." },
          });
      }
      if (name === "/mcp_library/library" && method === "GET")
        return route.fulfill({ json: { entries: [] } });
      if (name === "/mcp_library/servers/test" && method === "POST") {
        state.mcpTests += 1;
        if (state.mcpTests > 1) await mcpGate.promise;
        return route.fulfill({
          json: {
            connected: true,
            tools: [{ name: "fixture_echo", description: "Inert local fixture" }],
            error: null,
          },
        });
      }
      if (name === "/managed/status" && method === "GET") {
        state.managedReads += 1;
        // Before managed setup exists, match the optional product endpoint.
        // A 200 unready model matching the local launch route would gate launch.
        return state.managed
          ? route.fulfill({ json: host() })
          : route.fulfill({ status: 404, json: { error: "Managed host is not configured" } });
      }
      if (name === "/managed/github" && method === "GET") return route.fulfill({ json: github() });
      if (name === "/managed/github/login" && method === "POST") {
        state.loginStarts += 1;
        if (!state.configured) {
          state.configured = true;
          return route.fulfill({
            status: 403,
            json: { error: "Configured Deny: GitHub connection is unavailable." },
          });
        }
        return route.fulfill({
          json: {
            login_id: "qualification-login",
            verification_uri: `${harness.baseUrl}/health`,
            user_code: "TEST-CODE",
            expires_in_secs: 900,
          },
        });
      }
      if (name === "/managed/github/login/qualification-login" && method === "GET") {
        await loginGate.promise;
        state.connected = true;
        return route.fulfill({ json: { state: "complete", auth: github() } });
      }
      if (name === "/managed/secrets" && method === "GET")
        return route.fulfill({
          json: {
            healthy: true,
            secrets: state.savedNames.map((name) => ({ name, updated_at_unix_ms: 1 })),
          },
        });
      if (name.startsWith("/managed/secrets/") && method === "PUT") {
        state.secretWrites += 1;
        state.secretPending = true;
        const secretName = name.slice("/managed/secrets/".length);
        await secretGate.promise;
        state.savedNames.push(secretName);
        return route.fulfill({ json: { name: secretName, updated_at_unix_ms: 1 } });
      }
      if (name === "/managed/github/repositories" && method === "GET")
        return route.fulfill({
          json: {
            repositories: [
              {
                id: 42,
                name: "qualification",
                full_name: "arcee-ai/qualification",
                private: true,
                can_read: true,
                can_write: true,
                default_branch: "main",
                clone_url: "https://github.example.test/qualification.git",
                html_url: "https://github.example.test/qualification",
              },
            ],
          },
        });
      if (name.endsWith("/qualification/branches") && method === "GET")
        return route.fulfill({ json: { branches: ["main", composedBranch] } });
      if (name === "/managed/github/clone-operations" && method === "POST") {
        const body = request.postDataJSON() as { branch: string };
        expect(body.branch).toBe(composedBranch);
        state.cloneStarts += 1;
        return route.fulfill({ json: clone() });
      }
      if (name === "/managed/github/clone-operations/qualification-clone") {
        if (method === "DELETE") {
          state.cloneCancels += 1;
          state.cloneCancelled = true;
        }
        return route.fulfill({ json: clone() });
      }
      if (name === "/__managed/control/v0/upgrade")
        return route.fulfill({
          status: width === 768 ? 403 : 503,
          json: {
            reason: "Unavailable",
            error: "Controlled upgrade boundary is unavailable; no operation is admitted.",
          },
        });
      if (name.startsWith("/managed/") && method !== "GET")
        throw new Error(`Unexpected managed operation: ${method} ${name}`);
      return route.fallback();
    })();
    return tasks.track(task);
  };
  await page.route(match, handler);
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    for (const item of [catalogGate, projectGate, secretGate, loginGate, mcpGate]) item.release();
  };
  let disposal: Promise<void> | undefined;
  const release = () =>
    (disposal ??= finishPresentation(
      [],
      [unlock, () => tasks.drain(), () => page.unroute(match, handler), () => tasks.drain()],
    ));
  return {
    folder,
    resource,
    calls,
    state,
    catalogGate,
    projectGate,
    secretGate,
    loginGate,
    mcpGate,
    unlock,
    release,
  };
}

export type ComposedFixture = Awaited<ReturnType<typeof installComposedFixture>>;
export type Journey = {
  page: Page;
  root: Locator;
  request: APIRequestContext;
  harness: EmbeddedHarness;
  fixture: ComposedFixture;
  width: number;
  info: TestInfo;
  transport?: "standalone" | "packed";
};

/** The trigger's current value is not a stable locator; field ownership is. */
export function primaryModelTrigger(form: Locator, legacy = false) {
  if (legacy)
    return form
      .getByText("Primary model", { exact: true })
      .locator("..")
      .locator("..")
      .getByRole("button", { expanded: false })
      .first();
  return form
    .getByRole("region", { name: "Primary model", exact: true })
    .getByRole("group", { name: "Model*", exact: true })
    .getByRole("button");
}

/** Tablet navigation starts in a real collapsed rail, independently per instance. */
export async function revealDesktopSidebar(root: Locator) {
  const show = root.getByRole("button", { name: "Show sidebar", exact: true });
  if (await show.isVisible()) await show.click();
}

export async function activate(j: Journey, control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.scrollIntoViewIfNeeded();
  if (j.width <= 390) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    const hit = await control.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const doc = node.ownerDocument;
      const at = doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const root = node.closest("[data-nac-runtime]");
      const dialog = node.closest('[role="dialog"]');
      return {
        centerHit: at === node || (at !== null && node.contains(at)),
        rect: rect.toJSON(),
        root: root?.getBoundingClientRect().toJSON(),
        hitElement: at?.outerHTML.slice(0, 1200),
        footers: Array.from(dialog?.querySelectorAll("footer") ?? []).map((footer) =>
          (footer as typeof node).getBoundingClientRect().toJSON(),
        ),
      };
    });
    if (!hit.centerHit)
      await j.info.attach("activation center-hit failure", {
        contentType: "application/json",
        body: JSON.stringify(hit),
      });
    assertComposedHit(j, bounds!, hit.centerHit);
  }
  await control.click();
}

export async function menuAction(j: Journey, name: string | RegExp) {
  const menu = j.root.getByRole("button", { name: "Open the menu", exact: true });
  if (j.width < 768) await activate(j, menu);
  else await revealDesktopSidebar(j.root);
  await activate(j, j.root.getByRole("button", { name, exact: typeof name === "string" }).first());
}

function assertComposedHit(
  j: Journey,
  bounds: { x: number; width: number; height: number },
  centerHit: boolean,
) {
  expect(bounds.height).toBeGreaterThanOrEqual(43.5);
  expect(bounds.width).toBeGreaterThanOrEqual(43.5);
  expect(bounds.x).toBeGreaterThanOrEqual(-0.5);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(j.width + 0.5);
  expect(centerHit).toBe(true);
}

/** Passive evidence before the unchanged strict document-width oracle. */
export async function recordPackedOverflow(j: Journey, stage: string) {
  const result = await j.page.locator("html").evaluate(async (html) => {
    const doc = html.ownerDocument;
    const view = doc.defaultView!;
    await doc.fonts.ready;
    await new Promise<void>((done) =>
      view.requestAnimationFrame(() => view.requestAnimationFrame(() => done())),
    );
    const width = view.innerWidth;
    const documentWidth = html.scrollWidth;
    const scrollX = view.scrollX;
    const nodes = [];
    for (const node of doc.querySelectorAll("*")) {
      nodes.push({
        tag: node.tagName,
        id: node.id,
        label: node.getAttribute("aria-label"),
        className: node.getAttribute("class"),
        rect: node.getBoundingClientRect().toJSON(),
        parent: node.parentElement?.tagName,
        hidden: node.closest('[aria-hidden="true"]') !== null,
        runtime: node.closest("[data-nac-runtime]")?.getAttribute("data-nac-runtime"),
        overflowX: view.getComputedStyle(node).overflowX,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      });
    }
    return { width, documentWidth, scrollX, nodes };
  });
  await j.info.attach(stage, { contentType: "application/json", body: JSON.stringify(result) });
  expect(result.width).toBe(j.width);
  expect(result.documentWidth).toBeLessThanOrEqual(result.width);
}

/** ONLY the first packed390 model reading leg; no generic fallback or DOM scrolling. */
export async function activatePacked390Model(j: Journey, form: Locator, model: Locator) {
  if (j.transport !== "packed" || j.width !== 390) throw new Error("Wrong reading-leg scope");
  await expect(model).toBeVisible();
  await expect(model).toBeEnabled();
  await j.page.locator("html").evaluate(async (html) => {
    const view = html.ownerDocument.defaultView!;
    await html.ownerDocument.fonts.ready;
    await new Promise<void>((done) =>
      view.requestAnimationFrame(() => view.requestAnimationFrame(() => done())),
    );
  });
  const body = form.locator(":scope > div.overflow-auto > div.overflow-auto");
  await expect(body).toHaveCount(1);
  const target = await model.elementHandle();
  const owner = await body.elementHandle();
  if (!target || !owner) {
    const missing = new Error("Original target/body unavailable");
    await Promise.allSettled([
      Promise.resolve().then(() => target?.dispose()),
      Promise.resolve().then(() => owner?.dispose()),
    ]);
    throw missing;
  }
  const counters = () => ({
    projectAttempts: j.fixture.state.projectAttempts,
    sessionCreates: j.fixture.state.sessionCreates,
    configWrites: j.fixture.state.configWrites,
    secretWrites: j.fixture.state.secretWrites,
    loginStarts: j.fixture.state.loginStarts,
    cloneStarts: j.fixture.state.cloneStarts,
    cloneCancels: j.fixture.state.cloneCancels,
    mcpTests: j.fixture.state.mcpTests,
    generations: j.harness.provider.requests.length,
  });
  const beforeCounters = counters();
  const callsBefore = j.fixture.calls.length;
  const observations: unknown[] = [];
  let wheelInputs = 0;
  let wheelPoint: { x: number; y: number } | null = null;
  let wheelEvent: unknown = null;
  let clickAttempted = false;
  let clickCompleted = false;
  const read = async () => {
    const state = await target.evaluate((node, owned) => {
      const doc = node.ownerDocument;
      const view = doc.defaultView!;
      const rect = node.getBoundingClientRect();
      const at = doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const dialog = node.closest('[role="dialog"]');
      const footer = dialog?.querySelector(":scope > footer");
      const ancestors = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        ancestors.push({
          tag: parent.tagName,
          className: parent.className,
          rect: parent.getBoundingClientRect().toJSON(),
          scrollTop: parent.scrollTop,
          clientHeight: parent.clientHeight,
          scrollHeight: parent.scrollHeight,
        });
        if (parent === dialog) break;
      }
      return {
        connected: node.isConnected && owned.isConnected,
        owned: owned.contains(node) && owned.ownerDocument === doc,
        rect: rect.toJSON(),
        centerHit: at === node || (at !== null && node.contains(at)),
        footerHit: !!footer && !!at && (at === footer || footer.contains(at)),
        hitElement: at?.outerHTML.slice(0, 1200),
        ancestors,
        root: node.closest("[data-nac-runtime]")?.getBoundingClientRect().toJSON(),
        dialog: dialog?.getBoundingClientRect().toJSON(),
        header: dialog?.querySelector(":scope > header")?.getBoundingClientRect().toJSON(),
        footer: footer?.getBoundingClientRect().toJSON(),
        body: owned.getBoundingClientRect().toJSON(),
        scrollTop: owned.scrollTop,
        scrollHeight: owned.scrollHeight,
        clientHeight: owned.clientHeight,
        width: view.innerWidth,
        height: view.innerHeight,
        documentWidth: doc.documentElement.scrollWidth,
        pageScrollY: view.scrollY,
      };
    }, owner);
    observations.push(state);
    return state;
  };
  let primaryFailed = false;
  let primaryFailure: unknown;
  const diagnostics: { step: string; reason: unknown }[] = [];
  let stopWheel: (() => Promise<unknown>) | undefined;
  let disposeWheel: (() => Promise<unknown>) | undefined;
  try {
    const before = await read();
    expect(before.connected && before.owned).toBe(true);
    expect(before.width).toBe(j.width);
    expect(before.documentWidth).toBeLessThanOrEqual(before.width);
    expect(before.rect.height).toBeGreaterThanOrEqual(43.5);
    expect(before.rect.width).toBeGreaterThanOrEqual(43.5);
    expect(before.rect.x).toBeGreaterThanOrEqual(-0.5);
    expect(before.rect.x + before.rect.width).toBeLessThanOrEqual(j.width + 0.5);
    if (!before.centerHit) {
      if (!before.footerHit || !before.footer || !before.dialog)
        throw new Error("Original target is not occluded by its own footer; no input fallback");
      const left = Math.max(0, before.body.left, before.dialog.left) + 8;
      const right = Math.min(j.width, before.body.right, before.dialog.right) - 8;
      const top = Math.max(0, before.body.top, before.header?.bottom ?? 0) + 8;
      const bottom = Math.min(before.height, before.body.bottom, before.footer.top) - 8;
      if (right <= left || bottom <= top || before.scrollHeight <= before.clientHeight)
        throw new Error("No visible scrollable owned body");
      const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
      expect(
        await owner.evaluate((node, p) => {
          const at = node.ownerDocument.elementFromPoint(p.x, p.y);
          return !!at && (at === node || node.contains(at));
        }, point),
      ).toBe(true);
      wheelPoint = point;
      // This passive listener exposes only this input event, not product/cache state.
      const wheel = await owner.evaluateHandle((node) => {
        const events: { trusted: boolean; x: number; y: number }[] = [];
        const listener = (event: Event) => {
          const value = event as Event & { deltaX: number; deltaY: number };
          events.push({ trusted: value.isTrusted, x: value.deltaX, y: value.deltaY });
        };
        node.addEventListener("wheel", listener, { passive: true });
        return { events, stop: () => node.removeEventListener("wheel", listener) };
      });
      stopWheel = () => wheel.evaluate((record) => record.stop());
      disposeWheel = () => wheel.dispose();
      await j.page.mouse.move(point.x, point.y);
      wheelInputs = 1;
      await j.page.mouse.wheel(0, 120);
      await expect
        .poll(() => wheel.evaluate((record) => record.events.length), { timeout: 2000 })
        .toBe(1);
      wheelEvent = await wheel.evaluate((record) => record.events[0]);
      expect(wheelEvent).toEqual({ trusted: true, x: 0, y: 120 });
      await expect
        .poll(
          async () => {
            const state = await read();
            return state.scrollTop > before.scrollTop && state.centerHit;
          },
          { timeout: 2000 },
        )
        .toBe(true);
    }
    const after = await read();
    expect(after.connected && after.owned).toBe(true);
    expect(after.width).toBe(j.width);
    expect(after.documentWidth).toBeLessThanOrEqual(after.width);
    expect(after.pageScrollY).toBe(before.pageScrollY);
    assertComposedHit(j, after.rect, after.centerHit);
    expect(counters()).toEqual(beforeCounters);
    expect(await target.isVisible()).toBe(true);
    expect(await target.isEnabled()).toBe(true);
    clickAttempted = true;
    await target.click();
    clickCompleted = true;
  } catch (error) {
    primaryFailed = true;
    primaryFailure = error;
    try {
      await read();
    } catch (reason) {
      diagnostics.push({ step: "failure-geometry", reason });
    }
  } finally {
    // Stop observing BEFORE disposing the wheel handle; still try every disposal if stop fails.
    const results = [
      ...(await Promise.allSettled([Promise.resolve().then(() => stopWheel?.())])),
      ...(await Promise.allSettled([
        Promise.resolve().then(() => disposeWheel?.()),
        Promise.resolve().then(() => target.dispose()),
        Promise.resolve().then(() => owner.dispose()),
      ])),
    ];
    const labels = ["wheel.stop", "wheel.dispose", "target.dispose", "owner.dispose"];
    results.forEach((result, index) => {
      if (result.status === "rejected")
        diagnostics.push({ step: labels[index]!, reason: result.reason });
    });
    // Serialize/attach inside a settled promise too: either may throw, including undefined.
    const [attachment] = await Promise.allSettled([
      Promise.resolve().then(() =>
        j.info.attach("packed390-original-model-reading", {
          contentType: "application/json",
          body: JSON.stringify({
            wheelInputs,
            wheelPoint,
            wheelEvent,
            binaryPath: j.harness.binaryPath,
            recovered: wheelInputs === 1 && clickCompleted,
            clickAttempted,
            clickCompleted,
            observations,
            beforeCounters,
            afterCounters: counters(),
            callsDuringLeg: j.fixture.calls.slice(callsBefore),
            primaryFailed,
            failure: primaryFailed ? String(primaryFailure) : null,
            cleanupDiagnostics: diagnostics.map(({ step, reason }) => ({
              step,
              reason: String(reason),
            })),
          }),
        }),
      ),
    ]);
    if (attachment?.status === "rejected")
      diagnostics.push({ step: "evidence-attachment", reason: attachment.reason });
  }
  // The boolean preserves an actual thrown undefined and the original value/identity.
  if (primaryFailed) throw primaryFailure;
  if (diagnostics.length)
    throw new AggregateError(
      diagnostics.map(({ reason }) => reason),
      "Packed390 reading-leg cleanup/evidence failed",
    );
}

export async function captureComposed(j: Journey, state: string) {
  await j.page.evaluate(async () => {
    const browser = globalThis as unknown as {
      document: { fonts: { ready: Promise<unknown> } };
      requestAnimationFrame: (fn: () => void) => void;
    };
    await browser.document.fonts.ready;
    await new Promise<void>((done) =>
      browser.requestAnimationFrame(() => browser.requestAnimationFrame(done)),
    );
  });
  const environment = await j.page.evaluate(() => {
    const browser = globalThis as unknown as {
      innerWidth: number;
      innerHeight: number;
      devicePixelRatio: number;
      scrollY: number;
      document: {
        documentElement: { scrollWidth: number };
        querySelector: (
          selector: string,
        ) => { getAttribute: (name: string) => string | null } | null;
      };
      matchMedia: (query: string) => { matches: boolean };
    };
    return {
      width: browser.innerWidth,
      height: browser.innerHeight,
      dpr: browser.devicePixelRatio,
      scrollY: browser.scrollY,
      documentWidth: browser.document.documentElement.scrollWidth,
      theme: browser.document.querySelector("[data-nac-runtime]")?.getAttribute("data-theme"),
      reducedMotion: browser.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });
  expect(environment.width).toBe(j.width);
  expect(environment.documentWidth).toBeLessThanOrEqual(environment.width);
  const cdp = await j.page.context().newCDPSession(j.page);
  const file = j.info.outputPath(`${state}.png`);
  try {
    const image = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const bytes = Buffer.from(image.data, "base64");
    await fs.writeFile(file, bytes);
    await j.info.attach(`${state}-physical-viewport`, {
      body: JSON.stringify({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }),
      contentType: "application/json",
    });
    await j.info.attach(state, { path: file, contentType: "image/png" });
  } finally {
    await cdp.detach();
  }
  await j.info.attach(`${state}-semantics`, {
    body: await j.root.ariaSnapshot(),
    contentType: "text/plain",
  });
  await j.info.attach(`${state}-environment`, {
    body: JSON.stringify(environment),
    contentType: "application/json",
  });
}
