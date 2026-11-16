import type { Page, Request, Route, TestInfo } from "@playwright/test";

import { expect, test } from "./harness";
import { captureSetup, withSetupBaselines, setupBaseline } from "./setup-visual-fixture";
import { openNameZoom } from "./session-name-zoom";

test.use({ hasTouch: true });

/** The projects sidebar exposes Managed host directly; phones still use the menu. */
async function openManagedHost(page: Page) {
  const hosted = page.getByRole("button", { name: /^(Managed host|Manage Host)$/ });
  const menu = page.getByRole("button", { name: "Open the menu" });
  await expect(hosted.or(menu).first()).toBeVisible();
  if (await hosted.first().isVisible()) {
    await hosted.first().click();
    return;
  }
  await menu.click();
  await hosted.click();
}

async function inspectManagedClose(
  page: Page,
  info: TestInfo,
  dialogName: string,
  stage: string,
  assertMinimum = true,
) {
  const close = page
    .getByRole("dialog", { name: dialogName, exact: true })
    .getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeVisible();
  await expect(close).toBeInViewport();
  const geometry = await close.evaluate((element) => {
    type Rect = {
      x: number;
      y: number;
      width: number;
      height: number;
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    type Node = {
      parentElement: Node | null;
      getBoundingClientRect(): Rect;
      contains(node: unknown): boolean;
    };
    type Style = {
      width: string;
      height: string;
      minWidth: string;
      minHeight: string;
      padding: string;
      boxSizing: string;
      overflowX: string;
      overflowY: string;
    };
    const browser = globalThis as unknown as {
      innerWidth: number;
      innerHeight: number;
      devicePixelRatio: number;
      getComputedStyle(node: Node): Style;
      document: { elementFromPoint(x: number, y: number): unknown };
    };
    const node = element as unknown as Node;
    const rect = (value: Rect) => ({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      left: value.left,
    });
    const bounds = rect(node.getBoundingClientRect());
    const computed = browser.getComputedStyle(node);
    const wrapper = node.parentElement!;
    const wrapperStyle = browser.getComputedStyle(wrapper);
    const clip = { left: 0, top: 0, right: browser.innerWidth, bottom: browser.innerHeight };
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = browser.getComputedStyle(ancestor);
      const box = ancestor.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, box.left);
        clip.right = Math.min(clip.right, box.right);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, box.top);
        clip.bottom = Math.min(clip.bottom, box.bottom);
      }
    }
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const hitPoints = [
      [x, y],
      [bounds.left + 2, y],
      [bounds.right - 2, y],
      [x, bounds.top + 2],
      [x, bounds.bottom - 2],
    ].map(([x, y]) => ({
      x,
      y,
      hitsClose: node.contains(browser.document.elementFromPoint(x, y)),
    }));
    return {
      bounds,
      computed: {
        width: computed.width,
        height: computed.height,
        minWidth: computed.minWidth,
        minHeight: computed.minHeight,
        padding: computed.padding,
        boxSizing: computed.boxSizing,
      },
      wrapper: { bounds: rect(wrapper.getBoundingClientRect()), minHeight: wrapperStyle.minHeight },
      viewport: {
        width: browser.innerWidth,
        height: browser.innerHeight,
        devicePixelRatio: browser.devicePixelRatio,
      },
      clip,
      unclipped:
        bounds.left >= clip.left &&
        bounds.right <= clip.right &&
        bounds.top >= clip.top &&
        bounds.bottom <= clip.bottom,
      hitPoints,
    };
  });
  await info.attach(`managed-header-close-${stage}.json`, {
    body: JSON.stringify({ dialogName, stage, ...geometry }),
    contentType: "application/json",
  });
  if (assertMinimum) {
    expect(geometry.bounds.width).toBeGreaterThanOrEqual(44);
    expect(geometry.bounds.height).toBeGreaterThanOrEqual(44);
    expect(geometry.wrapper.bounds.height).toBeGreaterThanOrEqual(44);
    expect(geometry.unclipped).toBe(true);
    expect(geometry.hitPoints.every((point) => point.hitsClose)).toBe(true);
  }
  return geometry;
}

type ManagedDoubleState = {
  connected: boolean;
  loginPolls: number;
  clonePolls: number;
  projectReady: boolean;
  secrets: string[];
  cloneRequest: Record<string, unknown> | null;
  cloneBranch: string;
  providerRequests: Record<string, unknown>[];
  upgradeState: "available" | "blocked" | "replacing" | "verifying" | "succeeded" | "failed";
  upgradeStarts: number;
  upgradeBodies: string[];
  upgradeKeys: string[];
  upgradeFacadeStatus: number | null;
  terminalStops: string[];
};

const currentRelease = {
  release_id: "0-1-4",
  source_revision: "a".repeat(40),
  build_id: "managed-e2e-current",
  product_version: "0.1.4",
  schema_version: 24,
};

const latestRelease = {
  release_id: "0-2-0-beta-2",
  source_revision: "b".repeat(40),
  build_id: "managed-e2e-latest",
  product_version: "0.2.0-beta.2",
  schema_version: 25,
};

const upgradeOperation = (state: ManagedDoubleState) => {
  if (state.upgradeState === "available") return null;
  const blockers =
    state.upgradeState === "blocked"
      ? [
          {
            selection_key: `sha256:${"1".repeat(64)}`,
            kind: "terminal_process",
            message: "An active terminal process must finish before maintenance can start",
            actionable: true,
            action: "terminate_terminal",
            target: { session_id: "managed-upgrade-session", terminal_id: "shell-upgrade-1" },
          },
          {
            selection_key: `sha256:${"2".repeat(64)}`,
            kind: "compaction",
            message: "An active compaction must finish before maintenance can start",
            actionable: false,
            action: "wait",
            target: null,
          },
        ]
      : [];
  return {
    operation_id: `018f47a5-34a7-7c91-bf7e-${String(state.upgradeStarts).padStart(12, "0")}`,
    managed_host_id: "018f47a5-34a7-7c91-bf7e-8f1042757301",
    kind: "upgrade",
    state: state.upgradeState,
    reason: state.upgradeState === "failed" ? "VerificationFailed" : "UpgradeProgress",
    message:
      state.upgradeState === "failed"
        ? "The replacement could not be verified"
        : "The accepted release is progressing safely",
    target_release: latestRelease,
    blockers,
    created_at: "2026-09-09T12:00:00Z",
    updated_at: "2026-09-09T12:01:00Z",
  };
};

const upgradeSnapshot = (state: ManagedDoubleState) => ({
  preview: {
    current: state.upgradeState === "succeeded" ? latestRelease : currentRelease,
    latest_beta: latestRelease,
    upgrade_available: state.upgradeState !== "succeeded",
    distance: { accepted_releases: state.upgradeState === "succeeded" ? 0 : 2 },
  },
  operation: upgradeOperation(state),
});

const alternateBranch = "feature/platform.v2/long-prefix-hot-fix";
const branchFixture = [
  "main",
  ...Array.from(
    { length: 140 },
    (_, index) => `feature/generated-prefix-${String(index + 1).padStart(3, "0")}`,
  ),
  alternateBranch,
  "release",
];

