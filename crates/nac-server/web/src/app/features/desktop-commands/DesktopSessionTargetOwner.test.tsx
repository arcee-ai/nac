/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import { DesktopSessionTargetOwner } from "./DesktopSessionTargetOwner";
import { DesktopVisibility } from "./DesktopVisibility";
import type { SessionTargetOutcome } from "./sessionTarget";

const runtime = vi.hoisted(() => ({
  productNavigation: {
    openNotificationSessionTarget: vi.fn(async (_target, _signal, canNavigate) =>
      canNavigate() ? "opened" : "deferred",
    ),
  },
}));
vi.mock("@/app/runtime/RuntimeContext", () => ({ useNativeRuntime: () => runtime }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("defers IME and unretained editors and retires routing readiness while hidden", async () => {
  let receive!: (message: unknown) => Promise<SessionTargetOutcome>,
    visibility!: (visible: boolean) => void;
  const disconnected = vi.fn();
  const port = {
    connectSessionTarget: (owner: typeof receive) => {
      receive = owner;
      return disconnected;
    },
    connectVisibility: (owner: typeof visibility) => {
      visibility = owner;
      return () => {};
    },
  };
  render(
    <PresentationBoundary globalKeyboard>
      <DesktopVisibility port={port}>
        <textarea aria-label="retained" data-nac-retained-draft="" />
        <input aria-label="local" />
        <DesktopSessionTargetOwner port={port} />
      </DesktopVisibility>
    </PresentationBoundary>,
  );
  let sequence = 0;
  const send = () =>
    receive({
      version: 1,
      source: "notification-response",
      request: ++sequence,
      profile: "profile",
      launch: "launch",
      view: "view",
      document: "document",
      target: { session_id: "target", occurrence_id: "work" },
    });
  screen.getByLabelText("retained").focus();
  expect(await send()).toBe("opened");
  fireEvent.compositionStart(screen.getByLabelText("retained"));
  expect(await send()).toBe("deferred");
  await act(async () => visibility(false));
  expect(disconnected).toHaveBeenCalledOnce();
  await act(async () => visibility(true));
  expect(await send()).toBe("deferred");
  fireEvent.compositionEnd(screen.getByLabelText("retained"));
  expect(await send()).toBe("opened");
  screen.getByLabelText("local").focus();
  expect(await send()).toBe("deferred");
});
