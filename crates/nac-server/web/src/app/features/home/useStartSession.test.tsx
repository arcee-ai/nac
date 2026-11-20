/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UncertainCommandAdmissionError } from "@/app/services/nacClient";
import { useStartSession } from "./useStartSession";
import { EMPTY_SANDBOX } from "./workspaceSandbox";

const fakes = vi.hoisted(() => ({
  create: vi.fn(),
  submit: vi.fn(),
  navigate: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => fakes.navigate }));
vi.mock("@/app/providers/ToastProvider", () => ({ useToast: () => ({ error: fakes.toast }) }));
vi.mock("@/app/runtime/RuntimeContext", () => ({
  useNativeRuntime: () => ({
    stores: {
      promptDraftStore: { update: fakes.update },
      composerStore: { scheduleFirstPrompt: fakes.schedule },
    },
  }),
}));
vi.mock("@/app/features/ui-policy/UiPolicyContext", () => ({
  useUiPolicy: () => ({ orchestrationEnabled: false }),
}));
vi.mock("@/app/services/queries", () => ({
  useCreateSession: () => ({ mutateAsync: fakes.create }),
  useCreateModelConfig: () => ({ mutateAsync: vi.fn() }),
  useSubmitRun: () => ({ mutateAsync: fakes.submit, isPending: false }),
  useSessions: () => ({ data: [] }),
  useSandboxActivity: () => ({}),
}));
const request = {
  projectId: "project",
  behavior: "direct" as const,
  prompt: "one intent",
  model: null,
};
function mount() {
  const client = new QueryClient();
  return renderHook(useStartSession, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  fakes.create.mockReset().mockResolvedValue({ metadata: { session_id: "session" } });
  fakes.submit.mockReset().mockResolvedValue({});
  fakes.update.mockImplementation((_: string, text: string) => ({ text, revision: 1 }));
});
afterEach(cleanup);

it("requires review after an uncertain plain creation and never retries its admission", async () => {
  fakes.create.mockRejectedValue(
    new UncertainCommandAdmissionError("request", new Error("lost reply")),
  );
  const hook = mount();
  await act(async () => expect(await hook.result.current.start(request)).toBe(false));
  expect(hook.result.current.needsReview).toBe(true);
  await act(async () => expect(await hook.result.current.start(request)).toBe(false));
  expect(fakes.create).toHaveBeenCalledOnce();
  expect(fakes.submit).not.toHaveBeenCalled();
});

it("does not deliver or navigate after Home detaches while creation is pending", async () => {
  const pending = Promise.withResolvers<unknown>();
  fakes.create.mockReturnValue(pending.promise);
  const hook = mount();
  let start!: Promise<boolean>;
  act(() => {
    start = hook.result.current.start(request);
  });
  await vi.waitFor(() => expect(fakes.create).toHaveBeenCalledOnce());
  hook.unmount();
  pending.resolve({ metadata: { session_id: "session" } });
  expect(await start).toBe(false);
  expect(fakes.submit).not.toHaveBeenCalled();
  expect(fakes.navigate).not.toHaveBeenCalled();
});

it("creates a new sandbox session without reusing an ordinary first chat", async () => {
  const hook = mount();
  await act(async () =>
    expect(
      await hook.result.current.start({
        ...request,
        sandbox: { ...EMPTY_SANDBOX, gpu: "all, device=1", shm: "2g" },
      }),
    ).toBe(true),
  );
  expect(fakes.create).toHaveBeenCalledExactlyOnceWith({
    project_id: "project",
    behavior: "direct",
    first_chat: false,
    first_chat_same_behavior: true,
    sandbox: {
      enabled: true,
      activity_key: expect.any(String),
      image: null,
      workdir: null,
      gpus: ["all", "device=1"],
      shm_size: "2g",
      mounts: [],
      no_mount_cwd: false,
    },
  });
});

it("keeps one creation and stages first delivery for the owning session composer", async () => {
  const pending = Promise.withResolvers<unknown>();
  fakes.create.mockReturnValue(pending.promise);
  const hook = mount();
  let first!: Promise<boolean>;
  act(() => {
    first = hook.result.current.start(request);
  });
  await act(async () => expect(await hook.result.current.start(request)).toBe(false));
  await act(async () => {
    pending.resolve({ metadata: { session_id: "session" } });
    expect(await first).toBe(true);
  });
  expect(fakes.create).toHaveBeenCalledOnce();
  expect(fakes.submit).not.toHaveBeenCalled();
  expect(fakes.schedule).toHaveBeenCalledWith("session", { text: "one intent", revision: 1 });
  expect(fakes.update).toHaveBeenCalledWith("session", "one intent");
  expect(fakes.navigate).toHaveBeenCalledOnce();
});
