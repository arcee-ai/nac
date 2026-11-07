/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import { McpServersModal } from "./McpServersModal";

const state = vi.hoisted(() => ({
  mobile: false,
  finish: () => {},
  completions: [] as string[],
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/app/services/queries", () => ({
  useMcpServers: () => ({
    data: { servers: [{ name: "saved server" }, { name: "accepted server" }] },
  }),
  useMcpLibrary: () => ({ data: { entries: [] } }),
}));
vi.mock("./McpLibraryPicker", () => ({
  LibraryPicker: ({ onPick }: { onPick: (entry: object) => void }) => (
    <button onClick={() => onPick({ id: "template", name: "template server" })}>
      Choose template
    </button>
  ),
}));
vi.mock("./McpServerForm", () => ({
  McpServerForm: ({
    record,
    template,
    onSaved,
    onDeleted,
  }: {
    record: { name: string } | null;
    template: { name: string } | null;
    onSaved: (name: string) => void;
    onDeleted: () => void;
  }) => {
    const [draft, setDraft] = useState("");
    const finishLater = async (operation: "save" | "delete") => {
      await new Promise<void>((resolve) => {
        state.finish = resolve;
      });
      state.completions.push(operation);
      if (operation === "save") onSaved("accepted server");
      else onDeleted();
    };
    return (
      <>
        <span data-testid="form-selection">{record?.name ?? template?.name}</span>
        <input
          aria-label="Draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button onClick={() => void finishLater("save")}>Start save</button>
        <button onClick={() => void finishLater("delete")}>Start delete</button>
      </>
    );
  },
}));

beforeEach(() => {
  state.finish = () => {};
  state.completions = [];
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function tree(open: boolean) {
  return (
    <MemoryRouter>
      <PresentationBoundary>
        <McpServersModal open={open} onClose={() => {}} />
      </PresentationBoundary>
    </MemoryRouter>
  );
}
function select(origin: "record" | "template") {
  if (origin === "record") fireEvent.click(screen.getByRole("button", { name: "saved server" }));
  else {
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose template" }));
  }
}
function currentDraft() {
  return screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement;
}

for (const mobile of [false, true]) {
  for (const origin of ["record", "template"] as const) {
    for (const operation of ["save", "delete"] as const) {
      // Templates create rather than delete stored entries.
      if (origin === "template" && operation === "delete") continue;
      it(`ignores old ${operation} after outer close/reopen of the same ${origin} (${mobile ? "phone" : "desktop"})`, async () => {
        state.mobile = mobile;
        const view = render(tree(true));
        select(origin);
        const selected = screen.getByTestId("form-selection").textContent;
        const previousInput = currentDraft();
        fireEvent.click(screen.getByRole("button", { name: `Start ${operation}` }));
        view.rerender(tree(false));
        // Exercise the actual useExitTransition and Modal owners, within their 300ms exit.
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
        });
        view.rerender(tree(true));
        expect(screen.getByTestId("form-selection").textContent).toBe(selected);
        if (mobile) expect(currentDraft()).toBe(previousInput);
        else expect(currentDraft()).not.toBe(previousInput);
        fireEvent.change(currentDraft(), { target: { value: "newer reopened draft" } });
        await act(async () => {
          state.finish();
          await Promise.resolve();
        });
        expect(state.completions).toEqual([operation]);
        expect(screen.getByTestId("form-selection").textContent).toBe(selected);
        expect(currentDraft().value).toBe("newer reopened draft");
      });
    }
  }
  it(`accepts current-form save and delete after reopen (${mobile ? "phone" : "desktop"})`, async () => {
    state.mobile = mobile;
    const view = render(tree(true));
    select("record");
    view.rerender(tree(false));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    view.rerender(tree(true));
    fireEvent.click(screen.getByRole("button", { name: "Start save" }));
    await act(async () => {
      state.finish();
      await Promise.resolve();
    });
    if (mobile) {
      // Current success returns to the list. Reopen the resulting stored entry.
      fireEvent.click(screen.getByRole("button", { name: "accepted server" }));
    }
    expect(screen.getByTestId("form-selection").textContent).toBe("accepted server");
    fireEvent.click(screen.getByRole("button", { name: "Start delete" }));
    await act(async () => {
      state.finish();
      await Promise.resolve();
    });
    expect(state.completions).toEqual(["save", "delete"]);
    if (mobile) {
      expect(currentDraft().closest('[role="dialog"]')?.getAttribute("data-modal-open")).toBeNull();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 320));
      });
      expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();
    } else expect(screen.getByRole("button", { name: "Choose template" })).toBeTruthy();
  });
  it(`accepts current template save after reopen (${mobile ? "phone" : "desktop"})`, async () => {
    state.mobile = mobile;
    const view = render(tree(true));
    select("template");
    view.rerender(tree(false));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    view.rerender(tree(true));
    fireEvent.click(screen.getByRole("button", { name: "Start save" }));
    await act(async () => {
      state.finish();
      await Promise.resolve();
    });
    expect(state.completions).toEqual(["save"]);
    if (mobile) fireEvent.click(screen.getByRole("button", { name: "accepted server" }));
    expect(screen.getByTestId("form-selection").textContent).toBe("accepted server");
  });
}

for (const operation of ["save", "delete"] as const) {
  for (const reselect of ["before submit", "while pending"] as const) {
    it(`accepts current desktop ${operation} after same-server selection ${reselect}`, async () => {
      state.mobile = false;
      render(tree(true));
      const choose = () => fireEvent.click(screen.getByRole("button", { name: "saved server" }));
      choose();
      const draft = currentDraft();
      fireEvent.change(draft, { target: { value: "current unsaved values" } });
      if (reselect === "while pending")
        fireEvent.click(screen.getByRole("button", { name: `Start ${operation}` }));
      // Exercise stable no-op state updates after the selection is already explicit.
      choose();
      choose();
      expect(currentDraft()).toBe(draft);
      expect(currentDraft().value).toBe("current unsaved values");
      if (reselect === "before submit")
        fireEvent.click(screen.getByRole("button", { name: `Start ${operation}` }));
      await act(async () => {
        state.finish();
        await Promise.resolve();
      });
      expect(state.completions).toEqual([operation]);
      if (operation === "save")
        expect(screen.getByTestId("form-selection").textContent).toBe("accepted server");
      else expect(screen.getByRole("button", { name: "Choose template" })).toBeTruthy();
    });
  }
}
