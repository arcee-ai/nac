/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UncertainCommandAdmissionError } from "@/app/services/nacClient";
import { ApiError } from "@/app/services/api";
import { useStartSession } from "./useStartSession";
import { EMPTY_SANDBOX } from "./workspaceSandbox";

const fakes = vi.hoisted(() => ({
  create: vi.fn(),
  submit: vi.fn(),
  navigate: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
  schedule: vi.fn(),
  getSource: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => fakes.navigate }));
vi.mock("@/app/providers/ToastProvider", () => ({
  useToast: () => ({ error: fakes.toast }),
}));
vi.mock("@/app/runtime/RuntimeContext", () => ({
  useNativeRuntime: () => ({
    api: { getProjectSessionModelSource: fakes.getSource },
    stores: {
      promptDraftStore: { update: fakes.update },
      composerStore: { scheduleFirstPrompt: fakes.schedule },
    },
  }),
}));
vi.mock("@/app/services/queries", () => ({
  useCreateSession: () => ({ mutateAsync: fakes.create }),
  useSubmitRun: () => ({ mutateAsync: fakes.submit, isPending: false }),
  useSessions: () => ({ data: [] }),
  useSandboxActivity: () => ({}),
}));
const request = {
  projectId: "project",
  prompt: "one intent",
  model: {
    selection: {
      kind: "resolved" as const,
      backend: "openai-responses" as const,
      model: "gpt-5.3",
      base_url: "https://api.openai.com/v1",
      allow_insecure_http: false,
      api_key_env: "OPENAI_API_KEY",
      reasoning_effort: null,
      extra_headers: null,
    },
  },
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
  fakes.getSource.mockReset().mockResolvedValue({ config_version: 7 });
  fakes.submit.mockReset().mockResolvedValue({});
  fakes.update.mockImplementation((_: string, text: string) => ({
    text,
    revision: 1,
  }));
});
afterEach(cleanup);

it("requires review after an uncertain session creation and never retries its admission", async () => {
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

it("keeps the prompt unsent when the existing first chat has different settings", async () => {
  fakes.create.mockRejectedValue(
    new ApiError(
      409,
      "POST",
      "/sessions",
      "Existing first chat uses different model settings; review it before sending.",
      "request",
    ),
  );
  const hook = mount();
  await act(async () => expect(await hook.result.current.start(request)).toBe(false));
  expect(fakes.create).toHaveBeenCalledWith(
    expect.objectContaining({
      first_chat: true,
      first_chat_require_matching_model: true,
    }),
  );
  expect(fakes.update).not.toHaveBeenCalled();
  expect(fakes.schedule).not.toHaveBeenCalled();
  expect(fakes.submit).not.toHaveBeenCalled();
  expect(fakes.navigate).not.toHaveBeenCalled();
  expect(hook.result.current.error).toContain("different model settings");
});

it.each(["missing", "changed"])("keeps the draft unsent when its source is %s", async (failure) => {
  if (failure === "missing") fakes.getSource.mockRejectedValue(new Error("not found"));
  else fakes.getSource.mockResolvedValue({ config_version: 8 });
  const hook = mount();
  const sourced = {
    ...request,
    model: {
      ...request.model,
      source: { projectId: "project", sessionId: "source", configVersion: 7 },
    },
  };
  await act(async () => expect(await hook.result.current.start(sourced)).toBe(false));
  expect(fakes.create).not.toHaveBeenCalled();
  expect(fakes.update).not.toHaveBeenCalled();
  expect(fakes.schedule).not.toHaveBeenCalled();
  expect(fakes.navigate).not.toHaveBeenCalled();
  expect(hook.result.current.error).toContain("source session changed or moved");
});

it("revalidates an unchanged project source before creating the session", async () => {
  const hook = mount();
  const sourced = {
    ...request,
    model: {
      ...request.model,
      source: { projectId: "project", sessionId: "source", configVersion: 7 },
    },
  };
  await act(async () => expect(await hook.result.current.start(sourced)).toBe(true));
  expect(fakes.getSource).toHaveBeenCalledWith("project", "source", expect.any(AbortSignal));
  expect(fakes.create).toHaveBeenCalledOnce();
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
    backend: "openai-responses",
    model: "gpt-5.3",
    base_url: "https://api.openai.com/v1",
    allow_insecure_http: false,
    api_key_env: "OPENAI_API_KEY",
    reasoning_effort: null,
    extra_headers: null,
    first_chat: false,
    first_chat_same_behavior: true,
    first_chat_require_matching_model: true,
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
  expect(fakes.create).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-5.3", behavior: "direct" }),
  );
  expect(fakes.submit).not.toHaveBeenCalled();
  expect(fakes.schedule).toHaveBeenCalledWith("session", {
    text: "one intent",
    revision: 1,
  });
  expect(fakes.update).toHaveBeenCalledWith("session", "one intent");
  expect(fakes.navigate).toHaveBeenCalledOnce();
});
