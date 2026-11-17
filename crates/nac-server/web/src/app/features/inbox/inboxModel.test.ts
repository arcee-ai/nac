import { describe, expect, it } from "vitest";
import { inboxHref } from "./inboxContext";

import {
  decisionKey,
  deriveInbox,
  nextNeedsYou,
  READ_GRACE_MS,
  type InboxReadState,
  type InboxSessionFacts,
  type SessionAttentionFacts,
} from "./inboxModel";

const NOW = 1_800_000_000_000;
const freshRead: InboxReadState = { since: NOW - 60_000, runs: {} };

function session(id: string, extra: Partial<InboxSessionFacts> = {}): InboxSessionFacts {
  return {
    id,
    title: id.toUpperCase(),
    projectName: "atlas",
    parentId: null,
    updatedAt: NOW,
    ...extra,
  };
}

function facts(id: string, extra: Partial<SessionAttentionFacts> = {}): SessionAttentionFacts {
  return {
    session_id: id,
    pending: [],
    availability: { permissions: "available", questions: "available", reviews: "available" },
    last_outcome: null,
    activity: { kind: "idle" },
    ...extra,
  };
}

function derive(
  sessions: InboxSessionFacts[],
  attention: SessionAttentionFacts[],
  options: { read?: InboxReadState; firstSeen?: Map<string, number> } = {},
) {
  return deriveInbox({
    sessions,
    attention: new Map(attention.map((entry) => [entry.session_id, entry])),
    read: options.read ?? freshRead,
    firstSeen: options.firstSeen ?? new Map(),
  });
}

describe("needs you", () => {
  it("lists approvals, questions and blocked reviews, one row per session, as the badge", () => {
    const model = derive(
      [session("a"), session("b"), session("c")],
      [
        facts("a", {
          pending: [
            { kind: "permission", request_id: "p1" },
            { kind: "permission", request_id: "p2" },
          ],
          activity: { kind: "run" },
        }),
        facts("b", { pending: [{ kind: "question", request_id: "q1" }] }),
        facts("c", { pending: [{ kind: "review", review_id: "r1" }] }),
      ],
    );
    expect(model.needsYou.map((row) => [row.sessionId, row.detail])).toEqual([
      ["a", "2 approvals"],
      ["b", "Question waiting"],
      ["c", "Review blocked"],
    ]);
    expect(model.badge).toBe(3);
    expect(inboxHref(model.needsYou[1].target)).toContain("question_request=q1");
    expect(inboxHref(model.needsYou[2].target)).toContain("review_request=r1");
    expect(model.needsYou[0].target).toEqual({ sessionId: "a", permissionRequestId: "p1" });
  });

  it("rolls a subagent's approval up to its top-level parent and targets the child's request", () => {
    const model = derive(
      [session("parent"), session("child", { parentId: "parent", title: "Check middleware" })],
      [
        facts("parent", { activity: { kind: "run" } }),
        facts("child", { pending: [{ kind: "permission", request_id: "child-req" }] }),
      ],
    );
    expect(model.needsYou).toHaveLength(1);
    expect(model.needsYou[0]).toMatchObject({
      sessionId: "parent",
      title: "PARENT",
      detail: "Approval needed from Check middleware",
      target: { sessionId: "child", permissionRequestId: "child-req" },
    });
  });

  it("advances from the exact child targeted by a rolled-up row", () => {
    const model = derive(
      [session("a"), session("a-child", { parentId: "a" }), session("b")],
      [
        facts("a-child", { pending: [{ kind: "question", request_id: "child-q" }] }),
        facts("b", { pending: [{ kind: "question", request_id: "b-q" }] }),
      ],
      {
        firstSeen: new Map([
          [decisionKey("a-child", { kind: "question", request_id: "child-q" }), 1],
          [decisionKey("b", { kind: "question", request_id: "b-q" }), 2],
        ]),
      },
    );
    expect(nextNeedsYou(model)?.target.sessionId).toBe("a-child");
    expect(nextNeedsYou(model, "a-child")?.target.sessionId).toBe("b");
    expect(nextNeedsYou(model, "a")?.target.sessionId).toBe("b");
    expect(nextNeedsYou(model, "b")?.target.sessionId).toBe("a-child");
  });

  it("orders oldest waiting first and points at the oldest decision in a row", () => {
    const firstSeen = new Map([
      [decisionKey("a", { kind: "permission", request_id: "late" }), NOW - 1000],
      [decisionKey("a", { kind: "permission", request_id: "early" }), NOW - 9000],
      [decisionKey("b", { kind: "permission", request_id: "b1" }), NOW - 5000],
    ]);
    const model = derive(
      [session("a"), session("b")],
      [
        facts("a", {
          pending: [
            { kind: "permission", request_id: "late" },
            { kind: "permission", request_id: "early" },
          ],
        }),
        facts("b", { pending: [{ kind: "permission", request_id: "b1" }] }),
      ],
      { firstSeen },
    );
    expect(model.needsYou.map((row) => row.sessionId)).toEqual(["a", "b"]);
    expect(model.needsYou[0].target.permissionRequestId).toBe("early");
  });

  it("never lists running work, so the inbox can reach zero", () => {
    const model = derive([session("a")], [facts("a", { activity: { kind: "run" } })]);
    expect(model).toMatchObject({ needsYou: [], failed: [], done: [], unavailable: [], badge: 0 });
  });

  it("cycles to the next session that needs you", () => {
    const model = derive(
      [session("a"), session("b")],
      [
        facts("a", { pending: [{ kind: "question", request_id: "q" }] }),
        facts("b", { pending: [{ kind: "question", request_id: "q" }] }),
      ],
      {
        firstSeen: new Map([
          [decisionKey("a", { kind: "question", request_id: "q" }), 1],
          [decisionKey("b", { kind: "question", request_id: "q" }), 2],
        ]),
      },
    );
    expect(nextNeedsYou(model)?.sessionId).toBe("a");
    expect(nextNeedsYou(model, "a")?.sessionId).toBe("b");
    expect(nextNeedsYou(model, "b")?.sessionId).toBe("a");
  });
});

