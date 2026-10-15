import { expect, it, vi } from "vitest";
import { ApiError, NacClient, NacRequestNotSentError } from "./nacClient.js";
import {
  createPublicNacCreationApi,
  type PublicNacCreationSource,
} from "./publicNacCreationApi.js";
import type {
  PublicNacCreateProject,
  PublicNacCreateSession,
} from "./publicNativeCreation.generated.js";

// Synthetic scalar fixtures test transport wiring only. They do not qualify
// Root's canonical schemas, real locations or genuine backend admission.
const project: PublicNacCreateProject = {
  working_location_id: "opaque-location",
  name: "Project",
  description: null,
  default_model_config_id: null,
};
const session: PublicNacCreateSession = {
  project_id: "admitted-project",
  working_location_id: null,
  model_config_id: null,
  behavior: "direct",
  first_chat: true,
  first_chat_same_behavior: false,
};
function source(): PublicNacCreationSource {
  return {
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
}

it("requires all explicit codecs and original transport support before I/O", () => {
  const fetch = vi.fn();
  const client = new NacClient({ fetch });
  const old = new Proxy(client.transport, {
    get: (target, key, receiver) =>
      key === "jsonResponseDecodingVersion" ? undefined : Reflect.get(target, key, receiver),
  });
  expect(() => createPublicNacCreationApi(new NacClient(old), source())).toThrow(
    "transport support",
  );
  for (const name of [
    "workingLocations",
    "runtimeMetadata",
    "project",
    "createdSession",
  ] as const) {
    const selected = source();
    Reflect.deleteProperty(selected.decoders, name);
    expect(() => createPublicNacCreationApi(client, selected)).toThrow("Missing public");
  }
  for (const name of ["project", "session"] as const) {
    const selected = source();
    Reflect.deleteProperty(selected.requests, name);
    expect(() => createPublicNacCreationApi(client, selected)).toThrow("Missing public");
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the four exact operations, original text decoders and authoritative reused identity", async () => {
  const selected = source();
  const locations = [{ working_location_id: "opaque-location", display_name: "Approved location" }];
  const metadata = {
    release_id: "selected",
    product_version: "version",
    source_revision: "revision",
    build_id: "build",
    schema_version: "9223372036854775807",
  };
  const created = {
    session_id: "actual-reused",
    behavior: "orchestrator",
    project_id: "actual-project",
  };
  const responses = [locations, metadata, { project_id: "actual-project" }, created];
  const texts = responses.map((body) => JSON.stringify(body));
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(texts.shift(), { headers: { "Content-Type": "application/json" } }),
  );
  const decoders = Object.fromEntries(
    Object.entries(selected.decoders).map(([name, decode]) => [name, vi.fn(decode)]),
  );
  Object.assign(selected.decoders, decoders);
  const api = createPublicNacCreationApi(
    new NacClient({ endpoint: "/same/native", fetch }),
    selected,
  );
  expect(await api.listWorkingLocations()).toEqual(locations);
  expect(await api.getRuntimeMetadata()).toEqual(metadata);
  expect(await api.createProject(project, { requestId: "project-request" })).toMatchObject({
    status: "accepted",
    requestId: "project-request",
    response: { project_id: "actual-project" },
  });
  expect(await api.createSession(session, { requestId: "session-request" })).toEqual({
    status: "accepted",
    requestId: "session-request",
    response: created,
  });
  expect(fetch.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
    ["/same/native/public/working-locations", "GET", undefined],
    ["/same/native/public/runtime-metadata", "GET", undefined],
    ["/same/native/public/projects", "POST", JSON.stringify(project)],
    ["/same/native/public/sessions", "POST", JSON.stringify(session)],
  ]);
  for (const [index, name] of [
    "workingLocations",
    "runtimeMetadata",
    "project",
    "createdSession",
  ].entries()) {
    expect(decoders[name]).toHaveBeenCalledExactlyOnceWith(JSON.stringify(responses[index]));
  }
});

