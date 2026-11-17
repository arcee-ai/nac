/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresentationBoundary } from "@/app/providers/PresentationBoundary";

import { SessionRow, type SessionRowProps } from "./SessionRow";

const TITLE = "Rotate the staging database credentials";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <PresentationBoundary>{children}</PresentationBoundary>
    </MemoryRouter>
  );
}

function mount(props: Partial<SessionRowProps> = {}) {
  const callbacks = {
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onPin: vi.fn(),
    onDelete: vi.fn(),
    onAssign: vi.fn(),
  };
  const view = render(
    <SessionRow
      title={TITLE}
      label={TITLE}
      status="idle"
      updatedAt={new Date().toISOString()}
      now={Date.now()}
      active={false}
      {...callbacks}
      {...props}
    />,
    { wrapper: Wrapper },
  );
  return { ...callbacks, view };
}

const trigger = () => screen.getByRole("button", { name: `${TITLE} options` });
const menu = () => screen.getByRole("menu", { name: `${TITLE} options` });

beforeEach(() => {
  // Desktop width: the menu is an anchored panel, not a phone bottom sheet.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("session row menu", () => {
  it("replaces the row's buttons with one menu trigger", () => {
    mount();
    // The row keeps exactly two controls: open the session, and its options.
    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toEqual([TITLE, `${TITLE} options`]);
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens with every action, named for the session, Delete last", () => {
    mount();
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const items = within(menu()).getAllByRole("menuitem");
    expect(items.map((item) => item.getAttribute("aria-label") ?? item.textContent)).toEqual([
      `Rename ${TITLE}`,
      `Pin ${TITLE}`,
      "Move to project",
      "View full name",
      `Delete ${TITLE}`,
    ]);
    // Visible labels stay short; the accessible names start with them.
    expect(items.map((item) => item.textContent)).toEqual([
      "Rename",
      "Pin",
      "Move to project",
      "View full name",
      "Delete",
    ]);
    expect(within(menu()).getByRole("separator")).toBeTruthy();
  });

  it("offers Unpin for a pinned session and leaves out actions it was not given", () => {
    mount({ pinned: true, onAssign: undefined });
    fireEvent.click(trigger());
    expect(within(menu()).getByRole("menuitem", { name: `Unpin ${TITLE}` })).toBeTruthy();
    expect(within(menu()).queryByRole("menuitem", { name: `Pin ${TITLE}` })).toBeNull();
    expect(within(menu()).queryByRole("menuitem", { name: "Move to project" })).toBeNull();
  });

  it("runs each action once, closing the menu, without opening the session", () => {
    const fakes = mount();
    for (const [name, callback] of [
      [`Rename ${TITLE}`, fakes.onRename],
      [`Pin ${TITLE}`, fakes.onPin],
      ["Move to project", fakes.onAssign],
    ] as const) {
      fireEvent.click(trigger());
      fireEvent.click(within(menu()).getByRole("menuitem", { name }));
      expect(callback).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menu")).toBeNull();
    }
    expect(fakes.onOpen).not.toHaveBeenCalled();
  });

  it("sends Delete through the confirmation callback and nothing else", () => {
    const fakes = mount();
    fireEvent.click(trigger());
    const remove = within(menu()).getByRole("menuitem", { name: `Delete ${TITLE}` });
    expect(remove.className).toContain("text-error-primary");
    fireEvent.click(remove);
    expect(fakes.onDelete).toHaveBeenCalledOnce();
    for (const other of [fakes.onRename, fakes.onPin, fakes.onAssign, fakes.onOpen])
      expect(other).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the full name one menu item away, returning focus to the trigger", async () => {
    mount();
    act(() => trigger().focus());
    fireEvent.click(trigger());
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "View full name" }));
    const dialog = screen.getByRole("dialog", { name: "Full session name" });
    expect(dialog.querySelector("[data-full-session-name]")?.textContent).toBe(TITLE);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("is reachable and operable from the keyboard", async () => {
    const fakes = mount();
    act(() => trigger().focus());
    // Arrow keys open it from the trigger; focus lands on the first item.
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const items = () => within(menu()).getAllByRole("menuitem");
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(items()[1], { key: "End" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(`Delete ${TITLE}`);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0], { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(`Delete ${TITLE}`);
    // Escape closes it and hands focus back to the trigger.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
    // Tab leaves the menu the same way instead of escaping into the page.
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0], { key: "Tab" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
    expect(fakes.onDelete).not.toHaveBeenCalled();
  });

  it("swaps the age for the trigger on hover-capable pointers and shows both on touch", () => {
    const { view } = mount();
    // Transparent until the row is hovered or holds keyboard focus; still in the tab order.
    expect(trigger().className).toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(trigger().className).toContain("group-hover/row:opacity-100");
    expect(trigger().className).toContain("group-has-[:focus-visible]/row:opacity-100");
    expect(trigger().className).toContain("[@media(hover:none)]:opacity-100");
    expect(trigger().className).toContain("[@media(hover:none)]:size-11");
    expect(trigger().tabIndex).toBe(0);
    expect(trigger().hasAttribute("disabled")).toBe(false);
    view.unmount();

    mount({ touch: true });
    // Phone menu rows: one always-visible 44px target beside the age.
    expect(trigger().className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(trigger().className).toContain("size-11");
    const row = trigger().closest<HTMLElement>("[data-session-row]")!;
    expect(row.className).toContain("min-h-11");
    expect(within(row).getByText("now")).toBeTruthy();
  });
});
