/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionControls } from "@/app/components/inspector/PermissionControls";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { PermissionStateResponse } from "@/app/types/api";

const SESSION_ID = "direct-session";

const fakes = {
  getPermissions: vi.fn(),
  replyPermission: vi.fn(),
  setPermissionApprovalMode: vi.fn(),
  deletePermissionGrant: vi.fn(),
};

vi.spyOn(api, "getPermissions").mockImplementation((...args) => fakes.getPermissions(...args));
vi.spyOn(api, "replyPermission").mockImplementation((...args) => fakes.replyPermission(...args));
vi.spyOn(api, "setPermissionApprovalMode").mockImplementation((...args) =>
  fakes.setPermissionApprovalMode(...args),
);
vi.spyOn(api, "deletePermissionGrant").mockImplementation((...args) =>
  fakes.deletePermissionGrant(...args),
);

function pendingState(): PermissionStateResponse {
  return {
    approval_mode: "manual",
    requests: [
      {
        id: "request-1",
        session_id: SESSION_ID,
        call_id: "call-1",
        tool: "exec_command",
        created_at_epoch_ms: 1,
        resources: [
          {
            action: "execute",
            resource: "command:[cargo][test]",
            display: "cargo test",
            save_resource: "command:[cargo][test]*",
          },
        ],
      },
    ],
    grants: [],
  };
}

function mount(state: PermissionStateResponse, requesterLabel?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.sessionPermissions(SESSION_ID), state);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <PermissionControls
            sessionId={SESSION_ID}
            behavior="direct"
            requesterLabel={requesterLabel}
          />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakes.getPermissions.mockReset().mockResolvedValue({ requests: [], grants: [] });
  fakes.replyPermission.mockReset().mockResolvedValue(undefined);
  fakes.setPermissionApprovalMode.mockReset().mockResolvedValue(undefined);
  fakes.deletePermissionGrant.mockReset().mockResolvedValue(undefined);
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
  vi.unstubAllGlobals();
});

