/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedUpgradePanel } from "@/app/features/managed/presentation/ManagedUpgradePanel";
import { managedQueryKeys } from "@/app/features/managed/queries";
import type {
  ManagedUpgradeBlocker,
  ManagedUpgradeOperation,
  ManagedUpgradeReleaseIdentity,
  ManagedUpgradeSnapshot,
} from "@/app/features/managed/upgrade";
import { api } from "@/app/services/api";

const current: ManagedUpgradeReleaseIdentity = {
  release_id: "0-1-4",
  source_revision: "a".repeat(40),
  build_id: "build-current",
  product_version: "0.1.4",
  schema_version: 24,
};
const latest: ManagedUpgradeReleaseIdentity = {
  release_id: "0-2-0-beta-2",
  source_revision: "b".repeat(40),
  build_id: "build-latest",
  product_version: "0.2.0-beta.2",
  schema_version: 25,
};
const accepted: ManagedUpgradeReleaseIdentity = {
  release_id: "0-2-0-beta-1",
  source_revision: "c".repeat(40),
  build_id: "build-accepted",
  product_version: "0.2.0-beta.1",
  schema_version: 25,
};

function operation(
  state: ManagedUpgradeOperation["state"],
  blockers: ManagedUpgradeBlocker[] = [],
): ManagedUpgradeOperation {
  return {
    operation_id: "018f47a5-34a7-7c91-bf7e-8f1042757001",
    managed_host_id: "018f47a5-34a7-7c91-bf7e-8f1042757301",
    kind: "upgrade",
    state,
    message: state === "failed" ? "The replacement could not be verified" : "Upgrade in progress",
    target_release: accepted,
    blockers,
  };
}

function snapshot(operationValue: ManagedUpgradeOperation | null = null): ManagedUpgradeSnapshot {
  return {
    preview: {
      current,
      latest_beta: latest,
      upgrade_available: true,
      distance: { accepted_releases: 2 },
    },
    operation: operationValue,
  };
}

const fakes = {
  snapshot: vi.fn(),
  start: vi.fn(),
  cancelExactRun: vi.fn(),
  cancelChild: vi.fn(),
  cancelOrchestrator: vi.fn(),
  terminateTerminal: vi.fn(),
  cancelClone: vi.fn(),
};

vi.spyOn(api, "getManagedUpgrade").mockImplementation((...args) => fakes.snapshot(...args));
vi.spyOn(api, "startManagedUpgrade").mockImplementation((...args) => fakes.start(...args));
vi.spyOn(api, "cancelExactRun").mockImplementation((...args) => fakes.cancelExactRun(...args));
vi.spyOn(api, "cancelTraditionalChild").mockImplementation((...args) => fakes.cancelChild(...args));
vi.spyOn(api, "cancelManagedOrchestrator").mockImplementation((...args) =>
  fakes.cancelOrchestrator(...args),
);
vi.spyOn(api, "terminateTerminal").mockImplementation((...args) =>
  fakes.terminateTerminal(...args),
);
vi.spyOn(api, "cancelManagedClone").mockImplementation((...args) => fakes.cancelClone(...args));

let client: QueryClient | null = null;

function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ManagedUpgradePanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakes.snapshot.mockReset().mockResolvedValue(snapshot());
  fakes.start.mockReset().mockResolvedValue(operation("preparing"));
  fakes.cancelExactRun.mockReset().mockResolvedValue(undefined);
  fakes.cancelChild.mockReset().mockResolvedValue({ status: "cancelled" });
  fakes.cancelOrchestrator.mockReset().mockResolvedValue({ status: "cancelled" });
  fakes.terminateTerminal.mockReset().mockResolvedValue(undefined);
  fakes.cancelClone.mockReset().mockResolvedValue({ status: "cancelled" });
  vi.stubGlobal("crypto", { randomUUID: () => "018f47a5-34a7-7c91-bf7e-8f1042757999" });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  client?.clear();
  client = null;
  vi.unstubAllGlobals();
});

