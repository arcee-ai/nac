import { describe, expect, it, vi } from "vitest";
import { connectDesktopCommands, type DesktopCommandPort } from "./adapter";

describe("desktop UI capability", () => {
  it("keeps ordinary browser presentation inert without a port", () => {
    expect(
      connectDesktopCommands(undefined, {
        newSession: vi.fn(),
        settings: vi.fn(),
        projects: vi.fn(),
      })(),
    ).toBeUndefined();
  });
  it("dispatches only named actions once, retires old callbacks and never replays", () => {
    let callback: ((message: unknown) => boolean) | undefined;
    const disconnect = vi.fn();
    const port: DesktopCommandPort = {
      connect: (owner) => {
        callback = owner;
        return disconnect;
      },
    };
    const owners = { newSession: vi.fn(), settings: vi.fn(), projects: vi.fn() };
    const close = connectDesktopCommands(port, owners);
    const request = { version: 1, request: 1, action: "newSession" };
    expect(callback?.(request)).toBe(true);
    expect(callback?.(request)).toBe(false);
    expect(callback?.(Object.assign(Object.create(request), { a: 1, b: 2, c: 3 }))).toBe(false);
    expect(owners.newSession).toHaveBeenCalledOnce();
    for (const bad of [
      null,
      {},
      "shell",
      { ...request, request: 2, action: "shell" },
      { ...request, request: 2, extra: true },
      { ...request, request: 2, version: 2 },
      { ...request, request: 1.5 },
      { ...request, request: Infinity },
    ])
      expect(callback?.(bad)).toBe(false);
    expect(callback?.({ ...request, request: 2, action: "settings" })).toBe(true);
    expect(owners.settings).toHaveBeenCalledOnce();
    expect(callback?.({ ...request, request: 3, action: "projects" })).toBe(true);
    expect(owners.projects).toHaveBeenCalledOnce();
    close();
    close();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(callback?.({ ...request, request: 4 })).toBe(false);
    expect(owners.newSession).toHaveBeenCalledOnce();
  });
  it("consumes failed dispatch without replaying the owner's action", () => {
    let callback: ((message: unknown) => boolean) | undefined;
    const fail = vi.fn(() => {
      throw new Error("closed owner");
    });
    const close = connectDesktopCommands(
      {
        connect: (owner) => {
          callback = owner;
          return () => {};
        },
      },
      { newSession: fail, settings: vi.fn(), projects: vi.fn() },
    );
    const message = { version: 1, request: 1, action: "newSession" };
    expect(callback?.(message)).toBe(false);
    expect(callback?.(message)).toBe(false);
    expect(fail).toHaveBeenCalledOnce();
    close();
  });
});

it("reports an unavailable shared owner as unhandled without replay", () => {
  let callback!: (message: unknown) => boolean;
  const unavailable = vi.fn(() => false);
  const close = connectDesktopCommands(
    {
      connect: (owner) => {
        callback = owner;
        return () => {};
      },
    },
    { newSession: unavailable, settings: vi.fn(), projects: vi.fn() },
  );
  const message = { version: 1, request: 1, action: "newSession" };
  expect(callback(message)).toBe(false);
  expect(callback(message)).toBe(false);
  expect(unavailable).toHaveBeenCalledOnce();
  close();
});
