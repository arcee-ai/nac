import type { Page, Route } from "@playwright/test";

import { expect, test } from "./harness";

type ManagedDoubleState = {
  connected: boolean;
  loginPolls: number;
  clonePolls: number;
  projectReady: boolean;
  secrets: string[];
  cloneRequest: Record<string, unknown> | null;
  cloneBranch: string;
};

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
  schema_version: 23,
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
  };
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
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add repository" }).click();
  await expect(page.getByTestId("managed-github-settings")).toBeVisible();
  await page
    .getByTestId("managed-github-settings")
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  await expect(page.getByTestId("github-device-code")).toContainText("ABCD-EFGH");
  await expect(page.getByTestId("managed-repository-modal")).toBeVisible();
  await expect(page.getByRole("button", { name: /arcee-ai\/managed-demo/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Open the menu" }).click();
  await page.getByRole("button", { name: "Managed host" }).click();
  await page.getByRole("button", { name: "secrets", exact: true }).click();
  await page.getByLabel("Variable name").fill("DEMO_SERVICE_TOKEN");
  await page.getByLabel("New value").fill("browser-e2e-secret-value");
  await page.getByRole("button", { name: "Save secret" }).click();
  await expect(page.getByText("DEMO_SERVICE_TOKEN")).toBeVisible();
  await expect(page.getByText("browser-e2e-secret-value")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Add repository" }).click();
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

  await page.getByRole("button", { name: "Add repository" }).click();
  await page.getByRole("button", { name: /arcee-ai\/managed-demo/ }).click();
  await page.getByRole("button", { name: "Clone repository" }).click();
  await expect(page.getByText("Cloning objects: 75%")).toBeVisible();
  await page.getByRole("button", { name: "Cancel clone" }).click();
  await expect(page.getByText("Clone cancelled; staging checkout removed")).toBeVisible();
  expect(state.projectReady).toBe(false);
  expect(page.url()).not.toContain("/#/project/");
});
