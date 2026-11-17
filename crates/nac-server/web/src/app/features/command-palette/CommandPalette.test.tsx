/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import { MOD } from "@/app/lib/shortcuts";
import { CommandSurfaces } from "./CommandSurfaces";
import { closeCommandSurfaces, openCommandPalette } from "./paletteSignal";
import type { PaletteItem } from "./usePaletteCommands";
import { filterPalette } from "./paletteFilter";

const state = vi.hoisted(() => ({ mobile: false, items: [] as PaletteItem[] }));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => state.mobile }));
vi.mock("./usePaletteCommands", async (original) => ({
  ...(await original<object>()),
  usePaletteCommands: () => state.items,
}));

const run = vi.fn<(id: string) => void>();
function item(partial: Partial<PaletteItem> & Pick<PaletteItem, "id" | "group" | "label">) {
  return { run: () => run(partial.id), ...partial } satisfies PaletteItem;
}

beforeEach(() => {
  state.mobile = false;
  run.mockReset();
  state.items = [
    item({ id: "s1", group: "Sessions", label: "Fix login bug", detail: "web", recency: 3 }),
    item({ id: "s2", group: "Sessions", label: "Refactor store", recency: 2 }),
    item({ id: "c1", group: "Sessions", label: "Child task", child: true, recency: 1 }),
    item({ id: "a1", group: "Actions", label: "New session" }),
    item({ id: "t1", group: "Theme", label: "Dark theme", keywords: "night" }),
    item({ id: "set", group: "Settings", label: "MCP servers", keywords: "tools" }),
  ];
});
afterEach(() => {
  act(() => closeCommandSurfaces());
  cleanup();
});

function mount() {
  return render(
    <MemoryRouter>
      <PresentationBoundary globalKeyboard>
        <CommandSurfaces />
      </PresentationBoundary>
    </MemoryRouter>,
  );
}

const field = () => screen.getByRole("combobox", { name: "Search commands" });
const options = () =>
  within(screen.getByRole("listbox", { name: "Commands" }))
    .getAllByRole("option")
    .map((option) => option.textContent);

it("opens on ⌘K/Ctrl+K as a named dialog with a combobox over a listbox", async () => {
  mount();
  expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  fireEvent.keyDown(window, { key: "k", [MOD === "meta" ? "metaKey" : "ctrlKey"]: true });
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  expect(within(dialog).getByRole("combobox").getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(document.activeElement).toBe(field()));
  // Subagents wait for a query; the idle list shows top-level sessions first.
  expect(options()).toEqual([
    "Fix login bugweb",
    "Refactor store",
    "New session",
    "MCP servers",
    "Dark theme",
  ]);
});

it("filters as you type, moves with the arrows and runs the highlighted row on Enter", async () => {
  mount();
  act(() => openCommandPalette());
  await screen.findByRole("dialog", { name: "Command palette" });
  fireEvent.change(field(), { target: { value: "task" } });
  expect(options()).toEqual(["Child task"]);
  fireEvent.change(field(), { target: { value: "" } });
  const first = screen.getAllByRole("option")[0];
  expect(field().getAttribute("aria-activedescendant")).toBe(first.id);
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(field().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[2].id);
  fireEvent.keyDown(field(), { key: "ArrowUp" });
  fireEvent.keyDown(field(), { key: "Enter" });
  await waitFor(() => expect(run).toHaveBeenCalledWith("s2"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
});

it("matches keywords and says when nothing matches", async () => {
  mount();
  act(() => openCommandPalette());
  await screen.findByRole("dialog", { name: "Command palette" });
  fireEvent.change(field(), { target: { value: "night" } });
  expect(options()).toEqual(["Dark theme"]);
  fireEvent.change(field(), { target: { value: "qqqq" } });
  expect(screen.getByRole("status").textContent).toContain("No results");
});

it("closes on Escape and gives a phone a Cancel button", async () => {
  state.mobile = true;
  mount();
  act(() => openCommandPalette());
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
  state.mobile = false;
  act(() => openCommandPalette());
  await screen.findByRole("dialog", { name: "Command palette" });
  fireEvent.keyDown(field(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
});

it("orders groups by their best match when querying", () => {
  const sections = filterPalette(state.items, "dark");
  expect(sections.map((section) => section.group)).toEqual(["Theme"]);
  const idle = filterPalette(state.items, "");
  expect(idle.map((section) => section.group)).toEqual([
    "Sessions",
    "Actions",
    "Settings",
    "Theme",
  ]);
});