const hostStatus = (state: ManagedDoubleState) => ({
  managed: true,
  ready: true,
  version: "0.1.3",
  product_version: "0.1.4",
  source_revision: currentRelease.source_revision,
  build_id: currentRelease.build_id,
  build_track: "beta",
  schema_version: 23,
  supported_schema_version: 25,
  minimum_migratable_schema_version: 0,
  opened_schema_version: 23,
  migration_state: "ready",
  migration_failure: null,
  maintenance_state: "serving",
  maintenance: null,
  logical_host_id: "managed-e2e-host",
  owner: "owner@example.test",
  public_hostname: "managed.example.test",
  repository_root: "/repositories",
  model_ready: true,
  model: {
    backend: "arcee-api",
    id: "trinity-large-thinking",
    endpoint: "https://api.arcee.ai/api/v1",
    display_name: "Managed Arcee",
  },
  github_status: state.connected ? "connected" : "disconnected",
  secret_count: state.secrets.length,
  project_count: 0,
  session_count: 0,
  checks: [
    { name: "store", ready: true, detail: "SQLite store is open and migrated" },
    { name: "runtime-tools", ready: true, detail: "required coding tools are present" },
  ],
});

const githubStatus = (state: ManagedDoubleState) => ({
  configured: true,
  connected: state.connected,
  login: state.connected ? "managed-e2e" : null,
  name: state.connected ? "Managed E2E" : null,
  avatar_url: null,
  organization: state.connected ? "arcee-ai" : null,
  expires_at_ms: state.connected ? Date.now() + 3_600_000 : null,
  git_name: state.connected ? "Managed E2E" : null,
  git_email: state.connected ? "managed-e2e@users.noreply.github.com" : null,
  git_configured: state.connected,
});

const cloneOperation = (
  state: ManagedDoubleState,
  status: "running" | "completed" | "cancelled",
) => ({
  version: 1,
  operation_id: "0123456789abcdef0123456789abcdef",
  status,
  repository_id: 42,
  repository: "arcee-ai/managed-demo",
  source_identity: "github:42:arcee-ai/managed-demo",
  branch: state.cloneBranch,
  destination: "/repositories/managed-demo",
  project_id: "managed-project-e2e",
  project_name: "managed-demo",
  project: null,
  progress:
    status === "running"
      ? "Cloning objects: 75%"
      : status === "completed"
        ? "Checkout published"
        : "Clone cancelled; staging checkout removed",
  error: null,
  reused_existing_checkout: false,
  created_at_unix_ms: Date.now(),
  updated_at_unix_ms: Date.now(),
});

async function installManagedDouble(page: Page, initiallyConnected = false) {
  const state: ManagedDoubleState = {
    connected: initiallyConnected,
    loginPolls: 0,
    clonePolls: 0,
    projectReady: false,
    secrets: [],
    cloneRequest: null,
    cloneBranch: "main",
    providerRequests: [],
    upgradeState: "available",
    upgradeStarts: 0,
    upgradeBodies: [],
    upgradeKeys: [],
    upgradeFacadeStatus: null,
    terminalStops: [],
  };
  await page.route(
    (url) => url.pathname === "/models",
    async (route: Route) => {
      return route.fulfill({
        json: {
          catalog_version: 1,
          providers: [
            {
              id: "arcee-api",
              auth: "api_key_env",
              auth_status: "ready",
              auth_hint: null,
              default_base_url: "https://api.arcee.ai/api/v1",
              managed_base_url: null,
              default_limits: {
                context_window: 128000,
                max_tokens: 4096,
                supported_efforts: [],
              },
              models: [
                {
                  id: "trinity-large-thinking",
                  display_name: "Trinity-Large-Thinking",
                  context_window: 128000,
                  max_tokens: 4096,
                  cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
                  reasoning: true,
                  supported_efforts: [],
                  source: "baseline",
                },
              ],
            },
          ],
        },
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/providers/models",
    async (route: Route) => {
      state.providerRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        json: {
          base_url: "https://api.arcee.ai/api/v1",
          models: [
            { id: "trinity-large-thinking", display_name: "Trinity-Large-Thinking" },
            { id: "moonshotai/kimi-k3", display_name: "Kimi K3" },
          ],
        },
      });
    },
  );
  await page.route("**/projects", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      json: {
        projects: state.projectReady
          ? [
              {
                project_id: "managed-project-e2e",
                name: "managed-demo",
                description: null,
                cwd: "/repositories/managed-demo",
                ssh_host: null,
                ssh_port: null,
                ssh_identity_file: null,
                default_model_config_id: null,
                created_at: "2026-08-27T00:00:00Z",
                updated_at: "2026-08-27T00:00:00Z",
                pinned: false,
                sort_order: 0,
                presentation_version: 0,
              },
            ]
          : [],
      },
    });
  });
  await page.route("**/managed/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (method === "GET" && path === "/managed/status") {
      return route.fulfill({ json: hostStatus(state) });
    }
    if (path === "/managed/github" && method === "GET") {
      return route.fulfill({ json: githubStatus(state) });
    }
    if (path === "/managed/github" && method === "DELETE") {
      state.connected = false;
      return route.fulfill({ json: githubStatus(state) });
    }
    if (path === "/managed/github/login" && method === "POST") {
      state.loginPolls = 0;
      return route.fulfill({
        json: {
          login_id: "managed-login-e2e",
          verification_uri: "https://github.com/login/device",
          user_code: "ABCD-EFGH",
          expires_in_secs: 900,
        },
      });
    }
    if (path === "/managed/github/login/managed-login-e2e" && method === "GET") {
      state.loginPolls += 1;
      if (state.loginPolls < 2) return route.fulfill({ json: { state: "pending" } });
      state.connected = true;
      return route.fulfill({ json: { state: "complete", auth: githubStatus(state) } });
    }
    if (path === "/managed/github/login/managed-login-e2e" && method === "DELETE") {
      return route.fulfill({ status: 204 });
    }
    if (path === "/managed/github/repositories" && method === "GET") {
      return route.fulfill({
        json: {
          repositories: [
            {
              id: 42,
              name: "managed-demo",
              full_name: "arcee-ai/managed-demo",
              private: true,
              can_read: true,
              can_write: true,
              default_branch: "main",
              clone_url: "https://github.com/arcee-ai/managed-demo.git",
              html_url: "https://github.com/arcee-ai/managed-demo",
            },
          ],
        },
      });
    }
    if (path === "/managed/github/repositories/arcee-ai/managed-demo/branches") {
      return route.fulfill({ json: { branches: branchFixture } });
    }
    if (path === "/managed/github/clone-operations" && method === "POST") {
      state.cloneRequest = request.postDataJSON() as Record<string, unknown>;
      state.cloneBranch = String(state.cloneRequest.branch);
      state.clonePolls = 0;
      return route.fulfill({ json: cloneOperation(state, "running") });
    }
    if (path === "/managed/github/clone-operations/0123456789abcdef0123456789abcdef") {
      if (method === "DELETE") {
        return route.fulfill({ json: cloneOperation(state, "cancelled") });
      }
      state.clonePolls += 1;
      const status = state.clonePolls < 2 ? "running" : "completed";
      if (status === "completed") state.projectReady = true;
      return route.fulfill({
        json: cloneOperation(state, status),
      });
    }
    if (path === "/managed/secrets" && method === "GET") {
      return route.fulfill({
        json: {
          healthy: true,
          secrets: state.secrets.map((name) => ({ name, updated_at_unix_ms: Date.now() })),
        },
      });
    }
    if (path.startsWith("/managed/secrets/") && method === "PUT") {
      const name = decodeURIComponent(path.slice("/managed/secrets/".length));
      if (!state.secrets.includes(name)) state.secrets.push(name);
      return route.fulfill({ json: { name, updated_at_unix_ms: Date.now() } });
    }
    if (path.startsWith("/managed/secrets/") && method === "DELETE") {
      const name = decodeURIComponent(path.slice("/managed/secrets/".length));
      state.secrets = state.secrets.filter((candidate) => candidate !== name);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 404,
      json: { error: `unhandled managed double ${method} ${path}` },
    });
  });
  await page.route(
    (url) => url.pathname === "/__managed/control/v0/upgrade",
    async (route: Route) => {
      const request = route.request();
      if (state.upgradeFacadeStatus !== null) {
        return route.fulfill({
          status: state.upgradeFacadeStatus,
          contentType: "application/problem+json",
          json: {
            title: "Managed upgrade unavailable",
            detail: "The managed control facade rejected this request",
          },
        });
      }
      if (request.method() === "GET") {
        return route.fulfill({
          status: 200,
          headers: { "Cache-Control": "no-store" },
          json: upgradeSnapshot(state),
        });
      }
      if (request.method() === "POST") {
        state.upgradeStarts += 1;
        state.upgradeBodies.push(request.postData() ?? "");
        state.upgradeKeys.push(request.headers()["idempotency-key"] ?? "");
        state.upgradeState = state.upgradeState === "failed" ? "verifying" : "blocked";
        return route.fulfill({ status: 202, json: upgradeOperation(state) });
      }
      return route.fulfill({ status: 405 });
    },
  );
  await page.route(
    (url) => url.pathname === "/sessions/managed-upgrade-session/terminals/shell-upgrade-1",
    async (route: Route) => {
      state.terminalStops.push(route.request().method());
      state.upgradeState = "replacing";
      return route.fulfill({ status: 204 });
    },
  );
  return state;
}

