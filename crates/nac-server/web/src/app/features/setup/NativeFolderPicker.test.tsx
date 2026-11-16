/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeFolderPicker } from "./NativeFolderPicker";
import { MemoryRouter } from "react-router-dom";

function Router({ children }: { children: import("react").ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("returns a selection once, and cancels the native request on close", async () => {
  const pending = Promise.withResolvers<string | null>();
  const port = { chooseDirectory: vi.fn((_path: string, _signal: AbortSignal) => pending.promise) };
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <NativeFolderPicker
      port={port}
      initialPath="/original"
      open
      onSelect={onSelect}
      onClose={onClose}
    />,
    { wrapper: Router },
  );
  try {
    await waitFor(() => expect(port.chooseDirectory).toHaveBeenCalledOnce());
    pending.resolve("/Project with spaces/日本語");
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/Project with spaces/日本語"));
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(
      <NativeFolderPicker
        port={port}
        initialPath="/original"
        open={false}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    expect(port.chooseDirectory.mock.calls[0]![1].aborted).toBe(true);
    expect(onSelect).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
  }
});

it("does not fill a successor form after unmount or backend replacement", async () => {
  const pending = Promise.withResolvers<string | null>();
  const port = { chooseDirectory: vi.fn((_path: string, _signal: AbortSignal) => pending.promise) };
  const old = vi.fn();
  const view = render(
    <NativeFolderPicker port={port} initialPath="/old" open onSelect={old} onClose={vi.fn()} />,
    { wrapper: Router },
  );
  await waitFor(() => expect(port.chooseDirectory).toHaveBeenCalledOnce());
  view.unmount();
  expect(port.chooseDirectory.mock.calls[0]![1].aborted).toBe(true);
  pending.resolve("/stale");
  await pending.promise;
  expect(old).not.toHaveBeenCalled();
});

it("keeps a failed picker visible and requires an explicit retry", async () => {
  const port = {
    chooseDirectory: vi.fn(async () => {
      throw new Error("Workspace replaced");
    }),
  };
  const view = render(
    <NativeFolderPicker port={port} initialPath="" open onSelect={vi.fn()} onClose={vi.fn()} />,
    { wrapper: Router },
  );
  try {
    expect(await screen.findByText("Workspace replaced")).toBeTruthy();
    expect(port.chooseDirectory).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    await waitFor(() => expect(port.chooseDirectory).toHaveBeenCalledTimes(2));
  } finally {
    view.unmount();
  }
});
