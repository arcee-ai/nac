/** @vitest-environment jsdom */

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, Modal, Select, Tooltip } from "@/app/atoms";
import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

vi.mock("@/app/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/hooks/useMediaQuery")>()),
  useIsMobile: () => false,
}));

afterEach(cleanup);

/** A dialog holding an atom select, a primitive menu and a hinted control. */
function Workspace({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState("draft");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open {name}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${name} settings`}>
        <Select
          items={[
            { id: "draft", label: "Draft" },
            { id: "final", label: "Final" },
          ]}
          value={plan}
          onValueChange={setPlan}
        />
        <Popover>
          <PopoverTrigger>More</PopoverTrigger>
          <PopoverContent>
            <button type="button">Archive</button>
          </PopoverContent>
        </Popover>
        <Tooltip title="Saved automatically" sticky>
          <Button>Status</Button>
        </Tooltip>
      </Modal>
    </>
  );
}

function mount(...names: string[]) {
  return render(
    <MemoryRouter>
      {names.map((name) => (
        <section key={name} aria-label={name}>
          <PresentationBoundary>
            <Workspace name={name} />
          </PresentationBoundary>
        </section>
      ))}
    </MemoryRouter>,
  );
}

const instance = (name: string) => screen.getByRole("region", { name });
const content = (name: string) => instance(name).querySelector("[data-nac-content]");
const scrim = (name: string) => instance(name).querySelector('[data-slot="dialog-overlay"]')!;

function openDialog(name: string) {
  const opener = within(instance(name)).getByRole("button", { name: `Open ${name}` });
  act(() => opener.focus());
  fireEvent.click(opener);
  return {
    opener,
    dialog: within(instance(name)).getByRole("dialog", { name: `${name} settings` }),
  };
}

function click(target: Element) {
  fireEvent.mouseDown(target);
  fireEvent.click(target);
}

describe("nested overlays", () => {
  it("close top first on Escape, then hand focus back to the dialog's opener", async () => {
    mount("main");
    const { opener, dialog } = openDialog("main");
    expect(document.activeElement).toBe(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: "Draft" }));
    expect(screen.getByRole("button", { name: "Final" })).toBeTruthy();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Final" })).toBeNull();
    expect(screen.getByRole("dialog")).toBe(dialog);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("let a press in the dialog or on its scrim close only the menu above it", () => {
    mount("main");
    const { dialog } = openDialog("main");
    const more = within(dialog).getByRole("button", { name: "More" });

    fireEvent.click(more);
    click(within(dialog).getByText("main settings"));
    expect(screen.queryByText("Archive")).toBeNull();
    expect(screen.getByRole("dialog")).toBe(dialog);

    fireEvent.click(more);
    click(scrim("main"));
    expect(screen.queryByText("Archive")).toBeNull();
    expect(screen.getByRole("dialog")).toBe(dialog);

    click(scrim("main"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keep the view behind the scrim inert and still, but let the dialog scroll", () => {
    mount("main");
    const { dialog } = openDialog("main");
    expect(content("main")?.hasAttribute("inert")).toBe(true);

    for (const type of ["wheel", "touchmove"]) {
      const behind = new Event(type, { bubbles: true, cancelable: true });
      scrim("main").dispatchEvent(behind);
      expect(behind.defaultPrevented).toBe(true);
      const inside = new Event(type, { bubbles: true, cancelable: true });
      dialog.dispatchEvent(inside);
      expect(inside.defaultPrevented).toBe(false);
    }

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(content("main")?.hasAttribute("inert")).toBe(false);
  });

  it("show a hint on hover and keyboard focus, and let Escape take it before the dialog", () => {
    mount("main");
    const { dialog } = openDialog("main");
    const status = within(dialog).getByRole("button", { name: "Status" });

    fireEvent.mouseEnter(status);
    const hint = screen.getByRole("tooltip");
    expect(hint.textContent).toBe("Saved automatically");
    expect(hint.className).toContain("motion-reduce:!animate-none");
    fireEvent.mouseLeave(status);
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => status.focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(status, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(document.activeElement).toBe(status);
  });
});

describe("two embedded instances", () => {
  it("keep separate stacks: Escape, inertness and menus stay with their own view", () => {
    mount("left", "right");
    const left = openDialog("left").dialog;
    const right = openDialog("right").dialog;
    fireEvent.click(within(right).getByRole("button", { name: "More" }));
    expect(content("left")?.hasAttribute("inert")).toBe(true);
    expect(content("right")?.hasAttribute("inert")).toBe(true);

    fireEvent.keyDown(left, { key: "Escape" });
    expect(within(instance("left")).queryByRole("dialog")).toBeNull();
    expect(within(instance("right")).getByRole("dialog")).toBe(right);
    expect(within(instance("right")).getByText("Archive")).toBeTruthy();
    expect(content("left")?.hasAttribute("inert")).toBe(false);
    expect(content("right")?.hasAttribute("inert")).toBe(true);

    fireEvent.keyDown(within(instance("right")).getByText("Archive"), { key: "Escape" });
    expect(within(instance("right")).queryByText("Archive")).toBeNull();
    expect(within(instance("right")).getByRole("dialog")).toBe(right);
  });
});