test("completes the managed first-run, write-only secret, and clone journey", async ({
  harness,
  page,
}) => {
  const state = await installManagedDouble(page);
  await page.goto(harness.baseUrl);

  await expect(page.getByTestId("managed-empty-status")).toContainText("Arcee model");
  await expect(page.getByTestId("managed-empty-status")).toContainText("Not connected");
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page.getByRole("dialog")).toContainText("New Project");
  await expect(page.getByRole("button", { name: /Trinity-Large-Thinking/ })).toBeVisible();
  await expect(page.getByText("Detected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Trinity-Large-Thinking/ }).click();
  await page.getByRole("button", { name: /Kimi K3/ }).click();
  await expect(page.getByRole("button", { name: /Kimi K3/ })).toBeVisible();
  await expect
    .poll(() => state.providerRequests)
    .toEqual([
      {
        backend: "arcee-api",
        base_url: "https://api.arcee.ai/api/v1",
      },
    ]);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add repository" }).first().click();
  await expect(page.getByTestId("managed-github-settings")).toBeVisible();
  await page
    .getByTestId("managed-github-settings")
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  await expect(page.getByTestId("github-device-code")).toContainText("ABCD-EFGH");
  await expect(page.getByTestId("managed-repository-modal")).toBeVisible();
  await expect(page.getByRole("button", { name: /arcee-ai\/managed-demo/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await openManagedHost(page);
  await page.getByRole("button", { name: "secrets", exact: true }).click();
  await page.getByLabel("Variable name").fill("DEMO_SERVICE_TOKEN");
  await page.getByLabel("New value").fill("browser-e2e-secret-value");
  await page.getByRole("button", { name: "Save secret" }).click();
  await expect(page.getByText("DEMO_SERVICE_TOKEN")).toBeVisible();
  await expect(page.getByText("browser-e2e-secret-value")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Add repository" }).first().click();
  await page.getByLabel("Find repository").fill("managed-demo");
  await page.getByRole("button", { name: /arcee-ai\/managed-demo/ }).click();
  await expect(page.getByText("/repositories/managed-demo")).toBeVisible();
  await expect(page.getByRole("button", { name: "Branch: main", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Branch: main", exact: true }).click();
  await page.getByRole("combobox", { name: "Find branch" }).fill("LONG-PREFIX");
  await page.getByRole("option", { name: alternateBranch }).click();
  await page.getByRole("button", { name: "Clone repository" }).click();
  await expect(page.getByText("Cloning objects: 75%")).toBeVisible();
  await expect(page).toHaveURL(/#\/project\/managed-project-e2e$/);
  expect(state.cloneRequest).toEqual({
    repository_id: 42,
    repository: "arcee-ai/managed-demo",
    branch: alternateBranch,
    destination: "managed-demo",
    project_name: "managed-demo",
    project_description: null,
  });
});

test("keeps GitHub Connected visible after device authorization and reopening settings", async ({
  harness,
  page,
}, testInfo) => {
  await installManagedDouble(page);
  await page.goto(harness.baseUrl);
  const openGitHub = async () => {
    await openManagedHost(page);
    await page.getByRole("button", { name: "GitHub", exact: true }).click();
  };
  await openGitHub();
  const panel = page.getByTestId("managed-github-settings");
  await panel.getByRole("button", { name: "Connect GitHub", exact: true }).click();
  await expect(page.getByTestId("github-device-code")).toBeVisible();
  await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
  await expect(panel.getByText("@managed-e2e", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Connect GitHub", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Reconnect GitHub" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await openGitHub();
  await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub connected", { exact: true })).toHaveCount(0);
  const screenshot = testInfo.outputPath("github-connected.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await testInfo.attach("GitHub connected — persistent desktop state", {
    path: screenshot,
    contentType: "image/png",
  });
});

function linkBrowserEvents(page: Page) {
  const events: Array<Record<string, unknown>> = [];
  page.on("console", (message) => {
    events.push({ kind: "console", type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    events.push({ kind: "pageerror", message: error.message });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const url = new URL(response.url());
      events.push({
        kind: "http-error",
        origin: url.origin,
        path: url.pathname,
        status: response.status(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    events.push({
      kind: "requestfailed",
      origin: url.origin,
      path: url.pathname,
      error: request.failure()?.errorText,
    });
  });
  return events;
}

async function attachLinkBrowserEvents(info: TestInfo, events: Array<Record<string, unknown>>) {
  await info.attach("external-link browser console and request failures", {
    body: JSON.stringify(events, null, 2),
    contentType: "application/json",
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`GitHub retry is a keyboard link on the same pending attempt at ${viewport.width}`, async ({
    harness,
    page,
    context,
  }, info) => {
    const browserEvents = linkBrowserEvents(page);
    await page.setViewportSize(viewport);
    await installManagedDouble(page);
    let starts = 0;
    let canceled = 0;
    await page.route(`${harness.baseUrl}/managed/github/login`, async (route) => {
      starts += 1;
      await route.fallback();
    });
    await page.route(`${harness.baseUrl}/managed/github/login/managed-login-e2e`, async (route) => {
      if (route.request().method() === "DELETE") {
        canceled += 1;
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: { state: "pending" } });
    });
    await context.route("https://github.com/login/device", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Owned GitHub double</title>",
      }),
    );
    await page.goto(harness.baseUrl);
    if (viewport.width === 390) {
      await page.getByRole("button", { name: "Open the menu", exact: true }).click();
      await page
        .getByRole("navigation", { name: "Menu", exact: true })
        .getByRole("button", { name: "Manage Host", exact: true })
        .click();
    } else {
      await openManagedHost(page);
    }
    await page.getByRole("button", { name: "GitHub", exact: true }).click();
    const panel = page.getByTestId("managed-github-settings");
    await panel.getByRole("button", { name: "Connect GitHub", exact: true }).click();
    const link = panel.getByRole("link", { name: "Open GitHub", exact: true });
    await expect(link).toHaveAttribute("href", "https://github.com/login/device");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    await page.evaluate(() =>
      (
        globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
      ).document.fonts.ready.then(() => undefined),
    );
    const screenshot = info.outputPath(`github-retry-${viewport.width}.png`);
    await attachLinkBrowserEvents(info, browserEvents);
    await page.screenshot({ path: screenshot, animations: "disabled", caret: "hide" });
    await info.attach(`github-retry-${viewport.width}.png`, {
      path: screenshot,
      contentType: "image/png",
    });
    const crop = info.outputPath(`github-retry-${viewport.width}-controls.png`);
    await panel.screenshot({ path: crop, animations: "disabled", caret: "hide" });
    await info.attach(`github-retry-${viewport.width}-controls.png`, {
      path: crop,
      contentType: "image/png",
    });
    const opened = page.waitForEvent("popup");
    await link.focus();
    await link.press("Enter");
    const popup = await opened;
    await expect(popup).toHaveURL("https://github.com/login/device");
    expect(
      await popup.evaluate(() => (globalThis as unknown as { opener: unknown }).opener === null),
    ).toBe(true);
    await popup.close();
    expect(starts).toBe(1);
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => canceled).toBe(1);
    await expect(panel.getByRole("button", { name: "Connect GitHub", exact: true })).toBeVisible();
    expect(starts).toBe(1);
    await attachLinkBrowserEvents(info, browserEvents);
  });
}

test("runs and reload-recovers a durable latest-beta upgrade through the same-origin facade", async ({
  harness,
  page,
}) => {
  const state = await installManagedDouble(page, true);
  await page.goto(harness.baseUrl);
  await openManagedHost(page);

  await expect(page.getByTestId("managed-upgrade")).toContainText("2 accepted releases ahead");
  await expect(page.getByText(currentRelease.source_revision)).toBeVisible();
  await expect(page.getByText(latestRelease.source_revision)).toBeVisible();
  await page.getByRole("button", { name: "Upgrade to latest beta" }).click();
  await expect(page.getByRole("dialog", { name: "Upgrade Managed NAC?" })).toContainText(
    "Active work must finish or be explicitly stopped",
  );
  await page.getByRole("button", { name: "Start upgrade" }).click();

  await expect.poll(() => state.upgradeBodies).toEqual(["{}"]);
  expect(state.upgradeKeys).toHaveLength(1);
  expect(state.upgradeKeys[0]).toMatch(/^nac-upgrade-[0-9a-f-]{36}$/);
  await expect(page.getByText("Waiting for active work")).toBeVisible();
  await expect(page.getByText("Wait only")).toBeVisible();
  await page.getByRole("button", { name: "Stop terminal" }).click();
  await expect.poll(() => state.terminalStops).toEqual(["DELETE"]);
  await expect(page.getByText("Replacing NAC")).toBeVisible();

  await page.reload();
  await openManagedHost(page);
  await expect(page.getByText("Replacing NAC")).toBeVisible();
  await expect(
    page.getByText("018f47a5-34a7-7c91-bf7e-000000000001", { exact: true }),
  ).toBeVisible();

  state.upgradeState = "verifying";
  await expect(page.getByText("Verifying the replacement")).toBeVisible();
  state.upgradeState = "succeeded";
  await expect(page.getByText("Upgrade complete")).toBeVisible();
  await expect(page.getByText("Up to date")).toBeVisible();
});

test("retries a retained failed upgrade as a new explicit intent", async ({ harness, page }) => {
  const state = await installManagedDouble(page, true);
  state.upgradeState = "failed";
  state.upgradeStarts = 1;
  await page.goto(harness.baseUrl);
  await openManagedHost(page);

  await expect(page.getByText("Upgrade failed")).toBeVisible();
  await page.getByRole("button", { name: "Retry upgrade to latest beta" }).click();
  await page.getByRole("button", { name: "Start upgrade" }).click();
  await expect(page.getByText("Verifying the replacement")).toBeVisible();
  expect(state.upgradeStarts).toBe(2);
  expect(state.upgradeBodies).toEqual(["{}"]);
  expect(state.upgradeKeys[0]).toMatch(/^nac-upgrade-[0-9a-f-]{36}$/);

  state.upgradeState = "succeeded";
  await expect(page.getByText("Upgrade complete")).toBeVisible();
});

test("explains managed upgrade authorization, incarnation, and availability recovery", async ({
  harness,
  page,
}) => {
  const state = await installManagedDouble(page, true);
  state.upgradeFacadeStatus = 401;

  const reopenManagedHost = async () => {
    await page.goto(harness.baseUrl);
    await openManagedHost(page);
  };

  await reopenManagedHost();
  await expect(page.getByText(/Reopen this host from the Arcee portal/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

  state.upgradeFacadeStatus = 409;
  await reopenManagedHost();
  await expect(page.getByText(/This host session changed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh status" })).toBeVisible();

  state.upgradeFacadeStatus = 503;
  await reopenManagedHost();
  await expect(page.getByText(/temporarily unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  state.upgradeFacadeStatus = null;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Upgrade to latest beta" })).toBeVisible();
});

test("keeps device authorization and repository selection usable at 390 by 844", async ({
  harness,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await installManagedDouble(page);
  await page.goto(harness.baseUrl);

  await page.getByRole("button", { name: "Add repository" }).first().click();
  await expect(page.getByTestId("managed-github-settings")).toBeVisible();
  await page
    .getByTestId("managed-github-settings")
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  await expect(page.getByText("ABCD-EFGH")).toBeVisible();
  await expect(page.getByTestId("managed-repository-modal")).toBeVisible();
  await page.getByRole("button", { name: /arcee-ai\/managed-demo/ }).click();
  await page.getByRole("button", { name: "Branch: main", exact: true }).click();
  await page.getByRole("combobox", { name: "Find branch" }).fill("platform.v2");
  await page.getByRole("option", { name: alternateBranch }).click();
  await expect(
    page.getByRole("button", { name: `Branch: ${alternateBranch}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Clone repository" })).toBeVisible();
  await page.getByRole("button", { name: "Clone repository" }).click();
  await expect.poll(() => state.cloneRequest?.branch).toBe(alternateBranch);
});

test("cancels an in-progress managed clone without publishing a Project", async ({
  harness,
  page,
}) => {
  const state = await installManagedDouble(page, true);
  await page.goto(harness.baseUrl);

  await page.getByRole("button", { name: "Add repository" }).first().click();
  await page.getByRole("button", { name: /arcee-ai\/managed-demo/ }).click();
  await page.getByRole("button", { name: "Clone repository" }).click();
  await expect(page.getByText("Cloning objects: 75%")).toBeVisible();
  await page.getByRole("button", { name: "Cancel clone" }).click();
  await expect(page.getByText("Clone cancelled; staging checkout removed")).toBeVisible();
  expect(state.projectReady).toBe(false);
  expect(page.url()).not.toContain("/#/project/");
});

async function closeManagedHost(page: Page) {
  const host = page.getByRole("dialog", { name: "Managed host", exact: true });
  await host.getByRole("button", { name: "Close", exact: true }).click();
  await expect(host).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toHaveCount(0);
}

test("keeps managed secret drafts owned through delayed saves", async ({ harness, page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await installManagedDouble(page, true);
  const writes: string[] = [];
  const providerDiscoveryReads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    // Model discovery uses POST for its query payload; it does not mutate product state.
    if (request.method() === "POST" && path === "/providers/models") {
      providerDiscoveryReads.push(`POST ${path}`);
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      writes.push(`${request.method()} ${path}`);
  });
  await page.goto(harness.baseUrl);
  const scenarios = [
    "name",
    "value",
    "both",
    "edit-and-revert",
    "unchanged",
    "rejected",
    "rejected-newer",
  ];
  for (const [index, scenario] of scenarios.entries()) {
    await test.step(scenario, async () => {
      // Disposable fixture values only; no real credential reaches this lane.
      const originalName = `E2E_SECRET_${scenario.toUpperCase().replaceAll("-", "_")}`;
      const originalValue = `synthetic-fixture-${scenario}`;
      const newerName = `${originalName}_NEW`;
      const newerValue = `${originalValue}-new`;
      const endpoint = `${harness.baseUrl}/managed/secrets/${originalName}`;
      const rejected = scenario.startsWith("rejected");
      const editName = ["name", "both", "edit-and-revert", "rejected-newer"].includes(scenario);
      const editValue = ["value", "both", "edit-and-revert", "rejected-newer"].includes(scenario);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let putCount = 0;
      let payload: unknown;
      const holdSave = async (route: Route) => {
        if (route.request().method() !== "PUT") return route.fallback();
        putCount += 1;
        payload = route.request().postDataJSON();
        await held;
        if (rejected)
          return route.fulfill({
            status: 403,
            json: { error: `Synthetic fixture save denied: ${scenario}` },
          });
        return route.fallback();
      };
      await page.route(endpoint, holdSave);
      try {
        await openManagedHost(page);
        await page.getByRole("button", { name: "secrets", exact: true }).click();
        const name = page.getByLabel("Variable name", { exact: true });
        const value = page.getByLabel("New value", { exact: true });
        const save = page.getByRole("button", { name: "Save secret", exact: true });
        await name.fill(originalName);
        await value.fill(originalValue);
        await expect(value).toHaveAttribute("type", "password");
        await expect(page.getByText(originalValue, { exact: true })).toHaveCount(0);
        expect(writes).toHaveLength(index);
        await save.click();
        await expect.poll(() => putCount).toBe(1);
        await expect(save).toBeDisabled();
        expect(payload).toEqual({ value: originalValue });
        await expect(name).toBeEditable();
        await expect(value).toBeEditable();
        if (editName) await name.fill(newerName);
        if (editValue) await value.fill(newerValue);
        if (scenario === "edit-and-revert") {
          await name.fill(originalName);
          await value.fill(originalValue);
        }
        expect(putCount).toBe(1);
        const response = page.waitForResponse(
          (item) => item.url() === endpoint && item.request().method() === "PUT",
        );
        release();
        expect((await response).status()).toBe(rejected ? 403 : 200);
        if (rejected) {
          await expect(page.getByRole("alert")).toContainText(
            `Synthetic fixture save denied: ${scenario}`,
          );
          expect(state.secrets).not.toContain(originalName);
        } else {
          await expect(
            page.getByText("Secret saved for future command spawns", { exact: true }),
          ).toBeVisible();
          await expect(page.getByText(originalName, { exact: true })).toBeVisible();
        }
        await expect(save).toBeEnabled();
        const reverted = scenario === "edit-and-revert";
        await expect(name).toHaveValue(
          scenario === "unchanged" ? "" : editName && !reverted ? newerName : originalName,
        );
        await expect(value).toHaveValue(
          scenario === "unchanged" ? "" : editValue && !reverted ? newerValue : originalValue,
        );
        expect(putCount).toBe(1);
        expect(payload).toEqual({ value: originalValue });
        expect(writes).toHaveLength(index + 1);
        expect(writes[index]).toBe(`PUT /managed/secrets/${originalName}`);
        await expect(page.getByText(originalValue, { exact: true })).toHaveCount(0);
        await expect(page.getByText(newerValue, { exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Dismiss notification", exact: true }),
        ).toHaveCount(0);
        await closeManagedHost(page);
      } finally {
        release();
        await page.unroute(endpoint, holdSave);
      }
    });
  }
  expect(state.cloneRequest).toBeNull();
  expect(state.upgradeStarts).toBe(0);
  expect(state.terminalStops).toEqual([]);
  expect(providerDiscoveryReads).toHaveLength(state.providerRequests.length);
  await info.attach("managed-secret-delayed-settlement.json", {
    body: JSON.stringify({
      scenarios,
      writes,
      providerDiscoveryReads,
      boundaries: "synthetic managed HTTP fixtures only",
    }),
    contentType: "application/json",
  });
});

// The ALL-522 capture lane serves immutable normal-built baseline assets over
// the same disposable API and preserves native viewport geometry at real zoom.
// All managed boundaries below are controlled HTTP fixtures, never cloud calls.
for (const width of [1440, 768, 390]) {
  test(`managed presentation states and nested controls at ${width}px`, async ({
    harness,
    page,
  }, info) =>
    withSetupBaselines(async (baseline) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await baseline.serve(page, harness.baseUrl);
      const state = await installManagedDouble(page, true);
      const secretWrites: string[] = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/managed/secrets/") && request.method() !== "GET")
          secretWrites.push(`${request.method()} ${path}`);
      });
      state.secrets = ["DEMO_SERVICE_TOKEN", "DEMO_LONG_VARIABLE_NAME_FOR_A_PRIVATE_INTEGRATION"];
      await page.goto(harness.baseUrl);
      await openManagedHost(page);
      await expect(page.getByTestId("managed-host-status")).toBeVisible();
      if (width === 390 && !setupBaseline())
        await inspectManagedClose(page, info, "Managed host", "native390-host");
      await captureSetup(page, info, width, "managed-ready");
      await captureSetup(page, info, width, "managed-upgrade", page.getByTestId("managed-upgrade"));
      expect(state.upgradeStarts).toBe(0);
      await page.getByRole("button", { name: "GitHub", exact: true }).click();
      await expect(
        page.getByTestId("managed-github-settings").getByText("Connected", { exact: true }),
      ).toBeVisible();
      await captureSetup(page, info, width, "managed-github");
      await page.getByRole("button", { name: "secrets", exact: true }).click();
      await expect(page.getByText("DEMO_SERVICE_TOKEN", { exact: true })).toBeVisible();
      await captureSetup(page, info, width, "managed-secrets");
      const draftName = page.getByLabel("Variable name", { exact: true });
      const draftValue = page.getByLabel("New value", { exact: true });
      await draftName.fill("E2E_UNSAVED_SECRET");
      await draftValue.fill("synthetic-unsaved-password");
      await expect(draftValue).toHaveAttribute("type", "password");
      await expect(page.getByText("synthetic-unsaved-password", { exact: true })).toHaveCount(0);
      await captureSetup(page, info, width, "managed-secret-draft", draftValue);
      expect(secretWrites).toEqual([]);
      await closeManagedHost(page);
      await openManagedHost(page);
      await page.getByRole("button", { name: "secrets", exact: true }).click();
      await expect(draftName).toHaveValue("");
      await expect(draftValue).toHaveValue("");
      expect(secretWrites).toEqual([]);
      await closeManagedHost(page);
      await page.getByRole("button", { name: "Add repository", exact: true }).first().click();
      await page.getByRole("button", { name: /arcee-ai\/managed-demo/ }).click();
      if (width === 390 && !setupBaseline())
        await inspectManagedClose(page, info, "Add repository", "native390-repository");
      await captureSetup(page, info, width, "managed-checkout");
      const trigger = page.getByRole("button", { name: "Branch: main", exact: true });
      if (width === 390) await trigger.tap();
      else await trigger.click();
      const search = page.getByRole("combobox", { name: "Find branch" });
      await search.fill("platform.v2");
      await expect(page.getByRole("option", { name: alternateBranch })).toBeVisible();
      await captureSetup(page, info, width, "managed-branches");
      if (!setupBaseline()) {
        await search.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
        await expect(search).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(search).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.getByRole("dialog", { name: "Add repository", exact: true })).toBeVisible();
      expect(state.cloneRequest).toBeNull();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      state.upgradeState = "blocked";
      await page.reload();
      await openManagedHost(page);
      await expect(page.getByText("Wait only", { exact: true })).toBeVisible();
      await captureSetup(
        page,
        info,
        width,
        "managed-partial-cleanup",
        page.getByTestId("managed-upgrade-operation"),
      );
      expect(state.terminalStops).toEqual([]);
      await closeManagedHost(page);

      state.upgradeFacadeStatus = 403;
      await page.reload();
      await openManagedHost(page);
      await expect(page.getByTestId("managed-upgrade-unavailable")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Upgrade to latest beta", exact: true }),
      ).toHaveCount(0);
      await captureSetup(
        page,
        info,
        width,
        "managed-denied",
        page.getByTestId("managed-upgrade-unavailable"),
      );
      await closeManagedHost(page);
      state.upgradeFacadeStatus = 503;
      await page.reload();
      await openManagedHost(page);
      await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
      await captureSetup(
        page,
        info,
        width,
        "managed-offline",
        page.getByTestId("managed-upgrade-unavailable"),
      );
      await info.attach("managed-accessibility-semantics.txt", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/plain",
      });
      if (!setupBaseline() && width === 390) {
        await closeManagedHost(page);
        state.upgradeFacadeStatus = null;
        state.upgradeState = "available";
        const githubEndpoint = `${harness.baseUrl}/managed/github`;
        const hostEndpoint = `${harness.baseUrl}/managed/status`;
        const privateBody = "invalid model configuration: synthetic private denial detail";
        let denyGitHub = true;
        let denyHost = false;
        const githubReads: number[] = [];
        const hostReads: number[] = [];
        const mutations: string[] = [];
        const providerDiscoveryReads: string[] = [];
        const discoveryBefore = state.providerRequests.length;
        const completed: string[] = [];
        const reconnectWitnesses: { stage: string; monotonicMs: number; online: boolean }[] = [];
        const githubFreshnessMs = 30_000;
        let probeFailed = false;
        const cleanupErrors: { operation: string; error: string }[] = [];
        const readPublicNetwork = () =>
          page.evaluate(() => {
            const browser = globalThis as unknown as {
              performance: { now(): number };
              navigator: { onLine: boolean };
            };
            return { monotonicMs: browser.performance.now(), online: browser.navigator.onLine };
          });
        const journalRequest = (request: Request) => {
          const url = new URL(request.url());
          if (
            request.method() === "POST" &&
            url.origin === new URL(harness.baseUrl).origin &&
            url.pathname === "/providers/models"
          ) {
            providerDiscoveryReads.push(`POST ${url.pathname}`);
          } else if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
            mutations.push(`${request.method()} ${url.pathname}`);
          }
        };
        const githubRead = async (route: Route) => {
          if (route.request().method() !== "GET") return route.fallback();
          githubReads.push(denyGitHub ? 403 : 200);
          if (denyGitHub) return route.fulfill({ status: 403, json: { error: privateBody } });
          return route.fallback();
        };
        const hostRead = async (route: Route) => {
          if (route.request().method() !== "GET") return route.fallback();
          hostReads.push(denyHost ? 403 : 200);
          if (denyHost) return route.fulfill({ status: 403, json: { error: privateBody } });
          return route.fallback();
        };
        page.on("request", journalRequest);
        try {
          await page.route(githubEndpoint, githubRead);
          await page.route(hostEndpoint, hostRead);
          await test.step("repository initial 403 stays private and recovers by read-only Retry", async () => {
            // Reload clears the GitHub query cache while the valid host read keeps the public entry.
            await page.reload();
            await page.getByRole("button", { name: "Add repository", exact: true }).first().click();
            const modal = page.getByRole("dialog", { name: "Add repository", exact: true });
            const alert = modal.getByRole("alert");
            await expect(alert).toContainText(
              "GitHub access was denied for this host. Ask the host owner to check access to the GitHub App.",
            );
            await expect(alert).not.toContainText(/model|private denial detail|workspace/i);
            await expect(
              modal.getByRole("button", { name: "Connect GitHub", exact: true }),
            ).toHaveCount(0);
            await expect(
              modal.getByRole("button", { name: "Clone repository", exact: true }),
            ).toBeDisabled();
            expect(mutations).toEqual([]);
            await captureSetup(page, info, width, "managed-repository-context-denied", alert);
            denyGitHub = false;
            const recovered = page.waitForResponse(
              (response) =>
                response.url() === githubEndpoint &&
                response.request().method() === "GET" &&
                response.status() === 200,
            );
            await modal
              .getByRole("button", { name: "Retry connection check", exact: true })
              .click();
            await recovered;
            await expect(
              modal.getByRole("button", { name: /arcee-ai\/managed-demo/ }),
            ).toBeVisible();
            expect(githubReads).toEqual([403, 200]);
            expect(mutations).toEqual([]);
            completed.push("repository-initial-403");
          });
          await test.step("repository cached 403 retains the checkout draft through read-only Retry", async () => {
            const modal = page.getByRole("dialog", { name: "Add repository", exact: true });
            await modal.getByRole("button", { name: /arcee-ai\/managed-demo/ }).click();
            await modal.getByRole("button", { name: "Branch: main", exact: true }).click();
            await page.getByRole("combobox", { name: "Find branch" }).fill("platform.v2");
            await page.getByRole("option", { name: alternateBranch }).click();
            await modal.getByLabel("Project name", { exact: true }).fill("Retained denial draft");
            await modal
              .getByLabel("Checkout directory", { exact: true })
              .fill("retained-denial-draft");
            // useManagedGitHub inherits NativeRuntime's documented 30-second freshness policy.
            const ready = await readPublicNetwork();
            reconnectWitnesses.push({ stage: "checkout-ready", ...ready });
            await expect
              .poll(async () => (await readPublicNetwork()).monotonicMs - ready.monotonicMs, {
                timeout: githubFreshnessMs + 5_000,
                intervals: [1_000],
              })
              .toBeGreaterThanOrEqual(githubFreshnessMs + 1);
            const stale = await readPublicNetwork();
            reconnectWitnesses.push({ stage: "freshness-elapsed", ...stale });
            expect(stale.online).toBe(true);
            denyGitHub = true;
            const denied = page.waitForResponse(
              (response) =>
                response.url() === githubEndpoint &&
                response.request().method() === "GET" &&
                response.status() === 403,
            );
            // A real browser reconnect refetches this stale active read; no private cache hook.
            try {
              await page.context().setOffline(true);
              await expect.poll(async () => (await readPublicNetwork()).online).toBe(false);
              reconnectWitnesses.push({ stage: "offline", ...(await readPublicNetwork()) });
            } finally {
              await page.context().setOffline(false);
            }
            await expect.poll(async () => (await readPublicNetwork()).online).toBe(true);
            reconnectWitnesses.push({ stage: "online", ...(await readPublicNetwork()) });
            await denied;
            const alert = modal.getByRole("alert");
            await expect(alert).toContainText("GitHub access was denied for this host");
            await expect(alert).not.toContainText(/model|private denial detail|workspace/i);
            await expect(
              modal.getByRole("button", { name: "Connect GitHub", exact: true }),
            ).toHaveCount(0);
            await expect(modal.getByLabel("Checkout directory", { exact: true })).toHaveCount(0);
            await expect(
              modal.getByRole("button", { name: "Clone repository", exact: true }),
            ).toBeDisabled();
            expect(mutations).toEqual([]);
            denyGitHub = false;
            const recovered = page.waitForResponse(
              (response) =>
                response.url() === githubEndpoint &&
                response.request().method() === "GET" &&
                response.status() === 200,
            );
            await modal
              .getByRole("button", { name: "Retry connection check", exact: true })
              .click();
            await recovered;
            await expect(
              modal.getByRole("button", { name: `Branch: ${alternateBranch}`, exact: true }),
            ).toBeVisible();
            await expect(modal.getByLabel("Project name", { exact: true })).toHaveValue(
              "Retained denial draft",
            );
            await expect(modal.getByLabel("Checkout directory", { exact: true })).toHaveValue(
              "retained-denial-draft",
            );
            await expect(
              modal.getByRole("button", { name: "Clone repository", exact: true }),
            ).toBeEnabled();
            expect(githubReads).toEqual([403, 200, 403, 200]);
            expect(mutations).toEqual([]);
            await modal.getByRole("button", { name: "Cancel", exact: true }).click();
            completed.push("repository-cached-403");
          });
          await test.step("open host cached 403 retains last-known status without model advice", async () => {
            await openManagedHost(page);
            const host = page.getByTestId("managed-host-status");
            await expect(host.getByText("/repositories", { exact: true })).toBeVisible();
            denyHost = true;
            await page.waitForResponse(
              (response) =>
                response.url() === hostEndpoint &&
                response.request().method() === "GET" &&
                response.status() === 403,
              { timeout: 25_000 },
            );
            const alert = host.getByRole("alert");
            await expect(alert).toContainText("Last known status is shown below");
            await expect(alert).toContainText(
              "Access to this managed host was denied. Ask the host owner to check access.",
            );
            await expect(alert).not.toContainText(/model|private denial detail|workspace/i);
            await expect(host.getByText("managed-e2e-host", { exact: true })).toBeVisible();
            await expect(host.getByText("/repositories", { exact: true })).toBeVisible();
            await captureSetup(page, info, width, "managed-host-context-denied", alert);
            expect(hostReads).toContain(403);
            expect(mutations).toEqual([]);
            completed.push("host-cached-403");
          });
          expect(providerDiscoveryReads).toHaveLength(
            state.providerRequests.length - discoveryBefore,
          );
          expect(secretWrites).toEqual([]);
          expect(state.cloneRequest).toBeNull();
          expect(state.upgradeStarts).toBe(0);
          expect(state.terminalStops).toEqual([]);
        } catch (error) {
          probeFailed = true;
          throw error;
        } finally {
          try {
            await info.attach("managed-denied-read-context.json", {
              body: JSON.stringify({
                completed,
                githubReads,
                hostReads,
                mutations,
                providerDiscoveryReads,
                githubFreshnessMs,
                reconnectWitnesses,
                probeFailed,
                initialHostNoData:
                  "Component RED/GREEN only: no public managed entry without cached host data",
                boundaries:
                  "Exact synthetic managed GET fixtures; real browser reconnect and host polling reads",
              }),
              contentType: "application/json",
            });
          } catch (error) {
            cleanupErrors.push({ operation: "attach read journal", error: String(error) });
          }
          page.off("request", journalRequest);
          const operations = ["restore network", "unroute GitHub read", "unroute host read"];
          const cleanup = await Promise.allSettled([
            page.context().setOffline(false),
            page.unroute(githubEndpoint, githubRead),
            page.unroute(hostEndpoint, hostRead),
          ]);
          for (const [index, result] of cleanup.entries()) {
            if (result.status === "rejected")
              cleanupErrors.push({ operation: operations[index], error: String(result.reason) });
          }
          try {
            await info.attach("managed-denied-read-cleanup.json", {
              body: JSON.stringify({ probeFailed, cleanupErrors }),
              contentType: "application/json",
            });
          } catch (error) {
            cleanupErrors.push({ operation: "attach cleanup journal", error: String(error) });
          }
        }
        if (cleanupErrors.length > 0)
          throw new AggregateError(cleanupErrors, "Managed denied-read cleanup failed");
      }
    }));
}

test("managed setup remains reachable at actual 200 percent tab zoom", async ({ harness }, info) =>
  withSetupBaselines(async (baseline) => {
    test.setTimeout(120_000);
    const { context, page, zoom } = await openNameZoom(
      info,
      harness.baseUrl,
      undefined,
      undefined,
      (preparedContext) => baseline.beforeContextClose(preparedContext),
    );
    await baseline.withContext(context, async () => {
      await baseline.serve(page, harness.baseUrl);
      await installManagedDouble(page, true);
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
        await page.goto(harness.baseUrl);
        if (width === 390 && !setupBaseline()) {
          await openManagedHost(page);
          await inspectManagedClose(page, info, "Managed host", "zoom200-host");
          await closeManagedHost(page);
        }
        await page.getByRole("button", { name: "Add repository", exact: true }).first().click();
        await page.getByRole("button", { name: /arcee-ai\/managed-demo/ }).click();
        if (width === 390 && !setupBaseline())
          await inspectManagedClose(page, info, "Add repository", "zoom200-repository");
        const clone = page.getByRole("button", { name: "Clone repository", exact: true });
        await expect(clone).toBeInViewport();
        if (!setupBaseline()) {
          await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
          const bounds = await clone.boundingBox();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          if (width === 390) {
            const row = page.getByRole("button", {
              name: /arcee-ai\/managed-demo/,
              pressed: true,
            });
            const identity = row.getByText("arcee-ai/managed-demo", { exact: true });
            const geometry = await identity.evaluate((element) => {
              type GeometryNode = {
                closest(selector: string): GeometryNode | null;
                parentElement: GeometryNode | null;
                nextElementSibling: GeometryNode | null;
                clientWidth: number;
                clientHeight: number;
                scrollWidth: number;
                scrollHeight: number;
                getBoundingClientRect(): TextBounds;
              };
              type TextBounds = {
                width: number;
                height: number;
                top: number;
                right: number;
                bottom: number;
                left: number;
              };
              const { getComputedStyle, document } = globalThis as unknown as {
                getComputedStyle(node: GeometryNode): {
                  paddingLeft: string;
                  paddingRight: string;
                  lineHeight: string;
                };
                document: {
                  createRange(): {
                    selectNodeContents(node: GeometryNode): void;
                    getClientRects(): ArrayLike<TextBounds>;
                  };
                };
              };
              const name = element as unknown as GeometryNode;
              const row = name.closest("button")!;
              const list = row.parentElement!;
              const style = getComputedStyle(row);
              const identityBounds = name.getBoundingClientRect();
              const detailBounds = name.nextElementSibling!.getBoundingClientRect();
              const rowBounds = row.getBoundingClientRect();
              const listBounds = list.getBoundingClientRect();
              const text = document.createRange();
              text.selectNodeContents(name);
              return {
                identityWidth: identityBounds.width,
                identityTop: identityBounds.top,
                listTop: listBounds.top,
                contentWidth:
                  row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                identityLines:
                  identityBounds.height / parseFloat(getComputedStyle(name).lineHeight),
                identityClientWidth: name.clientWidth,
                identityScrollWidth: name.scrollWidth,
                identityClientHeight: name.clientHeight,
                identityScrollHeight: name.scrollHeight,
                textRects: Array.from(text.getClientRects(), (rect) => ({
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                })),
                identityBounds: {
                  left: identityBounds.left,
                  top: identityBounds.top,
                  right: identityBounds.right,
                  bottom: identityBounds.bottom,
                },
                detailBottom: detailBounds.bottom,
                listBottom: listBounds.bottom,
                rowHeight: rowBounds.height,
              };
            });
            await info.attach("managed-zoom200-repository-identity-geometry.json", {
              body: JSON.stringify(geometry),
              contentType: "application/json",
            });
            await expect(row).toHaveAccessibleName("arcee-ai/managed-demo Default branch: main");
            expect(geometry.identityWidth).toBeGreaterThanOrEqual(geometry.contentWidth - 1);
            expect(geometry.identityTop).toBeGreaterThanOrEqual(geometry.listTop);
            expect(geometry.identityScrollWidth).toBeLessThanOrEqual(
              geometry.identityClientWidth + 1,
            );
            expect(geometry.identityScrollHeight).toBeLessThanOrEqual(
              geometry.identityClientHeight + 1,
            );
            expect(geometry.textRects.length).toBeGreaterThan(0);
            for (const rect of geometry.textRects) {
              expect(rect.left).toBeGreaterThanOrEqual(geometry.identityBounds.left - 1);
              expect(rect.right).toBeLessThanOrEqual(geometry.identityBounds.right + 1);
              expect(rect.top).toBeGreaterThanOrEqual(geometry.identityBounds.top - 1);
              expect(rect.bottom).toBeLessThanOrEqual(geometry.identityBounds.bottom + 1);
            }
            expect(geometry.detailBottom).toBeLessThanOrEqual(geometry.listBottom);
            expect(geometry.rowHeight).toBeGreaterThanOrEqual(44);
          }
        }
        await captureSetup(page, info, width, "managed-zoom200-checkout");
        const trigger = page.getByRole("button", { name: "Branch: main", exact: true });
        await trigger.click();
        await page.getByRole("combobox", { name: "Find branch" }).fill("platform.v2");
        await expect(page.getByRole("option", { name: alternateBranch })).toBeVisible();
        await captureSetup(page, info, width, "managed-zoom200-branches");
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      await info.attach("actual-managed-browser-zoom.json", {
        body: JSON.stringify({
          zoom,
          method: "chrome.tabs.setZoom/getZoom",
          reducedMotion: "reduce",
          productTheme: "dark",
          boundaries: "controlled managed HTTP fixtures",
        }),
        contentType: "application/json",
      });
    });
  }));

for (const width of [1440, 768, 390]) {
  test(`managed checking, unconfigured, error, pending and cleanup-only at ${width}px`, async ({
    harness,
    page,
  }, info) =>
    withSetupBaselines(async (baseline) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await baseline.serve(page, harness.baseUrl);
      const state = await installManagedDouble(page, false);
      const writes: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/managed/") && request.method() !== "GET")
          writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      });
      let connection: "checking" | "unconfigured" | "error" | "signed-out" = "checking";
      let release!: () => void;
      const checking = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/managed/github", async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        if (connection === "checking") await checking;
        if (connection === "error")
          return route.fulfill({
            status: 403,
            json: { error: "GitHub access denied for this host." },
          });
        return route.fulfill({
          json: { ...githubStatus(state), configured: connection !== "unconfigured" },
        });
      });
      await page.goto(harness.baseUrl);
      await openManagedHost(page);
      await page.getByRole("button", { name: "GitHub", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Managed host", exact: true })).toBeVisible();
      await captureSetup(page, info, width, "managed-checking");
      expect(writes).toEqual([]);
      connection = "unconfigured";
      release();
      await expect(
        page
          .getByTestId("managed-github-settings")
          .getByRole("button", { name: "Connect GitHub", exact: true }),
      ).toBeVisible();
      await captureSetup(page, info, width, "managed-unconfigured");
      await closeManagedHost(page);
      connection = "error";
      await page.reload();
      await openManagedHost(page);
      const denied = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/managed/github" && response.status() === 403,
      );
      await page.getByRole("button", { name: "GitHub", exact: true }).click();
      await denied;
      if (!setupBaseline()) await expect(page.getByRole("alert")).toBeVisible();
      await captureSetup(page, info, width, "managed-connection-error");
      expect(writes).toEqual([]);
      await closeManagedHost(page);
      connection = "signed-out";
      await page.reload();
      await openManagedHost(page);
      await page.getByRole("button", { name: "GitHub", exact: true }).click();
      await page.route("**/managed/github/login/managed-login-e2e", (route) =>
        route.request().method() === "GET"
          ? route.fulfill({ json: { state: "pending" } })
          : route.fallback(),
      );
      await page
        .getByTestId("managed-github-settings")
        .getByRole("button", { name: "Connect GitHub", exact: true })
        .click();
      await expect(page.getByTestId("github-device-code")).toBeVisible();
      await captureSetup(page, info, width, "managed-login-pending");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByTestId("github-device-code")).toHaveCount(0);
      expect(writes).toEqual([
        "POST /managed/github/login",
        "DELETE /managed/github/login/managed-login-e2e",
      ]);
      await closeManagedHost(page);
      state.upgradeState = "blocked";
      await page.route("**/__managed/control/v0/upgrade", (route) => {
        const snapshot = upgradeSnapshot(state);
        if (snapshot.operation)
          snapshot.operation.blockers = snapshot.operation.blockers.filter(
            (blocker) => !blocker.actionable,
          );
        return route.fulfill({ json: snapshot });
      });
      await page.reload();
      await openManagedHost(page);
      await expect(page.getByText("Wait only", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop terminal", exact: true })).toHaveCount(0);
      await captureSetup(
        page,
        info,
        width,
        "managed-cleanup-only",
        page.getByTestId("managed-upgrade-operation"),
      );
      expect(state.upgradeStarts).toBe(0);
      expect(state.terminalStops).toEqual([]);
    }));
}
