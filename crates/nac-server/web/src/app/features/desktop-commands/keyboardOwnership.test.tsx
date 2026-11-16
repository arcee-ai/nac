/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import { DesktopCommandOwner } from "./DesktopCommandOwner";
import type { DesktopCommandPort } from "./adapter";

const owners = vi.hoisted(() => ({
  newSession: vi.fn(),
  openConfigurations: vi.fn(),
  openProjects: vi.fn(),
}));
vi.mock("@/app/components/LeftSidebar/useSidebarCommands", () => ({
  useSidebarCommands: () => owners,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function port() {
  let callback!: (message: unknown) => boolean;
  const capability: DesktopCommandPort = {
    connect: (owner) => {
      callback = owner;
      return () => {};
    },
  };
  return {
    capability,
    send: (request: number) => callback({ version: 1, request, action: "settings" }),
  };
}

it("routes commands only to the embedded presentation with real DOM focus", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const first = port();
  const second = port();
  render(
    <>
      <PresentationBoundary>
        <button>First view</button>
        <DesktopCommandOwner port={first.capability} />
      </PresentationBoundary>
      <PresentationBoundary>
        <button>Second view</button>
        <DesktopCommandOwner port={second.capability} />
      </PresentationBoundary>
      <button>Caller view</button>
    </>,
  );
  screen.getByRole("button", { name: "First view" }).focus();
  expect(first.send(1)).toBe(true);
  expect(second.send(1)).toBe(false);
  expect(owners.openConfigurations).toHaveBeenCalledOnce();
  screen.getByRole("button", { name: "Second view" }).focus();
  expect(first.send(2)).toBe(false);
  expect(second.send(2)).toBe(true);
  expect(owners.openConfigurations).toHaveBeenCalledTimes(2);
  screen.getByRole("button", { name: "Caller view" }).focus();
  expect(first.send(3)).toBe(false);
  expect(second.send(3)).toBe(false);
  expect(owners.openConfigurations).toHaveBeenCalledTimes(2);
});

it("preserves an explicitly selected document keyboard owner", () => {
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const global = port();
  render(
    <>
      <PresentationBoundary globalKeyboard>
        <DesktopCommandOwner port={global.capability} />
      </PresentationBoundary>
      <button>Caller view</button>
    </>,
  );
  screen.getByRole("button", { name: "Caller view" }).focus();
  expect(global.send(1)).toBe(true);
  focused.mockReturnValue(false);
  expect(global.send(2)).toBe(false);
  expect(owners.openConfigurations).toHaveBeenCalledOnce();
});
