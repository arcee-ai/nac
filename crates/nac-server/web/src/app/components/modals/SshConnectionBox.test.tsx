/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SshConnectionBox } from "./SshConnectionBox";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type { OpenSshAliasList, SshConfigurationRecord } from "@/app/types/api";

const saved: SshConfigurationRecord = {
  config_id: "saved-lab",
  name: "Saved lab",
  ssh_host: "lab.example",
  ssh_port: 2200,
  ssh_identity_file: "/keys/lab",
  created_at: "today",
  updated_at: "today",
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderBox(aliases: () => Promise<OpenSshAliasList>) {
  vi.spyOn(api, "listSshConfigs").mockResolvedValue({
    configurations: [saved],
  });
  vi.spyOn(api, "listSshAliases").mockImplementation(aliases);
  const connect = vi.spyOn(api, "browseSshPath");
  const onConnectionChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SshConnectionBox mode="launch" connection={null} onConnectionChange={onConnectionChange} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { view, connect, onConnectionChange, client };
}

async function openMenu() {
  fireEvent.click(await screen.findByRole("button", { name: "Create New" }));
}

it("separates saved profiles from server OpenSSH aliases and fills only the host", async () => {
  const { view, connect, onConnectionChange, client } = renderBox(() =>
    Promise.resolve({
      aliases: ["build-box", "staging"],
      undiscoverable_patterns: 1,
      warnings: [],
    }),
  );
  try {
    await openMenu();
    const savedGroup = screen.getByRole("group", {
      name: "Saved NAC profiles",
    });
    const aliasGroup = screen.getByRole("group", { name: "OpenSSH aliases" });
    expect(aliasGroup.textContent).toContain("from the NAC server's ~/.ssh/config");
    await within(savedGroup).findByRole("button", { name: "Saved lab" });
    await within(aliasGroup).findByRole("button", { name: "staging" });
    expect(within(aliasGroup).queryByRole("button", { name: "Saved lab" })).toBeNull();
    expect(within(savedGroup).queryByRole("button", { name: "staging" })).toBeNull();
    expect(aliasGroup.textContent).toContain("1 wildcard or negated pattern isn't listed");

    // A saved profile first, so the alias must clear its port and key.
    fireEvent.click(within(savedGroup).getByRole("button", { name: "Saved lab" }));
    expect(screen.getByPlaceholderText<HTMLInputElement>("22").value).toBe("2200");
    fireEvent.click(screen.getByRole("button", { name: "Saved lab" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "OpenSSH aliases" })).getByRole("button", {
        name: "staging",
      }),
    );

    const host = screen.getByPlaceholderText<HTMLInputElement>("example@192.0.2.10 or build-box");
    expect(host.value).toBe("staging");
    expect(screen.getByPlaceholderText<HTMLInputElement>("22").value).toBe("");
    expect(screen.getByRole("button", { name: ".ssh/config" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "staging" })).toBeTruthy();
    expect(connect).not.toHaveBeenCalled();
    expect(onConnectionChange).not.toHaveBeenCalled();

    // Connect stays explicit and sends the alias for OpenSSH to resolve.
    connect.mockResolvedValue({
      path: "/home/remote",
      entries: [],
      truncated: false,
    } as never);
    vi.spyOn(api, "createSshConfig").mockResolvedValue({
      ...saved,
      config_id: "new",
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith(
        { ssh_host: "staging", ssh_port: null, ssh_identity_file: null },
        null,
      ),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("keeps discovery problems to a quiet hint while saved profiles still work", async () => {
  const { view, client } = renderBox(() => Promise.reject(new Error("boom")));
  try {
    await openMenu();
    const aliasGroup = screen.getByRole("group", { name: "OpenSSH aliases" });
    await waitFor(() =>
      expect(aliasGroup.textContent).toContain("Couldn't read the NAC server's SSH config"),
    );
    expect(aliasGroup.textContent).not.toContain("boom");
    expect(
      within(screen.getByRole("group", { name: "Saved NAC profiles" })).getByRole("button", {
        name: "Saved lab",
      }),
    ).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("says when the server has no literal aliases or only a partial list", async () => {
  const { view, client } = renderBox(() =>
    Promise.resolve({
      aliases: [],
      undiscoverable_patterns: 0,
      warnings: ["unreadable_file"],
    }),
  );
  try {
    await openMenu();
    const aliasGroup = screen.getByRole("group", { name: "OpenSSH aliases" });
    await waitFor(() =>
      expect(aliasGroup.textContent).toContain("No literal Host aliases found on the NAC server."),
    );
    expect(aliasGroup.textContent).toContain("this list may be partial");
    expect(within(aliasGroup).queryAllByRole("button")).toHaveLength(0);
  } finally {
    view.unmount();
    client.clear();
  }
});
