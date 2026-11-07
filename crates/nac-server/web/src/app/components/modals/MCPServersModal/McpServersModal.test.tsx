/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { McpServersModal } from "./McpServersModal";

const state = vi.hoisted(() => ({ mobile: false, finish: () => {} }));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/app/services/queries", () => ({
  useMcpServers: () => ({ data: { servers: [{ name: "saved server" }] } }),
  useMcpLibrary: () => ({ data: { entries: [] } }),
}));
vi.mock("@/app/atoms", async (original) => ({
  ...(await original<object>()),
  // Retain closed content deliberately, modeling the phone's exit lifetime.
  Modal: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) => (
    <section role="region" aria-label={title} data-open={open}>
      {children}
    </section>
  ),
}));
vi.mock("./McpLibraryPicker", () => ({
  LibraryPicker: ({ onCustom }: { onCustom: () => void }) => (
    <button onClick={onCustom}>Custom</button>
  ),
}));
vi.mock("./McpServerForm", () => ({
  McpServerForm: ({
    record,
    onSaved,
    onClose,
  }: {
    record: { name: string } | null;
    onSaved: (name: string) => void;
    onClose: () => void;
  }) => {
    const [draft, setDraft] = useState("");
    return (
      <>
        <button
          onClick={() => {
            state.finish = () => onSaved("saved server");
          }}
        >
          Submit {record?.name ?? "custom"}
        </button>
        <button onClick={onClose}>Cancel form</button>
        <input
          aria-label="Draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </>
    );
  },
}));
beforeEach(() => {
  state.finish = () => {};
});
afterEach(cleanup);

it.each([false, true])(
  "retains a newer draft when an earlier form settles during its exit (phone: %s)",
  (mobile) => {
    state.mobile = mobile;
    render(<McpServersModal open onClose={() => {}} />);
    if (mobile) fireEvent.click(screen.getByRole("button", { name: /saved server/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit saved server" }));
    if (mobile) fireEvent.click(screen.getByRole("button", { name: "Cancel form" }));
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const draft = screen.getByLabelText("Draft");
    fireEvent.change(draft, { target: { value: "newer unsaved values" } });
    act(() => state.finish());
    expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("newer unsaved values");
    if (mobile)
      expect(screen.getByRole("region", { name: "Custom server" }).getAttribute("data-open")).toBe(
        "true",
      );
    else expect(screen.getByRole("button", { name: "Submit custom" })).toBeTruthy();
  },
);
