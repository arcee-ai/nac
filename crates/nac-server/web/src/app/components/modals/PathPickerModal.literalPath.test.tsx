/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { api } from "@/app/services/api";
import type { BrowseListing, SshTarget } from "@/app/types/api";

const literal = "/workspace/Project 日本語 ";
const listing = (path: string | null): BrowseListing => ({
  path: path ?? "/workspace",
  parent: "/workspace",
  home: "/home/test",
  entries: [],
  truncated: false,
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(api, "browsePath").mockImplementation(async (path) => listing(path));
  vi.spyOn(api, "browseSshPath").mockImplementation(async (_ssh, path) => listing(path ?? null));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function picker(initialPath = literal, ssh?: SshTarget) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const content = (open: boolean, path = initialPath) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PathPickerModal
          open={open}
          kind="directory"
          initialPath={path}
          ssh={ssh}
          onSelect={onSelect}
          onClose={onClose}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(content(true));
  return {
    view,
    content,
    client,
    onSelect,
    onClose,
    dispose: () => {
      view.unmount();
      client.clear();
    },
  };
}

it.each([literal, "/workspace/ordinary", " relative leading and trailing "])(
  "keeps the exact nonblank local initial path %j through selection",
  async (path) => {
    const p = picker(path);
    try {
      await waitFor(() =>
        expect(api.browsePath).toHaveBeenCalledWith(
          path,
          "directory",
          false,
          expect.any(AbortSignal),
        ),
      );
      expect((screen.getByPlaceholderText("/path/to/directory") as HTMLInputElement).value).toBe(
        path,
      );
      await waitFor(() =>
        expect(screen.getByText(/^Selected:/).textContent).toBe(`Selected: ${path}`),
      );
      fireEvent.click(screen.getByRole("button", { name: "Select" }));
      expect(p.onSelect).toHaveBeenCalledWith(path);
    } finally {
      p.dispose();
    }
  },
);

it("keeps typed local paths exact after IME composition and uses the blank fallback only for whitespace", async () => {
  const p = picker("/workspace");
  try {
    const input = screen.getByPlaceholderText("/path/to/directory");
    await waitFor(() => expect(api.browsePath).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: literal } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(api.browsePath).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    await waitFor(() =>
      expect(api.browsePath).toHaveBeenCalledWith(
        literal,
        "directory",
        false,
        expect.any(AbortSignal),
      ),
    );
    fireEvent.change(input, { target: { value: " \t " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(api.browsePath).toHaveBeenCalledWith(
        null,
        "directory",
        false,
        expect.any(AbortSignal),
      ),
    );
    expect((input as HTMLInputElement).value).toBe("");
  } finally {
    p.dispose();
  }
});

it("retains the existing SSH trimming contract", async () => {
  const ssh = { ssh_host: "fixture-host" };
  const p = picker(" ~/remote ", ssh);
  try {
    await waitFor(() =>
      expect(api.browseSshPath).toHaveBeenCalledWith(
        ssh,
        "~/remote",
        false,
        expect.any(AbortSignal),
      ),
    );
    const input = screen.getByPlaceholderText("~/path/on/the/host");
    fireEvent.change(input, { target: { value: " ~/another " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(api.browseSshPath).toHaveBeenCalledWith(
        ssh,
        "~/another",
        false,
        expect.any(AbortSignal),
      ),
    );
    expect(api.browsePath).not.toHaveBeenCalled();
  } finally {
    p.dispose();
  }
});

it("ignores stale browse results after exact-path navigation and cancel never selects", async () => {
  let resolveOld!: (value: BrowseListing) => void;
  vi.mocked(api.browsePath).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const p = picker("/old");
  try {
    await waitFor(() => expect(api.browsePath).toHaveBeenCalledTimes(1));
    const input = screen.getByPlaceholderText("/path/to/directory");
    fireEvent.change(input, { target: { value: literal } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(api.browsePath).toHaveBeenCalledWith(
        literal,
        "directory",
        false,
        expect.any(AbortSignal),
      ),
    );
    await act(async () => resolveOld(listing("/old")));
    await waitFor(() =>
      expect(screen.getByText(/^Selected:/).textContent).toBe(`Selected: ${literal}`),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onClose).toHaveBeenCalledOnce();
    expect(p.onSelect).not.toHaveBeenCalled();
  } finally {
    p.dispose();
  }
});

it("aborts a detached request and reopens with the exact new initial path", async () => {
  vi.mocked(api.browsePath).mockImplementationOnce(() => new Promise(() => {}));
  const p = picker("/old");
  try {
    await waitFor(() => expect(api.browsePath).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(api.browsePath).mock.calls[0]![3]!;
    p.view.rerender(p.content(false));
    await waitFor(() => expect(signal.aborted).toBe(true));
    expect(p.onSelect).not.toHaveBeenCalled();
    p.view.rerender(p.content(true, literal));
    await waitFor(() =>
      expect(api.browsePath).toHaveBeenCalledWith(
        literal,
        "directory",
        false,
        expect.any(AbortSignal),
      ),
    );
    expect((screen.getByPlaceholderText("/path/to/directory") as HTMLInputElement).value).toBe(
      literal,
    );
  } finally {
    p.dispose();
  }
});
