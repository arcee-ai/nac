/** @vitest-environment jsdom */
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DesktopCommandOwner } from "./DesktopCommandOwner";
import type { DesktopCommandPort } from "./adapter";

const state = vi.hoisted(() => ({
  newSession: vi.fn(),
  openConfigurations: vi.fn(),
  openProjects: vi.fn(),
  focused: true,
  owns: true,
  modalDepth: 0,
}));
vi.mock("@/app/components/LeftSidebar/useSidebarCommands", () => ({
  useSidebarCommands: () => state,
}));
vi.mock("@/app/providers/PresentationBoundary", () => ({
  usePresentationKeyboardOwner: () => () => state.owns,
  usePresentationLayers: () => ({ modalDepth: () => state.modalDepth }),
}));
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  state.focused = true;
  state.owns = true;
  state.modalDepth = 0;
  vi.spyOn(document, "hasFocus").mockImplementation(() => state.focused);
});
it("uses the existing UI owners and rejects background, foreign and covered focus", () => {
  let callback!: (value: unknown) => boolean;
  const disconnect = vi.fn();
  const connect = vi.fn((owner) => {
    callback = owner;
    return disconnect;
  });
  const port: DesktopCommandPort = { connect };
  const view = render(<DesktopCommandOwner port={port} />);
  const request = (request: number, action: string) => ({ version: 1, request, action });
  expect(callback(request(1, "settings"))).toBe(true);
  expect(state.openConfigurations).toHaveBeenCalledOnce();
  state.focused = false;
  expect(callback(request(2, "newSession"))).toBe(false);
  state.focused = true;
  state.owns = false;
  expect(callback(request(3, "newSession"))).toBe(false);
  state.owns = true;
  state.modalDepth = 1;
  expect(callback(request(4, "newSession"))).toBe(false);
  state.modalDepth = 0;
  expect(state.newSession).not.toHaveBeenCalled();
  expect(callback(request(5, "newSession"))).toBe(true);
  expect(state.newSession).toHaveBeenCalledOnce();
  view.rerender(<DesktopCommandOwner port={port} />);
  expect(connect).toHaveBeenCalledOnce();
  expect(callback(request(6, "projects"))).toBe(true);
  expect(state.openProjects).toHaveBeenCalledOnce();
  view.unmount();
  expect(callback(request(7, "settings"))).toBe(false);
  expect(disconnect).toHaveBeenCalledOnce();
});
it("StrictMode retires its discarded subscription before connecting the current owner", () => {
  const callbacks: ((value: unknown) => boolean)[] = [];
  let active = false;
  const port: DesktopCommandPort = {
    connect: (owner) => {
      expect(active).toBe(false);
      active = true;
      callbacks.push(owner);
      return () => {
        active = false;
      };
    },
  };
  const view = render(
    <StrictMode>
      <DesktopCommandOwner port={port} />
    </StrictMode>,
  );
  const message = { version: 1, request: 1, action: "settings" };
  expect(callbacks.length).toBe(2);
  expect(callbacks[0](message)).toBe(false);
  expect(callbacks[1](message)).toBe(true);
  expect(state.openConfigurations).toHaveBeenCalledOnce();
  view.unmount();
  expect(active).toBe(false);
});
