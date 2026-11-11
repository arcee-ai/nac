/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { createSessionLayoutStore } from "@/app/store/sessionLayoutStore";
import type { SessionSnapshotResponse, WorkspaceFileList } from "@/app/types/api";
import { useRevealSelection } from "./selection";

const path = "packages/app/src/日本語 file.txt";
const selectedRoot = "/repo/packages/app";
const snapshot = {
  metadata: { session_id: "session", workspace_host_path: selectedRoot },
  workspace: { host_root: selectedRoot },
} as SessionSnapshotResponse;
const listing: WorkspaceFileList = { files: [path], truncated: false, path_root: "/repo" };

function fixture(initialSelected: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createSessionLayoutStore();
  if (initialSelected) store.selectFile(initialSelected);
  const runtime = {
    ...standaloneRuntime,
    stores: { ...standaloneRuntime.stores, sessionLayoutStore: store },
  };
  function Selection({
    files = listing,
    id = "session",
    active = true,
  }: {
    files?: WorkspaceFileList;
    id?: string;
    active?: boolean;
  }) {
    const selected = store.useSelectedFile();
    const result = useRevealSelection({
      sessionId: id,
      snapshot,
      listing: files,
      selected,
      current: selected ?? path,
      active,
    });
    return (
      <>
        <output data-testid="origin">{JSON.stringify(result.origin)}</output>
        <button onClick={() => result.selectFile(path)}>Select file</button>
      </>
    );
  }
  const wrapper = ({ children }: { children: import("react").ReactNode }) => (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
  const view = render(<Selection />, { wrapper });
  return { view, client, Selection };
}

it("pins the original listing coordinates across refresh and panel remount; explicit reselection can change them", async () => {
  const { view, client, Selection } = fixture();
  try {
    await waitFor(() =>
      expect(screen.getByTestId("origin").textContent).toContain('"pathRoot":"/repo"'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Select file" }));
    view.rerender(<Selection files={{ ...listing, path_root: selectedRoot }} />);
    expect(screen.getByTestId("origin").textContent).toContain('"pathRoot":"/repo"');
    view.rerender(<></>);
    view.rerender(<Selection files={{ ...listing, path_root: selectedRoot }} />);
    expect(screen.getByTestId("origin").textContent).toContain('"pathRoot":"/repo"');
    fireEvent.click(screen.getByRole("button", { name: "Select file" }));
    await waitFor(() =>
      expect(screen.getByTestId("origin").textContent).toContain('"pathRoot":"/repo/packages/app"'),
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

it("does not bind an inherited selection in a fresh runtime or another session", async () => {
  const { view, client, Selection } = fixture(path);
  try {
    expect(screen.getByTestId("origin").textContent).toBe("null");
    fireEvent.click(screen.getByRole("button", { name: "Select file" }));
    await waitFor(() =>
      expect(screen.getByTestId("origin").textContent).toContain('"pathRoot":"/repo"'),
    );
    view.rerender(<Selection id="other" />);
    expect(screen.getByTestId("origin").textContent).toBe("null");
  } finally {
    view.unmount();
    client.clear();
  }
});

it("refuses missing legacy coordinates, absent rows and historical/placeholder listings", async () => {
  const { view, client, Selection } = fixture(path);
  try {
    for (const files of [
      { ...listing, path_root: null },
      { ...listing, files: [] },
    ]) {
      view.rerender(<Selection files={files} />);
      fireEvent.click(screen.getByRole("button", { name: "Select file" }));
      await waitFor(() => expect(screen.getByTestId("origin").textContent).toBe("null"));
    }
    view.rerender(<Selection active={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Select file" }));
    expect(screen.getByTestId("origin").textContent).toBe("null");
  } finally {
    view.unmount();
    client.clear();
  }
});