describe("failed and done", () => {
  const completed = (id: string, run = "r1") =>
    facts(id, { last_outcome: { disposition: "completed", run_id: run } });
  const failedRun = (id: string, run = "r1") =>
    facts(id, { last_outcome: { disposition: "failed", run_id: run } });

  it("shows unread outcomes of top-level sessions, newest first", () => {
    const model = derive(
      [
        session("old", { updatedAt: NOW - 5000 }),
        session("new", { updatedAt: NOW - 1000 }),
        session("broken"),
        session("kid", { parentId: "old" }),
      ],
      [completed("old"), completed("new"), failedRun("broken"), completed("kid")],
    );
    expect(model.done.map((row) => row.sessionId)).toEqual(["new", "old"]);
    expect(model.failed.map((row) => [row.sessionId, row.detail])).toEqual([
      ["broken", "Run failed"],
    ]);
    expect(model.badge).toBe(0);
  });

  it("clears an outcome once read on this device, and comes back for a newer run", () => {
    const read = { since: NOW - 60_000, runs: { a: "r1" } };
    expect(derive([session("a")], [completed("a", "r1")], { read }).done).toHaveLength(0);
    expect(derive([session("a")], [completed("a", "r2")], { read }).done).toHaveLength(1);
  });

  it("treats outcomes from well before first use as read", () => {
    const read = { since: NOW, runs: {} };
    const stale = session("a", { updatedAt: NOW - READ_GRACE_MS - 1 });
    expect(derive([stale], [completed("a")], { read }).done).toHaveLength(0);
  });

  it("ignores cancelled runs", () => {
    const model = derive(
      [session("a")],
      [facts("a", { last_outcome: { disposition: "cancelled", run_id: "r" } })],
    );
    expect(model.done).toHaveLength(0);
    expect(model.failed).toHaveLength(0);
  });
});

describe("unknown facets", () => {
  it("never shows a falsely clean session: unknown facets become Status unavailable", () => {
    const model = derive(
      [session("a"), session("b")],
      [
        facts("a", {
          availability: { permissions: "unknown", questions: "available", reviews: "available" },
        }),
      ],
    );
    expect(model.unavailable.map((row) => [row.sessionId, row.detail])).toEqual([
      ["a", "Status unavailable"],
      ["b", "Status unavailable"],
    ]);
  });

  it("still lists what is known to need you even when another facet is unknown", () => {
    const model = derive(
      [session("a")],
      [
        facts("a", {
          pending: [{ kind: "permission", request_id: "p" }],
          availability: { permissions: "available", questions: "unknown", reviews: "available" },
        }),
      ],
    );
    expect(model.needsYou).toHaveLength(1);
    expect(model.unavailable).toHaveLength(0);
  });
});

it("reports unsupported orchestration coverage as unavailable rather than a clear Inbox", () => {
  const model = derive(
    [session("legacy")],
    [
      facts("legacy", {
        availability: {
          permissions: "unsupported",
          questions: "unsupported",
          reviews: "unsupported",
        },
      }),
    ],
  );
  expect(model.unavailable.map((row) => row.sessionId)).toEqual(["legacy"]);
  expect(model.badge).toBe(0);
});
