import type { Page, Route } from "@playwright/test";

import { expect, test } from "./harness";

type UpgradeState =
  | "preparing"
  | "blocked"
  | "safe-to-stop"
  | "replacing"
  | "starting/migrating"
  | "verifying"
  | "succeeded"
  | "failed";

const current = {
  release_id: "beta-current",
  source_revision: "a".repeat(40),
  build_id: "beta-current-exact-build",
  product_version: "0.2.0-beta.1",
  schema_version: 24,
};
const latest = {
  release_id: "beta-latest",
  source_revision: "b".repeat(40),
  build_id: "beta-latest-exact-build",
  product_version: "0.2.0-beta.4",
  schema_version: 25,
};

type UpgradeDouble = Awaited<ReturnType<typeof installUpgradeDouble>>;

async function installUpgradeDouble(page: Page) {
  const state: {
    authFailure: boolean;
    denyPost: boolean;
    loseResponses: number;
    operation: Record<string, unknown> | null;
    posts: Array<{ body: unknown; headers: Record<string, string> }>;
    actions: string[];
  } = {
    authFailure: false,
    denyPost: false,
    loseResponses: 0,
    operation: null,
    posts: [],
    actions: [],
  };
  await page.route("**/managed/status", (route) =>
    route.fulfill({
      json: {
        managed: true,
        ready: true,
        version: "0.2.0-beta.1",
        schema_version: 24,
        logical_host_id: "managed-upgrade-e2e",
        owner: "owner@example.test",
        public_hostname: "managed.example.test",
        repository_root: "/repositories",
        model_ready: true,
        model: {
          backend: "openai-responses",
          id: "gpt-5.6-sol",
          endpoint: "https://models.example.test/v1",
          display_name: "Managed model",
        },
        github_status: "connected",
        secret_count: 0,
        project_count: 0,
        session_count: 0,
        checks: [{ name: "store", ready: true, detail: "SQLite store is ready" }],
      },
    }),
  );
  await page.route("**/__managed/control/v0/upgrade", async (route: Route) => {
    const request = route.request();
    if (request.method() === "GET") {
      if (state.authFailure) {
        return route.fulfill({
          status: 401,
          contentType: "application/problem+json",
          json: { type: "about:blank", title: "Authentication failed", status: 401 },
        });
      }
      return route.fulfill({
        json: {
          preview: {
            current: state.operation?.state === "succeeded" ? latest : current,
            latest_beta: latest,
            upgrade_available: state.operation?.state !== "succeeded",
            distance: {
              accepted_releases: state.operation?.state === "succeeded" ? 0 : 3,
            },
          },
          operation: state.operation,
        },
      });
    }
    state.posts.push({ body: request.postDataJSON(), headers: request.headers() });
    if (state.denyPost) {
      return route.fulfill({
        status: 403,
        contentType: "application/problem+json",
        json: { type: "about:blank", title: "Request denied", status: 403 },
      });
    }
    if (state.loseResponses > 0) {
      state.loseResponses -= 1;
      if (state.posts.length > 1) state.operation = upgradeOperation("preparing");
      return route.abort("connectionreset");
    }
    state.operation = upgradeOperation("preparing", `operation-${state.posts.length}`);
    return route.fulfill({ status: 202, json: state.operation });
  });
  await page.route("**/sessions/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      path.endsWith("/cancel-active-run") ||
      path.includes("/children/") ||
      path.includes("/orchestrators/") ||
      path.includes("/terminals/")
    ) {
      state.actions.push(`${route.request().method()} ${path}`);
      return path.includes("/terminals/")
        ? route.fulfill({ status: 204 })
        : route.fulfill({ status: 200, json: {} });
    }
    return route.fallback();
  });
  await page.route("**/managed/github/clone-operations/**", (route) => {
    state.actions.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ json: { status: "cancelled" } });
  });
  return state;
}

function upgradeOperation(state: UpgradeState, operationId = "operation-1") {
  return {
    operation_id: operationId,
    managed_host_id: "managed-upgrade-e2e",
    kind: "upgrade",
    state,
    target_release: latest,
    desired_release: ["replacing", "starting/migrating", "verifying", "succeeded"].includes(state)
      ? latest
      : undefined,
    observed_release: state === "succeeded" ? latest : undefined,
    message: state === "failed" ? "The candidate did not become ready" : undefined,
    blockers: [],
  };
}

async function openUpgrade(page: Page) {
  await page.getByRole("button", { name: "Open the menu" }).click();
  await page.getByRole("button", { name: "Managed host" }).click();
  await expect(page.getByTestId("managed-upgrade")).toBeVisible();
}

