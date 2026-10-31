/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createNacClient } from "@/app/services/nacClient";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { useSessionIntegrations } from "./queries";

const instances: NativeRuntime[] = [];
afterEach(() => {
  cleanup();
  for (const instance of instances.splice(0)) instance.close();
});

function runtime(name: string, fetch: typeof globalThis.fetch) {
  const instance = createNativeRuntime({
    scope: {
      owner: name,
      profile: name,
      organization: name,
      host: name,
      incarnation: name,
      endpoint: `/${name}`,
      release: name,
    },
    client: createNacClient({ endpoint: `/${name}`, fetch }),
  });
  instances.push(instance);
  return instance;
}

it("settles a pending refresh in its captured session and runtime cache after navigation", async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const firstFetch = vi.fn<typeof globalThis.fetch>(() => pending);
  const nextFetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
  const first = runtime("first", firstFetch);
  const next = runtime("next", nextFetch);
  let active = first;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RuntimeContext.Provider value={active}>
        <QueryClientProvider client={active.queryClient}>{children}</QueryClientProvider>
      </RuntimeContext.Provider>
    );
  }
  const hook = renderHook(({ session }) => useSessionIntegrations(session, false), {
    initialProps: { session: "original" },
    wrapper: Wrapper,
  });
  act(() => hook.result.current.requestRefresh(0));
  await waitFor(() => expect(firstFetch).toHaveBeenCalledTimes(1));
  expect(String(firstFetch.mock.calls[0][0])).toBe("/first/sessions/original/integrations/refresh");
  active = next;
  hook.rerender({ session: "other" });
  await act(async () =>
    release(
      Response.json({
        revision: 1,
        requested_at: "fixture",
        applied_revision: 0,
        incarnation_id: "fixture-incarnation",
        state: "pending",
        message: null,
      }),
    ),
  );
  await waitFor(() =>
    expect(first.queryClient.getQueryData(["session-integrations", "original"])).toMatchObject({
      revision: 1,
    }),
  );
  expect(nextFetch).not.toHaveBeenCalled();
  expect(next.queryClient.getQueryData(["session-integrations", "original"])).toBeUndefined();
  expect(next.queryClient.getQueryData(["session-integrations", "other"])).toBeUndefined();
});