describe("direct permission controls", () => {
  it("keeps a large remembered-grant list in the bounded scrolling modal body", () => {
    const state = pendingState();
    state.grants = Array.from({ length: 20 }, (_, index) => ({
      id: `grant-${index}`,
      session_id: SESSION_ID,
      action: "read",
      resource: `/outside/workspace/dependency-${index}/a-long-resource-name.rs`,
      backend: "local",
      session_config_version: 1,
      created_at: `2026-09-08T00:00:${String(index).padStart(2, "0")}Z`,
    }));
    mount(state);

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[calc(100vh-2rem)]");
    expect(dialog.className).toContain("overflow-hidden");
    const scrollingBody = Array.from(dialog.children).find((element) =>
      element.className.includes("overflow-auto"),
    );
    expect(scrollingBody).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Always allow" })).toBeTruthy();
  });

  it("opens a new request and sends the explicit always reply", async () => {
    mount(pendingState());

    expect(screen.getByRole("dialog").textContent).toContain("cargo test");
    expect(screen.getByRole("button", { name: "Always allow" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));

    await waitFor(() =>
      expect(fakes.replyPermission).toHaveBeenCalledWith(SESSION_ID, "request-1", "always"),
    );
  });

  it("makes session-wide automatic approval discoverable and drains the pending request", async () => {
    mount(pendingState());

    const toggle = screen.getByRole("switch", { name: "Approve all automatically" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("dialog").textContent).toContain(
      "This setting governs this session and all existing or future owned child agents",
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Separately managed orchestrators are not included",
    );
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(fakes.setPermissionApprovalMode).toHaveBeenCalledWith(SESSION_ID, "auto_approve"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Auto-approve on — open permissions" }),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Automatic approval is active for this session and its owned child agents.",
    );
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
  });

  it("identifies a child requester and explains why manual approval applies", () => {
    const state = pendingState();
    state.requests[0].session_id = "child-session";
    mount(state, "child agent “Review persistence”");

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(
      "exec_command requested by child agent “Review persistence” is paused before execution.",
    );
    expect(dialog.textContent).toContain(
      "Requested by child agent “Review persistence” (child-session)",
    );
    expect(dialog.textContent).toContain(
      "automatic approval is off for this session and its owned child agents",
    );
  });

  it("keeps the active mode conspicuous and provides an immediate disable control", async () => {
    const state = pendingState();
    state.approval_mode = "auto_approve";
    state.requests = [];
    mount(state);

    fireEvent.click(screen.getByRole("button", { name: "Auto-approve on — open permissions" }));
    const toggle = screen.getByRole("switch", { name: "Approve all automatically" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(fakes.setPermissionApprovalMode).toHaveBeenCalledWith(SESSION_ID, "manual"),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Permissions" })).toBeTruthy());
  });

  it("identifies each child control and explains inherited automatic approval", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const automatic = { ...pendingState(), approval_mode: "auto_approve" as const, requests: [] };
    client.setQueryData(queryKeys.sessionPermissions("child-review"), automatic);
    client.setQueryData(queryKeys.sessionPermissions("child-tests"), automatic);

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            <PermissionControls
              sessionId="child-review"
              behavior="direct"
              label="Permissions for Review persistence"
              autoApprovalAvailable={false}
              requesterLabel="child agent “Review persistence”"
            />
            <PermissionControls
              sessionId="child-tests"
              behavior="direct"
              label="Permissions for Run tests"
              autoApprovalAvailable={false}
              requesterLabel="child agent “Run tests”"
            />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const reviewControl = screen.getByRole("button", {
      name: "Permissions for Review persistence — auto-approve inherited; open permissions",
    });
    expect(
      screen.getByRole("button", {
        name: "Permissions for Run tests — auto-approve inherited; open permissions",
      }),
    ).toBeTruthy();

    fireEvent.click(reviewControl);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(
      "Automatic approval is inherited from the parent session; change it from the parent.",
    );
    expect(dialog.textContent).toContain(
      "Ordinary requests from this child agent inherit automatic approval from the parent session.",
    );
    expect(screen.queryByRole("switch", { name: "Approve all automatically" })).toBeNull();
  });

  it("reconciles a mode change made through another server process", async () => {
    const manual = pendingState();
    manual.requests = [];
    const automatic = { ...manual, approval_mode: "auto_approve" as const };
    fakes.getPermissions.mockResolvedValueOnce(manual).mockResolvedValue(automatic);
    mount(manual);

    expect(screen.getByRole("button", { name: "Permissions" })).toBeTruthy();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Auto-approve on — open permissions" }),
        ).toBeTruthy(),
      { timeout: 2_500 },
    );
    expect(fakes.getPermissions.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps always unavailable when the harness cannot derive a safe grant", () => {
    const state = pendingState();
    delete state.requests[0].resources[0].save_resource;
    mount(state);

    expect(screen.getByRole("button", { name: "Always allow" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Allow once" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Reject" }).hasAttribute("disabled")).toBe(false);
  });

  it("renders the exact escaped terminal input and keeps it once-only", () => {
    const state = pendingState();
    state.requests[0].tool = "write_stdin";
    state.requests[0].resources = [
      {
        action: "terminal_input",
        resource: "shell-owner-1",
        display:
          "send exact input \"rm -rf important<RET>\" to terminal handle 'shell-owner-1' on the local backend; the running process may interpret these bytes as commands",
      },
    ];
    mount(state);

    expect(screen.getByRole("dialog").textContent).toContain('"rm -rf important<RET>"');
    expect(screen.getByRole("button", { name: "Always allow" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("does not fetch or render controls for orchestrator sessions", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            <PermissionControls sessionId={SESSION_ID} behavior="orchestrator" />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("button", { name: /^Permissions/ })).toBeNull();
    expect(fakes.getPermissions).not.toHaveBeenCalled();
  });
});
