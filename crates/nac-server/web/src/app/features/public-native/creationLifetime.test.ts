import { afterEach, expect, it, vi } from "vitest";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import {
  createPublicNacCreationApi,
  type PublicNacCreationSource,
} from "../../../../packages/nac-client/src/publicNacCreationApi.js";
import type {
  PublicNacCreateProject,
  PublicNacCreateSession,
} from "../../../../packages/nac-client/src/publicNativeCreation.generated.js";

// Transport/lifetime fixtures only; genuine admission and canonical codecs
// remain the receiving owner's separate bindings.
const source: PublicNacCreationSource = {
  contract: "public-native-v1",
  decoders: {
    workingLocations: JSON.parse,
    runtimeMetadata: JSON.parse,
    project: JSON.parse,
    createdSession: JSON.parse,
  },
  requests: {
    project: (value) => value as PublicNacCreateProject,
    session: (value) => value as PublicNacCreateSession,
  },
};
const session: PublicNacCreateSession = {
  project_id: "project",
  working_location_id: null,
  model_config_id: null,
  behavior: "direct",
  first_chat: false,
  first_chat_same_behavior: false,
};
const opened: NativeRuntime[] = [];
afterEach(() => {
  for (const runtime of opened.splice(0)) runtime.close();
});

function delayedTransport() {
  let resolve: (response: Response) => void = () => {};
  let dispatched: () => void = () => {};
  const sent = new Promise<void>((done) => {
    dispatched = done;
  });
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    dispatched();
    return response;
  });
  const runtime = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "host",
      incarnation: "incarnation",
      endpoint: "/admitted",
      release: "release",
    },
    client: createNacClient({ endpoint: "/admitted", fetch }),
  });
  opened.push(runtime);
  return { runtime, fetch, sent, resolve, api: createPublicNacCreationApi(runtime.client, source) };
}

it("discards a late metadata read when the original runtime closes", async () => {
  const { runtime, fetch, sent, resolve, api } = delayedTransport();
  const pending = api.getRuntimeMetadata();
  await sent;
  runtime.close();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  resolve(Response.json({ release_id: "late" }));
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledOnce();
  expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it("keeps an in-flight creation uncertain after closure and discards late success", async () => {
  const { runtime, fetch, sent, resolve, api } = delayedTransport();
  const pending = api.createSession(session, { requestId: "same-request" });
  await sent;
  runtime.close();
  const outcome = await pending;
  expect(outcome).toMatchObject({ status: "uncertain", requestId: "same-request" });
  resolve(Response.json({ session_id: "late-created", behavior: "direct", project_id: "project" }));
  await Promise.resolve();
  expect(outcome.status).toBe("uncertain");
  expect(fetch).toHaveBeenCalledOnce();
  expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(await api.createSession(session, { requestId: "after-close" })).toEqual({
    status: "not-sent",
    requestId: "after-close",
    reason: "aborted",
  });
  expect(fetch).toHaveBeenCalledOnce();
});
