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
  it("offers Agent and NAC for new chats and presents hybrid rows as Agent", () => {
    expect(SESSION_BEHAVIORS.map((behavior) => behavior.id)).toEqual(["direct", "orchestrator"]);
    expect(CREATE_SESSION_BEHAVIORS.map((behavior) => behavior.id)).toEqual([
      "direct",
      "orchestrator",
    ]);

    expect(sessionBehaviorPresentation("orchestrator")).toMatchObject({
      label: "NAC",
      navigationLabel: "NAC",
      topLevel: expect.stringMatching(/planner/i),
      editsDirectly: false,
      delegation: expect.stringMatching(/retained NAC worker threads/i),
      inspection: expect.stringMatching(/Threads and Worksets/i),
    });
    expect(sessionBehaviorPresentation("direct")).toMatchObject({
      label: "Agent",
      navigationLabel: "Agent",
      topLevel: expect.stringMatching(/persistent coding agent/i),
      editsDirectly: true,
      delegation: expect.stringMatching(/separate NAC sessions/i),
      inspection: expect.stringMatching(/Delegated work/i),
    });
    expect(sessionBehaviorPresentation("direct-with-orchestrator")).toMatchObject({
      id: "direct-with-orchestrator",
      label: "Agent",
      navigationLabel: "Agent",
      editsDirectly: true,
    });
    expect(isAgentBehavior("direct")).toBe(true);
    expect(isAgentBehavior("direct-with-orchestrator")).toBe(true);
    expect(isAgentBehavior("orchestrator")).toBe(false);
  });
});

describe("session panel policy", () => {
  const behaviors: SessionBehavior[] = ["orchestrator", "direct", "direct-with-orchestrator"];

  it("keeps every primary behavior's established desktop and mobile panels", () => {
    expect(sessionPanelPolicy("orchestrator", null)).toEqual({
      widePanels: ["threads", "files", "worksets"],
      mobilePanels: ["threads", "files", "worksets", "history"],
      defaultPanel: "threads",
      readOnly: false,
    });
    for (const behavior of ["direct", "direct-with-orchestrator"] satisfies SessionBehavior[]) {
      expect(sessionPanelPolicy(behavior, null)).toEqual({
        widePanels: ["delegated", "files"],
        mobilePanels: ["delegated", "files", "history"],
        defaultPanel: "delegated",
        readOnly: false,
      });
    }
  });

  it("keeps traditional children Files/History-only while the assignment is open", () => {
    for (const behavior of behaviors) {
      expect(sessionPanelPolicy(behavior, "traditional-child", "running")).toEqual({
        widePanels: ["files"],
        mobilePanels: ["files", "history"],
        defaultPanel: "files",
        readOnly: true,
      });
    }
  });

  it("treats settled traditional children as ordinary Agent chats", () => {
    for (const behavior of ["direct", "direct-with-orchestrator"] satisfies SessionBehavior[]) {
      expect(sessionPanelPolicy(behavior, "traditional-child", "completed")).toEqual({
        widePanels: ["delegated", "files"],
        mobilePanels: ["delegated", "files", "history"],
        defaultPanel: "delegated",
        readOnly: false,
      });
    }
  });

  it("gives managed orchestrators their own Threads and Worksets while remaining read-only", () => {
    for (const behavior of behaviors) {
      expect(sessionPanelPolicy(behavior, "managed-orchestrator", "running")).toEqual({
        widePanels: ["threads", "files", "worksets"],
        mobilePanels: ["threads", "files", "worksets", "history"],
        defaultPanel: "threads",
        readOnly: true,
      });
    }
  });

  it("unlocks a settled managed orchestrator", () => {
    expect(sessionPanelPolicy("orchestrator", "managed-orchestrator", "completed")).toEqual({
      widePanels: ["threads", "files", "worksets"],
      mobilePanels: ["threads", "files", "worksets", "history"],
      defaultPanel: "threads",
      readOnly: false,
    });
  });

  it("treats idle and running as open assignments", () => {
    expect(assignmentIsOpen("idle")).toBe(true);
    expect(assignmentIsOpen("running")).toBe(true);
    expect(assignmentIsOpen("completed")).toBe(false);
    expect(assignmentIsOpen(null)).toBe(false);
  });

  it("preserves the legacy omitted-behavior default", () => {
    expect(sessionPanelPolicy(undefined, null)).toEqual(sessionPanelPolicy("orchestrator", null));
  });
});
