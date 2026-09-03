import { describe, expect, it } from "vitest";

import {
  CREATE_SESSION_BEHAVIORS,
  SESSION_BEHAVIORS,
  isAgentBehavior,
  sessionBehaviorPresentation,
  assignmentIsOpen,
  sessionPanelPolicy,
} from "@/app/lib/sessionBehavior";
import type { SessionBehavior } from "@/app/types/api";

describe("session behavior presentation", () => {
  it("offers Agent, Agent + Orchestrator, and Orchestrator for new chats", () => {
    expect(SESSION_BEHAVIORS.map((behavior) => behavior.id)).toEqual([
      "direct",
      "direct-with-orchestrator",
      "orchestrator",
    ]);
    expect(CREATE_SESSION_BEHAVIORS.map((behavior) => behavior.id)).toEqual([
      "direct",
      "direct-with-orchestrator",
      "orchestrator",
    ]);

    expect(sessionBehaviorPresentation("orchestrator")).toMatchObject({
      label: "Orchestrator",
      navigationLabel: "Orchestrator",
      topLevel: expect.stringMatching(/planner/i),
      editsDirectly: false,
      delegation: expect.stringMatching(
        /retained Orchestrator worker threads/i,
      ),
      inspection: expect.stringMatching(/Actions and Worksets/i),
    });
    expect(sessionBehaviorPresentation("direct")).toMatchObject({
      label: "Agent",
      navigationLabel: "Agent",
      topLevel: expect.stringMatching(/persistent coding agent/i),
      editsDirectly: true,
      delegation: expect.stringMatching(/fresh-context coding agents/i),
      inspection: expect.stringMatching(/Actions show reasoning/i),
    });
    expect(
      sessionBehaviorPresentation("direct-with-orchestrator"),
    ).toMatchObject({
      id: "direct-with-orchestrator",
      label: "Agent + Orchestrator",
      navigationLabel: "Agent + Orchestrator",
      createLabel: "New Agent + Orchestrator",
      editsDirectly: true,
      delegation: expect.stringMatching(/separate Orchestrator sessions/i),
    });
    expect(isAgentBehavior("direct")).toBe(true);
    expect(isAgentBehavior("direct-with-orchestrator")).toBe(true);
    expect(isAgentBehavior("orchestrator")).toBe(false);
  });
});

describe("session panel policy", () => {
  const behaviors: SessionBehavior[] = [
    "orchestrator",
    "direct",
    "direct-with-orchestrator",
  ];

  it("keeps every primary behavior's established desktop and mobile panels", () => {
    expect(sessionPanelPolicy("orchestrator", null)).toEqual({
      widePanels: ["actions", "threads", "files", "worksets"],
      mobilePanels: ["actions", "threads", "files", "worksets", "history"],
      defaultPanel: "actions",
      readOnly: false,
    });
    for (const behavior of [
      "direct",
      "direct-with-orchestrator",
    ] satisfies SessionBehavior[]) {
      expect(sessionPanelPolicy(behavior, null)).toEqual({
        widePanels: ["actions", "files", "delegated"],
        mobilePanels: ["actions", "files", "delegated", "history"],
        defaultPanel: "actions",
        readOnly: false,
      });
    }
  });

  it("keeps traditional children Files/History-only", () => {
    for (const behavior of behaviors) {
      expect(
        sessionPanelPolicy(behavior, "traditional-child", "running"),
      ).toEqual({
        widePanels: ["files"],
        mobilePanels: ["files", "history"],
        defaultPanel: "files",
        readOnly: true,
      });
      expect(
        sessionPanelPolicy(behavior, "traditional-child", "completed"),
      ).toEqual({
        widePanels: ["files"],
        mobilePanels: ["files", "history"],
        defaultPanel: "files",
        readOnly: true,
      });
    }
  });

  it("gives managed orchestrators their own Threads and Worksets while remaining read-only", () => {
    for (const behavior of behaviors) {
      expect(
        sessionPanelPolicy(behavior, "managed-orchestrator", "running"),
      ).toEqual({
        widePanels: ["actions", "threads", "files", "worksets"],
        mobilePanels: ["actions", "threads", "files", "worksets", "history"],
        defaultPanel: "actions",
        readOnly: true,
      });
    }
  });

  it("keeps a managed orchestrator read-only after settle", () => {
    expect(
      sessionPanelPolicy("orchestrator", "managed-orchestrator", "completed"),
    ).toEqual({
      widePanels: ["actions", "threads", "files", "worksets"],
      mobilePanels: ["actions", "threads", "files", "worksets", "history"],
      defaultPanel: "actions",
      readOnly: true,
    });
  });

  it("treats idle and running as open assignments", () => {
    expect(assignmentIsOpen("idle")).toBe(true);
    expect(assignmentIsOpen("running")).toBe(true);
    expect(assignmentIsOpen("completed")).toBe(false);
    expect(assignmentIsOpen(null)).toBe(false);
  });

  it("preserves the legacy omitted-behavior default", () => {
    expect(sessionPanelPolicy(undefined, null)).toEqual(
      sessionPanelPolicy("orchestrator", null),
    );
  });
});
