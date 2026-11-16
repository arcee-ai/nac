import type { SessionPanel } from "../../lib/routes";
import { type SessionPanelPolicy } from "../../lib/sessionBehavior";
import { type SessionStatus } from "../../lib/sessionStatus";
import type { ManagedSessionSummary, SessionBehavior, SessionGoalRecord, SessionLineage, SessionSnapshotResponse } from "../../types/api";
export interface SessionAgents {
    count: number;
    running: number;
    /** The panel the pill opens: Subagents for a direct agent, Worksets/Insights for threads. */
    panel: SessionPanel;
    /** "agent"/"agents" for children, "thread"/"threads" for an orchestrator's workers. */
    noun: "agent" | "thread";
}
/**
 * Everything the session header shows, read once: the title and where the
 * session runs, its status on the shared ladder, and what each contextual
 * pill has to say. A pill with nothing to say is null or zero, and the header
 * leaves it out.
 */
export interface SessionFacts {
    title: string;
    behavior: SessionBehavior | null;
    lineage: SessionLineage | null;
    parent: {
        id: string;
        title: string;
    } | null;
    policy: SessionPanelPolicy | null;
    readOnly: boolean;
    direct: boolean;
    /** "nac · ux/focus · SSH": project, branch, environment. */
    meta: string[];
    repo: string | null;
    branch: string | null;
    environment: string;
    status: SessionStatus;
    running: boolean;
    additions: number;
    deletions: number;
    agents: SessionAgents | null;
    goal: SessionGoalRecord | null;
    terminal: boolean;
    schedules: number;
}
export declare function useSessionFacts(sessionId: string, snapshot: SessionSnapshotResponse | null, entry: ManagedSessionSummary | null): SessionFacts;
