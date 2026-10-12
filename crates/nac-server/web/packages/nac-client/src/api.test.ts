import { describe, expect, it, vi } from "vitest";
import { createNacApi } from "./api.js";
import { createNacClient, ApiError } from "./nacClient.js";

describe("public resource facade", () => {
  it("uses the injected transport for direct lifecycle, durable input, permissions, files and configuration", async () => {
    const requests: { method: string; path: string; body: unknown }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      requests.push({
        method: init?.method ?? "GET",
        path: String(input),
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      });
      return Response.json({});
    });
    const api = createNacApi(
      createNacClient({ endpoint: "/mediated", credentials: "omit", fetch }),
    );
    await api.createProject({ name: "project", cwd: "/repo" });
    await api.createSession({ project_id: "project", behavior: "direct" });
    await api.getSession("same/id", {
      includeSessions: false,
      includeSystem: true,
      messageLimit: 5,
    });
    await api.createInboxItem("same/id", "next_run", "queued");
    await api.updateInboxItem("same/id", 3, 7, "next_run");
    await api.createGoal("same/id", { objective: "goal" });
    await api.updateGoal("same/id", "goal/id", { expected_version: 8, status: "paused" });
    await api.replyPermission("same/id", "permission/id", "reject");
    await api.startTraditionalChild("same/id", {
      prompt: "child",
      description: "child",
      profile: "default",
    });
    await api.getWorkspaceDiff("same/id", "nested/file name", {
      revision: 2,
      stage: "staged",
      context: 6,
    });
    await api.switchBranch("same/id", { name: "feature" });
    await api.getMcpOAuthStatus("server/name");
    await api.authenticateMcpOAuth("server/name", { additional_scopes: ["scope"] });
    await api.getManagedGitIdentity();
    await api.cancelExactRun("same/id", "run/id");
    expect(requests).toMatchObject([
      { method: "POST", path: "/mediated/projects" },
      { method: "POST", path: "/mediated/sessions", body: { behavior: "direct" } },
      {
        method: "GET",
        path: "/mediated/sessions/same%2Fid?message_limit=5&include_sessions=false&include_system=true",
      },
      { method: "POST", path: "/mediated/sessions/same%2Fid/inbox", body: { prompt: "queued" } },
      {
        method: "PATCH",
        path: "/mediated/sessions/same%2Fid/inbox/3",
        body: { expected_version: 7 },
      },
      { method: "POST", path: "/mediated/sessions/same%2Fid/goal" },
      {
        method: "PATCH",
        path: "/mediated/sessions/same%2Fid/goal/goal%2Fid",
        body: { expected_version: 8 },
      },
      { method: "POST", path: "/mediated/sessions/same%2Fid/permissions/permission%2Fid" },
      { method: "POST", path: "/mediated/sessions/same%2Fid/children" },
      {
        method: "GET",
        path: "/mediated/sessions/same%2Fid/workspace/diff?path=nested%2Ffile+name&stage=staged&context=6&revision=2",
      },
      { method: "POST", path: "/mediated/sessions/same%2Fid/workspace/branches" },
      { method: "GET", path: "/mediated/mcp_library/servers/server%2Fname/oauth/status" },
      { method: "POST", path: "/mediated/mcp_library/servers/server%2Fname/oauth/authenticate" },
      { method: "GET", path: "/mediated/managed/github/git-identity" },
      { method: "POST", path: "/mediated/sessions/same%2Fid/runs/run%2Fid/cancel" },
    ]);
  });

  it("retains native errors and sends uncertain mutations once", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ error: "revision conflict" }, { status: 409 }))
      .mockRejectedValueOnce(new TypeError("lost response"));
    const api = createNacApi(createNacClient({ fetch }));
    await expect(
      api.updateGoal("session", "goal", { expected_version: 1, status: "paused" }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(api.createSession({ behavior: "direct", cwd: "/repo" })).rejects.toThrow(
      "lost response",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
