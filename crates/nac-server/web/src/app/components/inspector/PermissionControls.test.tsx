/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionPanel } from "@/app/components/inspector/PermissionControls";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { PermissionStateResponse } from "@/app/types/api";

const SESSION_ID = "direct-session";

const fakes = {
  getPermissions: vi.fn(),
  replyPermission: vi.fn(),
  deletePermissionGrant: vi.fn(),
};

vi.spyOn(api, "getPermissions").mockImplementation((...args) => fakes.getPermissions(...args));
vi.spyOn(api, "replyPermission").mockImplementation((...args) => fakes.replyPermission(...args));
vi.spyOn(api, "deletePermissionGrant").mockImplementation((...args) =>
  fakes.deletePermissionGrant(...args),
);

function pendingState(): PermissionStateResponse {
  return {
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

function mount(state: PermissionStateResponse) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.sessionPermissions(SESSION_ID), state);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <PermissionPanel sessionId={SESSION_ID} behavior="direct" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakes.getPermissions.mockReset().mockResolvedValue({ requests: [], grants: [] });
  fakes.replyPermission.mockReset().mockResolvedValue(undefined);
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
  it("opens a new request and sends the explicit always reply", async () => {
    mount(pendingState());

    expect(screen.getByLabelText("Requested access").textContent).toContain("cargo test");
    expect(screen.getByRole("button", { name: "Always allow" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));

    await waitFor(() =>
      expect(fakes.replyPermission).toHaveBeenCalledWith(SESSION_ID, "request-1", "always"),
    );
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

    expect(screen.getByLabelText("Requested access").textContent).toContain(
      '"rm -rf important<RET>"',
    );
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
            <PermissionPanel sessionId={SESSION_ID} behavior="orchestrator" />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("region", { name: "Permissions" })).toBeNull();
    expect(fakes.getPermissions).not.toHaveBeenCalled();
  });
});
