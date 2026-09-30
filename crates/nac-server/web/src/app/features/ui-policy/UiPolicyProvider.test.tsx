/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createNacClient } from "@/app/services/nacClient";
import { UiPolicyProvider } from "./UiPolicyProvider";
import { useUiPolicy } from "./UiPolicyContext";

function Surface() {
  const policy = useUiPolicy();
  return <button>{policy.orchestrationEnabled ? "Create orchestrator" : "Create direct"}</button>;
}
afterEach(cleanup);
function client(endpoint: string, fetch: typeof globalThis.fetch) {
  return createNacClient({ endpoint, credentials: "omit", fetch });
}
function response(enabled: boolean) {
  return new Response(JSON.stringify({ orchestration_enabled: enabled, diagnostic: null }), {
    headers: { "content-type": "application/json" },
  });
}

it("keeps creation absent while pending or failed and offers explicit recovery", async () => {
  let settle!: (value: Response) => void;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    )
    .mockResolvedValueOnce(response(false));
  const target = client("https://one.example", fetch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UiPolicyProvider client={target}>
        <Surface />
      </UiPolicyProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Create orchestrator")).toBeNull();
  expect(screen.queryByText("Create direct")).toBeNull();
  await waitFor(() => expect(settle).toBeDefined());
  settle(new Response("unavailable", { status: 503 }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Create direct")).toBeNull();
  fireEvent.click(screen.getByText("Try again"));
  await screen.findByText("Create direct");
  expect(fetch.mock.calls[0][0]).toBe("https://one.example/ui-config");
});
it("fences stale capability responses when the endpoint/client changes", async () => {
  let first!: (value: Response) => void;
  let second!: (value: Response) => void;
  const a = client(
    "https://one.example",
    vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    ),
  );
  const b = client(
    "https://two.example",
    vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          second = resolve;
        }),
    ),
  );
  const cache = new QueryClient();
  const tree = (target: typeof a) => (
    <QueryClientProvider client={cache}>
      <UiPolicyProvider client={target}>
        <Surface />
      </UiPolicyProvider>
    </QueryClientProvider>
  );
  const mounted = render(tree(a));
  await waitFor(() => expect(first).toBeDefined());
  mounted.rerender(tree(b));
  await waitFor(() => expect(second).toBeDefined());
  first(response(true));
  expect(screen.queryByText("Create orchestrator")).toBeNull();
  second(response(false));
  await screen.findByText("Create direct");
  expect(screen.queryByText("Create orchestrator")).toBeNull();
});
it("shows enabled choices only after current configuration succeeds", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UiPolicyProvider
        client={client(
          "https://enabled.example",
          vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(true)),
        )}
      >
        <Surface />
      </UiPolicyProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Create orchestrator");
});

it("reacquires policy for changed credentials at the same endpoint", async () => {
  let settle!: (value: Response) => void;
  const oldClient = createNacClient({
    endpoint: "https://same.example",
    credentials: "omit",
    authorization: { kind: "bearer", token: "old-test-token" },
    fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(true)),
  });
  const nextFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const nextClient = createNacClient({
    endpoint: "https://same.example",
    credentials: "omit",
    authorization: { kind: "bearer", token: "next-test-token" },
    fetch: nextFetch,
  });
  const cache = new QueryClient();
  const tree = (target: typeof oldClient) => (
    <QueryClientProvider client={cache}>
      <UiPolicyProvider client={target}>
        <Surface />
      </UiPolicyProvider>
    </QueryClientProvider>
  );
  const mounted = render(tree(oldClient));
  await screen.findByText("Create orchestrator");
  mounted.rerender(tree(nextClient));
  expect(screen.queryByText("Create orchestrator")).toBeNull();
  await waitFor(() => expect(settle).toBeDefined());
  expect(new Headers(nextFetch.mock.calls[0][1]?.headers).get("authorization")).toBe(
    "Bearer next-test-token",
  );
  settle(response(false));
  await screen.findByText("Create direct");
});

it("fails closed for a malformed bootstrap", async () => {
  const target = client(
    "https://invalid.example",
    vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ orchestration_enabled: "1", diagnostic: null }), {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UiPolicyProvider client={target}>
        <Surface />
      </UiPolicyProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Create orchestrator")).toBeNull();
  expect(screen.queryByText("Create direct")).toBeNull();
});