test("uses strict same-origin requests and recovers response loss and replacement reload", async ({
  harness,
  page,
}) => {
  const state = await installUpgradeDouble(page);
  state.loseResponses = 2;
  await page.goto(harness.baseUrl);
  await openUpgrade(page);

  await page.getByRole("button", { name: "Upgrade to latest beta" }).click();
  await expect(page.getByText(/request response was lost/i)).toBeVisible();
  await page.getByRole("button", { name: "Upgrade to latest beta" }).click();
  await expect(page.getByText("Upgrade progress")).toBeVisible();
  await expect.poll(() => state.posts.length).toBe(2);
  expect(state.posts[0]?.body).toEqual({});
  expect(state.posts[0]?.headers["content-type"]).toBe("application/json");
  expect(state.posts[0]?.headers["origin"]).toBe(harness.baseUrl);
  expect(state.posts[0]?.headers.referer).toBe(`${harness.baseUrl}/`);
  expect(state.posts[0]?.headers["idempotency-key"]).toBe(
    state.posts[1]?.headers["idempotency-key"],
  );

  state.operation = upgradeOperation("replacing");
  await page.reload();
  await openUpgrade(page);
  await expect(page.getByText("Replacing runtime")).toHaveAttribute("aria-current", "step");

  state.operation = upgradeOperation("succeeded");
  await expect(page.getByText("Complete")).toHaveAttribute("aria-current", "step", {
    timeout: 5_000,
  });
  await expect(page.getByText("This host is on the latest accepted beta.")).toBeVisible();
  await expect(page.getByText("beta-latest-exact-build").first()).toBeVisible();
});

test("renders authorization failures and a CSRF denial without leaking response details", async ({
  harness,
  page,
}) => {
  const state = await installUpgradeDouble(page);
  state.authFailure = true;
  await page.goto(harness.baseUrl);
  await page.getByRole("button", { name: "Open the menu" }).click();
  await page.getByRole("button", { name: "Managed host" }).click();
  await expect(page.getByText(/Relaunch this host from Arcee/i)).toBeVisible();

  state.authFailure = false;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByTestId("managed-upgrade")).toBeVisible();
  state.denyPost = true;
  await page.getByRole("button", { name: "Upgrade to latest beta" }).click();
  await expect(page.getByText(/upgrade request was denied/i)).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test("settles actionable blockers, preserves wait-only markers, and retries a failure", async ({
  harness,
  page,
}) => {
  const state: UpgradeDouble = await installUpgradeDouble(page);
  state.operation = {
    ...upgradeOperation("blocked"),
    blockers: [
      {
        selection_key: `sha256:${"1".repeat(64)}`,
        kind: "active_run",
        message: "An active run must finish before maintenance can start",
        actionable: true,
        action: "cancel_active_run",
        target: { session_id: "session-1", run_id: "run-1" },
      },
      {
        selection_key: `sha256:${"2".repeat(64)}`,
        kind: "terminal_process",
        message: "An active terminal process must finish before maintenance can start",
        actionable: true,
        action: "terminate_terminal",
        target: { session_id: "session-2", terminal_id: "terminal-2" },
      },
      {
        selection_key: `sha256:${"3".repeat(64)}`,
        kind: "clone_operation",
        message: "An active repository clone must finish before maintenance can start",
        actionable: true,
        action: "cancel_clone_operation",
        target: { clone_operation_id: "clone-3" },
      },
      {
        selection_key: `sha256:${"4".repeat(64)}`,
        kind: "operation_lease",
        message: "An active operation must finish before maintenance can start",
        actionable: false,
        action: "wait",
        target: null,
      },
    ],
  };
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(harness.baseUrl);
  await openUpgrade(page);
  await expect(page.getByText("Wait for this condition to clear.")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await page.getByRole("button", { name: "Stop all actionable work" }).click();
  await expect.poll(() => state.actions.length).toBe(3);
  expect(state.actions).toEqual(
    expect.arrayContaining([
      "POST /sessions/session-1/cancel-active-run",
      "DELETE /sessions/session-2/terminals/terminal-2",
      "DELETE /managed/github/clone-operations/clone-3",
    ]),
  );

  state.operation = upgradeOperation("safe-to-stop");
  await expect(page.getByText("Maintenance confirmed")).toHaveAttribute("aria-current", "step", {
    timeout: 5_000,
  });
  state.operation = upgradeOperation("starting/migrating");
  await expect(page.getByText("Starting and migrating")).toHaveAttribute("aria-current", "step", {
    timeout: 5_000,
  });
  state.operation = upgradeOperation("failed");
  await expect(page.getByRole("status")).toContainText("The candidate did not become ready", {
    timeout: 5_000,
  });
  await page.getByRole("button", { name: "Retry latest beta" }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expect(page.getByText("Upgrade progress")).toBeVisible();
});
