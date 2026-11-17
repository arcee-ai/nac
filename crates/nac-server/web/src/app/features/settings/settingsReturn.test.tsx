/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PresentationBoundary } from "@/app/providers/PresentationBoundary";

import { SettingsReturnProvider } from "./SettingsReturnProvider";
import { useSettingsReturn } from "./settingsReturn";

beforeEach(() => {
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
  return <button onClick={() => navigate("/settings/models")}>Open settings</button>;
}

function Settings() {
  const leave = useSettingsReturn();
  return <button onClick={leave}>Back</button>;
}

function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsReturnProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/session/:id" element={<Session />} />
            <Route path="/" element={<Projects />} />
            <Route path="/settings/:section" element={<Settings />} />
          </Route>
        </Routes>
      </SettingsReturnProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
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
