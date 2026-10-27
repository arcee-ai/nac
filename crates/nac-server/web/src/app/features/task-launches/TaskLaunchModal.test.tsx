/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import type { TaskLaunchRequest } from "@/app/types/api";
import { TaskLaunchModal } from "./TaskLaunchModal";

const opened: NativeRuntime[] = [];
const realCrypto = globalThis.crypto;
afterEach(() => {
  cleanup();
  for (const runtime of opened.splice(0)) runtime.close();
  vi.unstubAllGlobals();
});

function modal() {
  const requests: TaskLaunchRequest[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    if (init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({ error: "preparation temporarily unavailable" }, { status: 503 });
    }
    return Response.json([]);
  });
  const endpoint = "http://lan.example:7744";
  const runtime = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "local",
      incarnation: "test",
      endpoint,
      release: "test",
    },
    client: createNacClient({ endpoint, credentials: "omit", fetch }),
    storage: { getItem: () => null, setItem: vi.fn() },
  });
  opened.push(runtime);
  runtime.queryClient.setDefaultOptions({ mutations: { retry: 3, retryDelay: 0 } });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>
        <MemoryRouter initialEntries={["/session/invoking"]}>
          <TaskLaunchModal
            projectId="destination"
            defaultRef="dev"
            onClose={vi.fn()}
            onExistingCheckout={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
    target: { value: "One task" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Initial brief" }), {
    target: { value: "One brief" },
  });
  return requests;
}

it("uses real Web Crypto without randomUUID, retries frozen intent and separates intentional tasks", async () => {
  // Simulate insecure-origin capabilities; this is not a live LAN-origin test.
  const random = vi.fn((bytes: Uint8Array<ArrayBuffer>) => realCrypto.getRandomValues(bytes));
  vi.stubGlobal("crypto", { getRandomValues: random });
  const requests = modal();
  fireEvent.click(screen.getByRole("button", { name: "Start isolated task" }));
  await screen.findByRole("alert");
  expect(requests).toHaveLength(1);
  const first = structuredClone(requests[0]);
  expect(first.request_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(
    screen.getByRole("textbox", { name: "Task title" }).getAttribute("disabled"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  await screen.findByRole("button", { name: "Start another intentional task" });
  expect(requests[1]).toEqual(first);
  expect(random).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Start another intentional task" }));
  fireEvent.click(screen.getByRole("button", { name: "Start isolated task" }));
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2].request_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(requests[2].request_id).not.toBe(first.request_id);
  expect(random).toHaveBeenCalledTimes(2);
});

it("renders unavailable secure entropy without sending a request and permits recovery", async () => {
  vi.stubGlobal("crypto", {});
  const requests = modal();
  fireEvent.click(screen.getByRole("button", { name: "Start isolated task" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("secure"),
  );
  expect(requests).toHaveLength(0);
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => realCrypto.getRandomValues(bytes),
  });
  fireEvent.click(screen.getByRole("button", { name: "Start isolated task" }));
  await waitFor(() => expect(requests).toHaveLength(1));
});
