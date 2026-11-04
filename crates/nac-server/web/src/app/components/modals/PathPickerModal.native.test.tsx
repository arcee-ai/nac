/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { PathPickerModal } from "./PathPickerModal";

const browse = vi.hoisted(() => ({ local: vi.fn(), ssh: vi.fn() }));
vi.mock("@/app/services/queries", () => ({
  useBrowsePath: browse.local,
  useSshBrowsePath: browse.ssh,
}));
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  browse.local.mockReset().mockReturnValue({ data: { path: "/server", entries: [] } });
  browse.ssh.mockReset().mockReturnValue({ data: { path: "/remote", entries: [] } });
});
afterEach(() => vi.unstubAllGlobals());

it("uses the native Local directory capability without starting either server browser", async () => {
  const chooseDirectory = vi.fn(async () => "/tmp/日本語 space");
  const selected = vi.fn();
  const view = render(
    <MemoryRouter>
      <RuntimeContext.Provider
        value={{ ...standaloneRuntime, nativeDirectory: { chooseDirectory } }}
      >
        <PathPickerModal
          open
          kind="directory"
          nativeLocalDirectory
          initialPath="/initial"
          onClose={vi.fn()}
          onSelect={selected}
        />
      </RuntimeContext.Provider>
    </MemoryRouter>,
  );
  try {
    await waitFor(() => expect(selected).toHaveBeenCalledWith("/tmp/日本語 space"));
    expect(chooseDirectory).toHaveBeenCalledOnce();
    expect(browse.local).not.toHaveBeenCalled();
    expect(browse.ssh).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

it.each([
  [false, "directory", null],
  [true, "file", null],
  [true, "directory", { ssh_host: "remote", ssh_port: null, ssh_identity_file: null }],
] as const)("retains API browsing for non-Local authority or a file picker", (local, kind, ssh) => {
  const chooseDirectory = vi.fn(async () => "/must-not-open");
  const view = render(
    <MemoryRouter>
      <RuntimeContext.Provider
        value={{ ...standaloneRuntime, nativeDirectory: { chooseDirectory } }}
      >
        <PathPickerModal
          open
          kind={kind}
          nativeLocalDirectory={local}
          ssh={ssh}
          initialPath=""
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      </RuntimeContext.Provider>
    </MemoryRouter>,
  );
  try {
    expect(chooseDirectory).not.toHaveBeenCalled();
    expect(browse.local).toHaveBeenCalledWith(null, kind, false, !ssh);
    expect(browse.ssh).toHaveBeenCalledWith(ssh, null, false, Boolean(ssh));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  } finally {
    view.unmount();
  }
});
