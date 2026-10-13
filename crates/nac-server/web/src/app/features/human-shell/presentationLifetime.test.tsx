/** @vitest-environment jsdom */
import { StrictMode, type ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useShellPresentation } from "./presentationLifetime";
afterEach(cleanup);
it("closes local callback scopes synchronously across StrictMode, chat changes and unmount", () => {
  const binding = {};
  const hook = renderHook(({ sessionId }) => useShellPresentation(binding, sessionId), {
    initialProps: { sessionId: "same" },
    wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
  });
  const first = hook.result.current.current!;
  expect(first.current()).toBe(true);
  hook.rerender({ sessionId: "other" });
  expect(first.current()).toBe(false);
  const next = hook.result.current.current!;
  expect(next.current()).toBe(true);
  hook.unmount();
  expect(next.current()).toBe(false);
});