it.each([undefined, null, "high"])(
  "preserves effort omission/null/value: %s",
  async (reasoning_effort) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ session_id: "actual", behavior: "direct", project_id: "admitted-project" }),
    );
    const api = createPublicNacCreationApi(new NacClient({ fetch }), source());
    await api.createSession(
      reasoning_effort === undefined ? session : { ...session, reasoning_effort },
    );
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(Object.hasOwn(body, "reasoning_effort")).toBe(reasoning_effort !== undefined);
    if (reasoning_effort !== undefined) expect(body.reasoning_effort).toBe(reasoning_effort);
  },
);

it("calls canonical request validation before dispatch and never falls back to a native path/body", () => {
  const fetch = vi.fn();
  const selected = source();
  const failure = new Error("Canonical request refused private fields");
  const validate = vi.fn((_value: unknown) => {
    throw failure;
  });
  selected.requests.project = validate;
  selected.requests.session = validate;
  const api = createPublicNacCreationApi(new NacClient({ fetch }), selected);
  const privateProject = { ...project, cwd: "/private", ssh_host: "private" };
  const privateSession = { ...session, base_url: "private", extra_headers: { Secret: "private" } };
  expect(() => api.createProject(privateProject)).toThrow(failure);
  expect(() => api.createSession(privateSession)).toThrow(failure);
  expect(validate.mock.calls.map(([value]) => value)).toEqual([privateProject, privateSession]);
  expect(fetch).not.toHaveBeenCalled();
});

it("snapshots validated scalar bodies and callback references before asynchronous credential refresh", async () => {
  let release: (value: HeadersInit) => void = () => {};
  const headers = new Promise<HeadersInit>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ session_id: "actual", behavior: "direct", project_id: "admitted-project" }),
  );
  const selected = source();
  const validate = vi.fn(selected.requests.session);
  selected.requests.session = validate;
  const decode = vi.fn(selected.decoders.createdSession);
  selected.decoders.createdSession = decode;
  const api = createPublicNacCreationApi(
    new NacClient({ headers: () => headers, fetch }),
    selected,
  );
  selected.requests.session = vi.fn(() => {
    throw new Error("Replaced validator");
  });
  selected.decoders.createdSession = vi.fn(() => {
    throw new Error("Replaced decoder");
  });
  const payload = { ...session };
  const pending = api.createSession(payload);
  payload.project_id = "changed";
  payload.reasoning_effort = "changed";
  release({ Authorization: "Bearer fresh" });
  expect(await pending).toMatchObject({ status: "accepted", response: { session_id: "actual" } });
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(session);
  expect(validate).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledOnce();
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer fresh");
});

it("preserves before-send not-sent fate and caller cancellation without retry", async () => {
  const fetch = vi.fn();
  const controller = new AbortController();
  controller.abort();
  const api = createPublicNacCreationApi(new NacClient({ fetch }), source());
  expect(
    await api.createProject(project, { signal: controller.signal, requestId: "aborted" }),
  ).toEqual({ status: "not-sent", requestId: "aborted", reason: "aborted" });
  const cause = new NacRequestNotSentError(new Error("Retired current resource"));
  const fenced = createPublicNacCreationApi(
    new NacClient({
      fetch,
      headers: () => {
        throw cause;
      },
    }),
    source(),
  );
  expect(await fenced.createSession(session, { requestId: "fenced" })).toEqual({
    status: "not-sent",
    requestId: "fenced",
    reason: "adapter-not-sent",
    error: cause,
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps lost responses uncertain, HTTP rejection explicit, and never retries creation", async () => {
  const lost = new TypeError("Response lost");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(lost)
    .mockResolvedValueOnce(Response.json({ error: "denied" }, { status: 403 }));
  const api = createPublicNacCreationApi(new NacClient({ fetch }), source());
  expect(await api.createSession(session, { requestId: "lost" })).toEqual({
    status: "uncertain",
    requestId: "lost",
    error: lost,
  });
  await expect(api.createProject(project)).rejects.toBeInstanceOf(ApiError);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("treats a rejected authoritative response codec as uncertain after dispatch", async () => {
  const selected = source();
  selected.decoders.createdSession = () => {
    throw new NacRequestNotSentError(new Error("Invalid returned identity"));
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
  const result = await createPublicNacCreationApi(new NacClient({ fetch }), selected).createSession(
    session,
  );
  expect(result.status).toBe("uncertain");
  expect(fetch).toHaveBeenCalledOnce();
});
