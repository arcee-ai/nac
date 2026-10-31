/** @vitest-environment jsdom */

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import Button from "../button";
import Modal from ".";

vi.mock("@/app/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/hooks/useMediaQuery")>()),
  useIsMobile: () => true,
}));

afterEach(cleanup);

/** The phone search panel, with a rename dialog it opens above itself. */
function Panels({ onNavigate }: { onNavigate?: () => void }) {
  const [search, setSearch] = useState(false);
  const [rename, setRename] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <Button onClick={() => setSearch(true)}>Search</Button>
      <Modal
        open={search}
        onClose={() => setSearch(false)}
        onNavigate={onNavigate}
        title="Search chats"
      >
        <Button onClick={() => setRename(true)}>Rename</Button>
        <Button onClick={() => navigate("/session/other")}>Open other chat</Button>
      </Modal>
      <Modal open={rename} onClose={() => setRename(false)} title="Rename session">
        Rename body
      </Modal>
    </>
  );
}

function mount(onNavigate?: () => void) {
  return render(
    <MemoryRouter initialEntries={["/session/current"]}>
      <PresentationBoundary>
        <Panels onNavigate={onNavigate} />
      </PresentationBoundary>
    </MemoryRouter>,
  );
}

function openFrom(name: string) {
  const opener = screen.getByRole("button", { name });
  act(() => opener.focus());
  fireEvent.click(opener);
  return opener;
}

const panel = (name: string) => screen.getByRole("dialog", { name });

describe("phone modal panel", () => {
  it("ignore its scrim, then slide out before unmounting and hand focus back", async () => {
    mount();
    const opener = openFrom("Search");
    const search = panel("Search chats");
    await waitFor(() => expect(search.className).toContain("translate-x-0"));

    const scrim = document.querySelector('[data-slot="dialog-overlay"]')!;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(search.className).toContain("translate-x-0");

    fireEvent.click(within(search).getByRole("button", { name: "Close" }));
    expect(panel("Search chats")).toBe(search);
    expect(search.className).toContain("translate-x-full");
    await waitFor(() => expect(document.activeElement).toBe(opener));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("slide a covered panel aside for a dialog above it, and close that one first", async () => {
    mount();
    openFrom("Search");
    const search = panel("Search chats");
    const renameOpener = openFrom("Rename");
    const rename = panel("Rename session");
    expect(search.hasAttribute("data-covered")).toBe(true);
    expect(rename.hasAttribute("data-covered")).toBe(false);

    fireEvent.keyDown(rename, { key: "Escape" });
    expect(search.hasAttribute("data-covered")).toBe(false);
    expect(panel("Search chats")).toBe(search);
    await waitFor(() => expect(document.activeElement).toBe(renameOpener));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Rename session" })).toBeNull(),
    );
  });

  it("close on a route change, or leave that to the owner's onNavigate", async () => {
    const onNavigate = vi.fn();
    mount(onNavigate);
    openFrom("Search");
    const search = panel("Search chats");
    await waitFor(() => expect(search.className).toContain("translate-x-0"));
    fireEvent.click(within(search).getByRole("button", { name: "Open other chat" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(search.className).toContain("translate-x-0");
    cleanup();

    mount();
    openFrom("Search");
    fireEvent.click(within(panel("Search chats")).getByRole("button", { name: "Open other chat" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
