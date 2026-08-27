import { describe, expect, it } from "vitest";

import {
  newestPrimarySessionForProject,
  orphanSessions,
  primarySessions,
  projectEntries,
} from "@/app/lib/projects";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

function session(
  id: string,
  projectId: string | undefined,
  delegated = false,
): ManagedSessionSummary {
  return {
    active: false,
    lineage: delegated
      ? {
          kind: "traditional-child",
          parent_session_id: "parent",
          root_session_id: "parent",
          description: "delegated",
        }
      : null,
    summary: {
      session_id: id,
      behavior: "direct",
      project_id: projectId,
      cwd: "/workspace",
      model: "model",
      backend: "backend",
      visible_message_count: 0,
      last_user_prompt: null,
      sandboxed: false,
      ssh_host: null,
      title: null,
      created_at: "2026-08-25T00:00:00Z",
      updated_at: "2026-08-25T00:00:00Z",
      run_count: 0,
    },
  };
}

describe("project chat ownership", () => {
  it("keeps delegated descendants out of primary project and orphan navigation", () => {
    const project = {
      project_id: "project",
      name: "Project",
      created_at: "2026-08-25T00:00:00Z",
      updated_at: "2026-08-25T00:00:00Z",
    } as ProjectRecord;
    const sessions = [
      session("parent", "project"),
      session("child", "project", true),
      session("orphan", undefined),
      session("orphan-child", undefined, true),
    ];

    expect(primarySessions(sessions).map((entry) => entry.summary.session_id)).toEqual([
      "parent",
      "orphan",
    ]);
    expect(
      projectEntries([project], sessions)[0].sessions.map((entry) => entry.summary.session_id),
    ).toEqual(["parent"]);
    expect(orphanSessions(sessions).map((entry) => entry.summary.session_id)).toEqual(["orphan"]);
  });

  it("redirects a project to its newest primary chat even when a child is newer", () => {
    const parent = session("parent", "project");
    parent.summary.updated_at = "2026-08-25T00:00:01Z";
    const child = session("child", "project", true);
    child.summary.updated_at = "2026-08-25T00:00:03Z";
    const newerParent = session("newer-parent", "project");
    newerParent.summary.updated_at = "2026-08-25T00:00:02Z";

    expect(
      newestPrimarySessionForProject([parent, child, newerParent], "project")?.summary.session_id,
    ).toBe("newer-parent");
  });
});
