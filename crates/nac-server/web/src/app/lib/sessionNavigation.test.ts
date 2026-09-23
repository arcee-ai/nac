import { describe, expect, it } from "vitest";

import { buildSessionNavigation, isSessionUnread } from "@/app/lib/sessionNavigation";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

function session(
  id: string,
  projectId: string | null,
  updatedAt: string,
  lineage: ManagedSessionSummary["lineage"] = null,
): ManagedSessionSummary {
  return {
    active: false,
    active_run: null,
    lineage,
    summary: {
      backend: "openai-responses",
      behavior: "direct",
      created_at: updatedAt,
      cwd: "/workspace",
      forked_from: null,
      last_user_prompt: null,
      model: "gpt-5.6-sol",
      project_id: projectId,
      sandboxed: false,
      session_id: id,
      ssh_host: null,
      title: id,
      updated_at: updatedAt,
      visible_message_count: 1,
    },
    workspace_diff: null,
  };
}

const projects = [
  { project_id: "beta", name: "Beta" },
  { project_id: "alpha", name: "Alpha" },
] as ProjectRecord[];

describe("global session navigation model", () => {
  it("keeps only parents, lifts browser-pinned sessions, and groups the rest by project", () => {
    const model = buildSessionNavigation(
      projects,
      [
        session("alpha-old", "alpha", "2026-09-20T12:00:00Z"),
        session("beta", "beta", "2026-09-22T12:00:00Z"),
        session("alpha-new", "alpha", "2026-09-21T12:00:00Z"),
        session("loose", null, "2026-09-19T12:00:00Z"),
        session("child", "alpha", "2026-09-23T12:00:00Z", {
          kind: "traditional-child",
          parent_session_id: "alpha-new",
          root_session_id: "alpha-new",
          description: "delegated",
        }),
      ],
      new Set(["alpha-new"]),
    );

    expect(
      model.pinned.map((item) => [item.session.summary.session_id, item.projectLabel]),
    ).toEqual([["alpha-new", "Alpha"]]);
    expect(
      model.groups.map((group) => [
        group.label,
        ...group.sessions.map((s) => s.summary.session_id),
      ]),
    ).toEqual([
      ["Beta", "beta"],
      ["Alpha", "alpha-old"],
      ["Unassigned", "loose"],
    ]);
    expect(JSON.stringify(model)).not.toContain("child");
  });

  it("does not call a session unassigned when its project record is unavailable", () => {
    const model = buildSessionNavigation(
      [],
      [session("known-owner", "project-42", "2026-09-22T12:00:00Z")],
      new Set(),
    );
    expect(model.groups[0]).toMatchObject({
      key: "unavailable:project-42",
      label: "Project project-42",
    });
  });

  it("derives unread only from server update time relative to the local viewed marker", () => {
    expect(isSessionUnread("2026-09-22T12:00:00Z", undefined)).toBe(true);
    expect(isSessionUnread("2026-09-22T12:00:00Z", "2026-09-22T12:00:00Z")).toBe(false);
    expect(isSessionUnread("2026-09-22T12:00:01Z", "2026-09-22T12:00:00Z")).toBe(true);
    expect(isSessionUnread("not-a-time", undefined)).toBe(false);
  });
});
