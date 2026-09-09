/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ManagedUpgradePanel } from "@/app/features/managed/presentation/ManagedUpgradePanel";
import { api } from "@/app/services/api";
import type {
  ManagedReleaseIdentity,
  ManagedUpgradeOperation,
  ManagedUpgradeSnapshot,
} from "@/app/types/api";

const current: ManagedReleaseIdentity = {
  release_id: "beta-current",
  source_revision: "a".repeat(40),
  build_id: "build-current-exact",
  product_version: "0.2.0-beta.1",
  schema_version: 24,
};
const latest: ManagedReleaseIdentity = {
  release_id: "beta-latest",
  source_revision: "b".repeat(40),
  build_id: "build-latest-exact",
  product_version: "0.2.0-beta.4",
  schema_version: 25,
};

function operation(
  state: ManagedUpgradeOperation["state"],
  extra: Partial<ManagedUpgradeOperation> = {},
): ManagedUpgradeOperation {
  return {
    operation_id: "operation-1",
    managed_host_id: "host-1",
    kind: "upgrade",
    state,
    target_release: latest,
    ...extra,
  };
}

function snapshot(
  active: ManagedUpgradeOperation | null = null,
  upgradeAvailable = true,
): ManagedUpgradeSnapshot {
  return {
    preview: {
      current,
      latest_beta: latest,
      upgrade_available: upgradeAvailable,
      distance: { accepted_releases: upgradeAvailable ? 3 : 0 },
    },
    operation: active,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ManagedUpgradePanel />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

it("shows exact identities and starts only the latest beta with a retained idempotency key", async () => {
  vi.spyOn(api, "getManagedUpgrade")
    .mockResolvedValueOnce(snapshot())
    .mockResolvedValue(snapshot(operation("preparing")));
  const start = vi.spyOn(api, "startManagedUpgrade").mockResolvedValue(operation("preparing"));
  const view = renderPanel();
  try {
    expect(await screen.findByText("build-current-exact")).not.toBeNull();
    expect(screen.getByText("build-latest-exact")).not.toBeNull();
    expect(screen.getByText("3 accepted beta releases ahead.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Upgrade to latest beta" }));
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    const key = start.mock.calls[0]?.[0];
    expect(key).toMatch(/^browser-[0-9a-f-]{36}$/);
    expect(await screen.findByText("Upgrade progress")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Upgrade to latest beta" })).toBeNull();
  } finally {
    view.unmount();
    view.client.clear();
  }
});

it("recovers progress, separates wait-only blockers, and confirms exact terminal termination", async () => {
  vi.spyOn(api, "getManagedUpgrade").mockResolvedValue(
    snapshot(
      operation("blocked", {
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
            kind: "workspace_mutation",
            message: "An active workspace mutation must finish before maintenance can start",
            actionable: false,
            action: "wait",
            target: null,
          },
        ],
      }),
    ),
  );
  const cancel = vi.spyOn(api, "cancelActiveRun").mockResolvedValue(undefined);
  const terminate = vi.spyOn(api, "terminateTerminal").mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const view = renderPanel();
  try {
    expect((await screen.findByText("Preparing — blocked")).getAttribute("aria-current")).toBe(
      "step",
    );
    expect(screen.getByText("Wait for this condition to clear.")).not.toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "An active terminal process must finish before maintenance can start",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop selected" }));
    await waitFor(() =>
      expect(terminate).toHaveBeenCalledExactlyOnceWith("session-2", "terminal-2"),
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    view.client.clear();
  }
});

it.each([
  ["safe-to-stop", "Maintenance confirmed"],
  ["replacing", "Replacing runtime"],
  ["starting/migrating", "Starting and migrating"],
  ["verifying", "Verifying"],
  ["succeeded", "Complete"],
] as const)("renders recovered %s progress as a distinct step", async (state, label) => {
  vi.spyOn(api, "getManagedUpgrade").mockResolvedValue(snapshot(operation(state)));
  const view = renderPanel();
  try {
    expect((await screen.findByText(label)).getAttribute("aria-current")).toBe("step");
  } finally {
    view.unmount();
    view.client.clear();
  }
});

it("offers an explicit retry after a sanitized failure", async () => {
  vi.spyOn(api, "getManagedUpgrade").mockResolvedValue(
    snapshot(operation("failed", { message: "The candidate did not become ready" })),
  );
  vi.spyOn(api, "startManagedUpgrade").mockResolvedValue(operation("preparing"));
  const view = renderPanel();
  try {
    expect((await screen.findByRole("status")).textContent).toContain(
      "The candidate did not become ready",
    );
    expect(screen.getByRole("button", { name: "Retry latest beta" })).not.toBeNull();
  } finally {
    view.unmount();
    view.client.clear();
  }
});
