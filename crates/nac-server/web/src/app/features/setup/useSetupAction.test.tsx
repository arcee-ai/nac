/** @vitest-environment jsdom */
import { StrictMode, type PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createConfiguredChat } from "./workflow";
import { classifySetupFailure } from "./browserAdapters";
import { useSetupAction } from "./useSetupAction";
import { openSetupLifetime } from "./lifetime";

it("closes a scoped read synchronously and allows idempotent disposal", () => {
  const lifetime = openSetupLifetime();
  expect(lifetime.current()).toBe(true);
  lifetime.close();
  lifetime.close();
  expect(lifetime.current()).toBe(false);
  expect(lifetime.signal.aborted).toBe(true);
});

it("StrictMode owns one live activation; close aborts reads without cancelling a write", async () => {
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
  const hook = renderHook(({ open }) => useSetupAction(open), {
    wrapper,
    initialProps: { open: true },
  });
  const response = Promise.withResolvers<string>();
  const reconcile = vi.fn(async () => {});
  let readSignal: AbortSignal | undefined;
  let result: Promise<string | undefined> | undefined;
  act(() => {
    result = hook.result.current.run((lease) => {
      readSignal = lease.signal;
      return createConfiguredChat({
        current: lease.current,
        classify: classifySetupFailure,
        reconcile,
        model: async () => "model",
        chat: () => response.promise,
      });
    });
  });
  await act(async () => {
    await Promise.resolve();
  });
  hook.rerender({ open: false });
  expect(readSignal?.aborted).toBe(true);
  await act(async () => {
    response.resolve("accepted");
    expect(await result).toBeUndefined();
  });
  expect(reconcile).toHaveBeenCalledWith("chat");
  hook.unmount();
});

it("fences double clicks and prevents a same-view retry after an unknown write", async () => {
  const hook = renderHook(() => useSetupAction());
  const chat = vi.fn(async () => {
    throw new TypeError("lost response");
  });
  const build = (lease: ReturnType<typeof openSetupLifetime>) =>
    createConfiguredChat({
      current: lease.current,
      classify: classifySetupFailure,
      reconcile: async () => {},
      model: async () => "model",
      chat,
    });
  await act(async () => {
    const first = hook.result.current.run(build);
    expect(await hook.result.current.run(build)).toBeUndefined();
    await expect(first).rejects.toMatchObject({ kind: "unknown" });
    expect(await hook.result.current.run(build)).toBeUndefined();
  });
  expect(chat).toHaveBeenCalledTimes(1);
  expect(hook.result.current.needsReview).toBe(true);
  hook.unmount();
});