describe("ManagedUpgradePanel", () => {
  it("shows exact current, latest, and frozen accepted identities with useful distance", async () => {
    fakes.snapshot.mockResolvedValue(snapshot(operation("replacing")));
    mount();

    expect(await screen.findByText("2 accepted releases ahead")).toBeTruthy();
    expect(screen.getByText(current.source_revision)).toBeTruthy();
    expect(screen.getByText(latest.source_revision)).toBeTruthy();
    expect(screen.getByText(accepted.source_revision)).toBeTruthy();
    expect(screen.getByText("Accepted target")).toBeTruthy();
    expect(screen.getByText("Replacing NAC")).toBeTruthy();
    expect(screen.getByText(operation("replacing").operation_id)).toBeTruthy();
  });

  it("confirms start and reuses one idempotency key after an uncertain failure", async () => {
    fakes.start
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(operation("preparing"));
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Upgrade to latest beta" }));
    expect(screen.getByRole("dialog", { name: "Upgrade Managed NAC?" })).toBeTruthy();
    expect(screen.getByText(/Active work must finish or be explicitly stopped/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start upgrade" }));
    expect((await screen.findByRole("alert")).textContent).toContain("temporarily unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Start upgrade" }));

    await waitFor(() => expect(fakes.start).toHaveBeenCalledTimes(2));
    expect(fakes.start.mock.calls[0]?.[0]).toBe("nac-upgrade-018f47a5-34a7-7c91-bf7e-8f1042757999");
    expect(fakes.start.mock.calls[1]?.[0]).toBe(fakes.start.mock.calls[0]?.[0]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Upgrade Managed NAC?" })).toBeNull(),
    );
  });

  it("reuses the same intent when an accepted start response fails contract decoding", async () => {
    fakes.start
      .mockResolvedValueOnce({ accepted_but_invalid: true })
      .mockResolvedValueOnce(operation("preparing"));
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Upgrade to latest beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Start upgrade" }));
    expect((await screen.findByRole("alert")).textContent).toContain("temporarily unavailable");
    expect(screen.getByRole("dialog", { name: "Upgrade Managed NAC?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start upgrade" }));

    await waitFor(() => expect(fakes.start).toHaveBeenCalledTimes(2));
    expect(fakes.start.mock.calls[1]?.[0]).toBe(fakes.start.mock.calls[0]?.[0]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Upgrade Managed NAC?" })).toBeNull(),
    );
  });

  it("retires an uncertain intent only after rediscovering its durable operation", async () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("018f47a5-34a7-7c91-bf7e-8f1042757999")
      .mockReturnValueOnce("018f47a5-34a7-7c91-bf7e-8f1042757888");
    vi.stubGlobal("crypto", { randomUUID });
    const discoveredOperation = { ...operation("preparing"), target_release: latest };
    fakes.snapshot
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot(discoveredOperation));
    fakes.start
      .mockResolvedValueOnce({ accepted_but_invalid: true })
      .mockResolvedValueOnce(operation("preparing"));
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Upgrade to latest beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Start upgrade" }));
    await waitFor(() => expect(fakes.snapshot).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Upgrade Managed NAC?" })).toBeNull(),
    );
    expect(screen.getByText("Preparing this host")).toBeTruthy();

    const nextLatest = {
      ...latest,
      release_id: "0-2-0-beta-3",
      source_revision: "d".repeat(40),
      build_id: "build-next",
      product_version: "0.2.0-beta.3",
    };
    if (!client) throw new Error("query client was not created");
    act(() => {
      client?.setQueryData<ManagedUpgradeSnapshot>(managedQueryKeys.upgrade, {
        preview: {
          current: latest,
          latest_beta: nextLatest,
          upgrade_available: true,
          distance: { accepted_releases: 1 },
        },
        operation: null,
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Upgrade to latest beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Start upgrade" }));

    await waitFor(() => expect(fakes.start).toHaveBeenCalledTimes(2));
    expect(fakes.start.mock.calls[0]?.[0]).toContain("018f47a5-34a7-7c91-bf7e-8f1042757999");
    expect(fakes.start.mock.calls[1]?.[0]).toContain("018f47a5-34a7-7c91-bf7e-8f1042757888");
    expect(fakes.start.mock.calls[1]?.[0]).not.toBe(fakes.start.mock.calls[0]?.[0]);
  });

  it("directs expired sessions back to the portal without offering a blind retry", async () => {
    fakes.snapshot.mockRejectedValue({ status: 401 });
    mount();

    expect(await screen.findByText(/Reopen this host from the Arcee portal/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers a status refresh when the managed host incarnation changed", async () => {
    fakes.snapshot.mockRejectedValue({ status: 409 });
    mount();

    expect(await screen.findByText(/This host session changed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeTruthy();
  });

  it.each([401, 403, 409])(
    "suppresses cached upgrade state and actions after a later %s response",
    async (status) => {
      fakes.snapshot.mockResolvedValueOnce(snapshot()).mockRejectedValue({ status });
      mount();

      expect(await screen.findByRole("button", { name: "Upgrade to latest beta" })).toBeTruthy();
      if (!client) throw new Error("query client was not created");
      await act(async () => {
        await client?.refetchQueries({ queryKey: managedQueryKeys.upgrade });
      });

      expect(await screen.findByTestId("managed-upgrade-unavailable")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Upgrade to latest beta" })).toBeNull();
      if (status === 409) {
        expect(screen.getByRole("button", { name: "Refresh status" })).toBeTruthy();
      } else {
        expect(screen.getByText(/Reopen this host from the Arcee portal/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      }
    },
  );

  it("retains cached in-progress state across a transient service failure", async () => {
    fakes.snapshot.mockResolvedValueOnce(snapshot(operation("replacing"))).mockRejectedValue({
      status: 503,
    });
    mount();

    expect(await screen.findByText("Replacing NAC")).toBeTruthy();
    if (!client) throw new Error("query client was not created");
    await act(async () => {
      await client?.refetchQueries({ queryKey: managedQueryKeys.upgrade });
    });

    expect(screen.getByText("Replacing NAC")).toBeTruthy();
    expect(screen.queryByTestId("managed-upgrade-unavailable")).toBeNull();
  });

  it("offers a safe retry for service and network availability failures", async () => {
    fakes.snapshot.mockRejectedValue({ status: 503 });
    mount();

    expect(await screen.findByText(/temporarily unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("offers only the controller's closed actionable blockers and waits for settlement", async () => {
    const blockers: ManagedUpgradeBlocker[] = [
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
        kind: "traditional_child",
        message: "An active child session must finish before maintenance can start",
        actionable: true,
        action: "cancel_traditional_child",
        target: { session_id: "session-1", child_session_id: "child-1" },
      },
      {
        selection_key: `sha256:${"3".repeat(64)}`,
        kind: "managed_orchestrator",
        message: "An active orchestrator must finish before maintenance can start",
        actionable: true,
        action: "cancel_managed_orchestrator",
        target: { session_id: "session-1", orchestrator_session_id: "orchestrator-1" },
      },
      {
        selection_key: `sha256:${"4".repeat(64)}`,
        kind: "terminal_process",
        message: "An active terminal process must finish before maintenance can start",
        actionable: true,
        action: "terminate_terminal",
        target: { session_id: "session-1", terminal_id: "shell-1" },
      },
      {
        selection_key: `sha256:${"5".repeat(64)}`,
        kind: "clone_operation",
        message: "An active repository clone must finish before maintenance can start",
        actionable: true,
        action: "cancel_clone_operation",
        target: { clone_operation_id: "clone-1" },
      },
      {
        selection_key: `sha256:${"6".repeat(64)}`,
        kind: "compaction",
        message: "An active compaction must finish before maintenance can start",
        actionable: false,
        action: "wait",
        target: null,
      },
    ];
    fakes.snapshot.mockResolvedValue(snapshot(operation("blocked", blockers)));
    mount();

    for (const name of [
      "Stop run",
      "Cancel coding agent",
      "Cancel NAC orchestrator",
      "Stop terminal",
      "Cancel clone",
    ]) {
      fireEvent.click(await screen.findByRole("button", { name }));
    }

    await waitFor(() => expect(fakes.cancelExactRun).toHaveBeenCalledWith("session-1", "run-1"));
    expect(fakes.cancelChild).toHaveBeenCalledWith("session-1", "child-1");
    expect(fakes.cancelOrchestrator).toHaveBeenCalledWith("session-1", "orchestrator-1");
    expect(fakes.terminateTerminal).toHaveBeenCalledWith("session-1", "shell-1");
    expect(fakes.cancelClone).toHaveBeenCalledWith("clone-1");
    expect(screen.getByText("Wait only")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Waiting for cleanup")).toHaveLength(5));
  });

  it("binds active-run settlement directly to the exact blocker run", async () => {
    const blocker: ManagedUpgradeBlocker = {
      selection_key: `sha256:${"7".repeat(64)}`,
      kind: "active_run",
      message: "An active run must finish before maintenance can start",
      actionable: true,
      action: "cancel_active_run",
      target: { session_id: "session-1", run_id: "old-run" },
    };
    fakes.snapshot.mockResolvedValue(snapshot(operation("blocked", [blocker])));
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Stop run" }));

    await waitFor(() => expect(fakes.cancelExactRun).toHaveBeenCalledWith("session-1", "old-run"));
    expect(await screen.findByText("Waiting for cleanup")).toBeTruthy();
  });

  it("recovers terminal success and failed retry controls entirely from the durable snapshot", async () => {
    const completed = snapshot(operation("succeeded"));
    completed.preview = {
      current: latest,
      latest_beta: latest,
      upgrade_available: false,
      distance: { accepted_releases: 0 },
    };
    fakes.snapshot.mockResolvedValueOnce(completed);
    mount();
    expect(await screen.findByText("Upgrade complete")).toBeTruthy();
    expect(screen.getByText("Up to date")).toBeTruthy();

    if (!client) throw new Error("query client was not created");
    client.setQueryData(managedQueryKeys.upgrade, snapshot(operation("failed")));
    expect(await screen.findByText("Upgrade failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry upgrade to latest beta" })).toBeTruthy();
  });
});
