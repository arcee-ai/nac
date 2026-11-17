/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import Modal from "@/app/atoms/modal";

import { PresentationBoundary } from "@/app/providers/PresentationBoundary";

import { SettingsReturnProvider } from "./SettingsReturnProvider";
import { useSettingsReturn } from "./settingsReturn";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The app shell's <main> encloses every page, as AppShell does. */
function Shell() {
  return (
    <main aria-label="Shell">
      <Outlet />
    </main>
  );
}

function Session() {
  const navigate = useNavigate();
  return (
    <>
      <textarea role="combobox" aria-label="Message" />
      <button onClick={() => navigate("/settings/models")}>Open settings</button>
    </>
  );
}

function Projects() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => navigate("/settings/models")}>Open settings</button>
      <button onClick={() => navigate("/other")}>Other destination</button>
      <button aria-label="Branch: main">main</button>
      <button onClick={() => setOpen(true)}>Add repository</button>
      <Modal open={open} title="Add repository" onClose={() => setOpen(false)}>
        <button>New repository control</button>
      </Modal>
    </>
  );
}

function Settings() {
  const leave = useSettingsReturn();
  return <button onClick={leave}>Back</button>;
}

function mount(path: string) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsReturnProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/session/:id" element={<Session />} />
            <Route path="/" element={<Projects />} />
            <Route path="/other" element={<Other />} />
            <Route path="/settings/:section" element={<Settings />} />
          </Route>
        </Routes>
      </SettingsReturnProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  return view;
}

function Other() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/")}>Return home</button>;
}

function heldFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  return (count: number) => {
    for (let frame = 0; frame < count; frame++) {
      const callback = frames.shift();
      expect(callback, `expected queued frame ${frame + 1}`).toBeTruthy();
      act(() => callback!(performance.now()));
    }
  };
}

it("hands the session composer its focus back, not the enclosing main", async () => {
  mount("/session/one");
  const composer = await screen.findByRole("combobox", { name: "Message" });
  await waitFor(() => expect(document.activeElement).toBe(composer));
});

it("focuses the main region when the destination has no composer", async () => {
  mount("/");
  const main = screen.getByRole("main", { name: "Shell" });
  await waitFor(() => expect(document.activeElement).toBe(main));
  expect(main.getAttribute("tabindex")).toBe("-1");
});

it("returns focus inside the presentation that left Settings, without reaching a sibling composer", async () => {
  function View({ label }: { label: string }) {
    return (
      <section aria-label={label}>
        <MemoryRouter initialEntries={["/session/one"]}>
          <PresentationBoundary>
            <SettingsReturnProvider>
              <Routes>
                <Route element={<Shell />}>
                  <Route path="/session/:id" element={<Session />} />
                  <Route path="/settings/:section" element={<Settings />} />
                </Route>
              </Routes>
            </SettingsReturnProvider>
          </PresentationBoundary>
        </MemoryRouter>
      </section>
    );
  }
  render(
    <>
      <View label="Left view" />
      <View label="Right view" />
    </>,
  );
  const right = within(screen.getByRole("region", { name: "Right view" }));
  fireEvent.click(right.getByRole("button", { name: "Open settings" }));
  fireEvent.click(right.getByRole("button", { name: "Back" }));
  const composer = await right.findByRole("combobox", { name: "Message" });
  await waitFor(() => expect(document.activeElement).toBe(composer));
});

it("a delayed Home fallback cannot take focus from a newer repository branch control", () => {
  const flush = heldFrames();
  mount("/");
  flush(19);
  const branch = screen.getByRole("button", { name: "Branch: main" });
  branch.focus();
  expect(document.activeElement).toBe(branch);
  flush(1);
  expect(document.activeElement).toBe(branch);
});

it("a return superseded by another route stays canceled when that route comes back", () => {
  const flush = heldFrames();
  mount("/");
  flush(19);
  fireEvent.click(screen.getByRole("button", { name: "Other destination" }));
  fireEvent.click(screen.getByRole("button", { name: "Return home" }));
  flush(1);
  expect(document.activeElement).not.toBe(screen.getByRole("main", { name: "Shell" }));
});

it("an older return cannot consume a newer Settings return to the same destination", () => {
  const flush = heldFrames();
  mount("/");
  flush(19);
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  flush(1);
  const main = screen.getByRole("main", { name: "Shell" });
  expect(document.activeElement).not.toBe(main);
  flush(20);
  expect(document.activeElement).toBe(main);
});

it("a retired Settings provider cannot focus a replacement presentation", () => {
  const flush = heldFrames();
  const original = mount("/");
  flush(19);
  original.unmount();
  render(<main aria-label="Replacement" />);
  const replacement = screen.getByRole("main", { name: "Replacement" });
  flush(1);
  expect(document.activeElement).not.toBe(replacement);
});

it("a newer repository overlay cancels the delayed handoff even before it focuses a control", () => {
  const flush = heldFrames();
  mount("/");
  flush(19);
  fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
  expect(screen.getByRole("dialog", { name: "Add repository" })).toBeTruthy();
  // An open overlay still owns focus return while no child control is focused.
  (document.activeElement as HTMLElement).blur();
  expect(document.activeElement).toBe(document.body);
  flush(1);
  expect(document.activeElement).not.toBe(screen.getByRole("main", { name: "Shell" }));
});
