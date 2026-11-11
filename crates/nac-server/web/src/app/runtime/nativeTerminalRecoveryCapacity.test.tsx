/** @vitest-environment jsdom */
import { createElement, useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "./RuntimeContext";
import { createNativeRuntime, type NativeRuntime } from "./nativeRuntime";
import { createNacClient } from "../services/nacClient";
import { useTerminalController } from "../features/terminal/useTerminalController";
import type { ExecutionStatus } from "../../../packages/nac-client/src/index";

// Deliberately leave renderer acquisition pending: real controller effects must
// reserve (or decline) recovery capacity synchronously BEFORE renderer/HTTP work.
vi.mock("../features/terminal/xtermAdapter", () => ({
  createTerminalRenderer: () => new Promise(() => {}),
}));
const opened: NativeRuntime[] = [];
function runtime() {
  const instance = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "host",
      incarnation: "engine",
      endpoint: "/engine",
      release: "fixture",
    },
    client: createNacClient({ endpoint: "/engine", fetch: vi.fn() }),
    requireTerminalAcknowledgement: true,
  });
  opened.push(instance);
  return instance;
}
const live: ExecutionStatus = {
  id: "opaque",
  origin: "human",
  representation: "pty",
  backend: "local",
  cwd: "/fixture",
  alive: true,
  process_state: "running",
  input: true,
  resize: true,
  stop: true,
  retained: true,
  output_complete: false,
  cols: 80,
  rows: 24,
};
function observe(
  instance: NativeRuntime,
  id: string,
  readonly: boolean,
  source: ExecutionStatus | null = live,
) {
  function Observation() {
    const host = useRef<HTMLDivElement>(null);
    useTerminalController("session", id, host, source ? { ...source, id } : undefined, {
      readonly,
    });
    return createElement("div", { ref: host });
  }
  return render(
    createElement(RuntimeContext.Provider, { value: instance }, createElement(Observation)),
  );
}
afterEach(() => {
  cleanup();
  for (const instance of opened.splice(0)) instance.close();
});

it("more than 128 historical read-only observations cannot exhaust recovered live input capacity", () => {
  const instance = runtime();
  for (let id = 0; id < 129; id++) observe(instance, `history-${id}`, true).unmount();
  const lease = instance.terminalInputRecovery.acquire("session", "genuinely-live");
  expect(lease.available).toBe(true);
  expect(lease.current).toBe(true);
});

it("a read-only observation never acknowledges or seeds a false entry for the same later writable identity", () => {
  const instance = runtime();
  const read = observe(instance, "same-opaque-execution", true);
  read.unmount();
  const writable = instance.terminalInputRecovery.acquire("session", "same-opaque-execution");
  expect(writable.available).toBe(true);
  expect(writable.current).toBe(true);
  writable.acknowledge();
  writable.release();
  observe(instance, "same-opaque-execution", true).unmount();
  expect(instance.terminalInputRecovery.acquire("session", "same-opaque-execution").current).toBe(
    false,
  );
});

it("provably non-input-capable sources do not reserve recovered live capacity", () => {
  const instance = runtime();
  const source = { ...live, origin: "agent" as const, retained: false, input: false };
  for (let id = 0; id < 129; id++)
    observe(instance, `readonly-agent-${id}`, false, source).unmount();
  expect(instance.terminalInputRecovery.acquire("session", "live").available).toBe(true);
});

it("unknown sources remain conservative and 128 unresolved live observations fail closed", () => {
  const instance = runtime();
  for (let id = 0; id < 128; id++) observe(instance, `unknown-${id}`, false, null).unmount();
  expect(instance.terminalInputRecovery.acquire("session", "overflow").available).toBe(false);
  expect(instance.terminalInputRecovery.acquire("session", "unknown-0").current).toBe(true);
  expect(instance.terminalInputRecovery.acquire("session", "unknown-127").current).toBe(true);
});
