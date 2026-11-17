import { useEffect } from "react";

import { useTaskQuestions } from "@/app/features/questions/queries";
import { useSessionSchedules } from "@/app/features/session-chrome/queries";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { sessionEnvLabel, tokenUsage } from "@/app/lib/format";
import type { SessionPanel } from "@/app/lib/routes";
import { sessionPanelPolicy, type SessionPanelPolicy } from "@/app/lib/sessionBehavior";
import { sessionStatus, type SessionStatus } from "@/app/lib/sessionStatus";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import {
  useManagedOrchestrators,
  useProjects,
  useSessionGoal,
  useSessionPermissions,
  useTraditionalChildren,
  useVisibleSessions,
  useWorkspaceRevisionChanges,
} from "@/app/services/queries";
import type {
  ManagedSessionSummary,
  SessionBehavior,
  SessionGoalRecord,
  SessionLineage,
  SessionSnapshotResponse,
} from "@/app/types/api";

export interface SessionAgents {
  count: number;
  running: number;
  /** The panel the Session menu's row opens: Subagents for a direct agent, Worksets/Insights for threads. */
  panel: SessionPanel;
  /** "agent"/"agents" for children, "thread"/"threads" for an orchestrator's workers. */
  noun: "agent" | "thread";
}

/**
 * Everything the session header shows, read once: the title and where the
 * session runs, its status on the shared ladder, and what each panel has to
 * say in the Session menu. A panel with nothing to say is null or zero.
 */
export interface SessionFacts {
  title: string;
  behavior: SessionBehavior | null;
  lineage: SessionLineage | null;
  parent: { id: string; title: string } | null;
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
  /** Whether any of those schedules is armed (not paused or suspended). */
  schedulesActive: boolean;
}

const RUNNING_CHILD = new Set(["running"]);

export function useSessionFacts(
  sessionId: string,
  snapshot: SessionSnapshotResponse | null,
  entry: ManagedSessionSummary | null,
): SessionFacts {
  const { useRunning, useCancelArmed, liftSessionSpend } = useNativeRuntime().stores.runtimeStore;
  const { useSelectedRevision } = useNativeRuntime().stores.sessionLayoutStore;
  const uiPolicy = useUiPolicy();
  const sessionTitle = useSessionTitle();
  const { data: sessions = [] } = useVisibleSessions();
  const { data: projectList } = useProjects();

  const running = useRunning(sessionId);
  const stopping = useCancelArmed(sessionId);
  // The header used to own lifting the persisted spend for the run readings.
  useEffect(() => {
    liftSessionSpend(tokenUsage(snapshot));
  }, [liftSessionSpend, snapshot]);

  const lineage = entry?.lineage ?? snapshot?.lineage ?? null;
  const readOnly = lineage != null;
  const behaviorKnown = entry != null || snapshot != null;
  const behavior: SessionBehavior | null = behaviorKnown
    ? (entry?.summary.behavior ?? snapshot?.metadata.behavior ?? "orchestrator")
    : null;
  const policy = behavior == null ? null : sessionPanelPolicy(behavior, lineage?.kind);
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const widePanels = policy?.widePanels ?? [];

  // Changes: the live tree, or the revision the panels are looking at.
  const selectedRevision = useSelectedRevision();
  const changes = useWorkspaceRevisionChanges(sessionId, selectedRevision);
  const workspace = snapshot?.workspace ?? null;
  const totals =
    selectedRevision == null
      ? (workspace ?? entry?.workspace_diff ?? null)
      : (changes.data ?? { total_additions: 0, total_deletions: 0 });

  // Subagents: traditional children and, when orchestration is on, managed orchestrators.
  const subagents = widePanels.includes("delegated");
  const children = useTraditionalChildren(sessionId, subagents);
  const orchestrators = useManagedOrchestrators(
    sessionId,
    subagents && behavior === "direct-with-orchestrator",
  );
  const delegated = [
    ...(children.data ?? []),
    ...(uiPolicy.orchestrationEnabled ? (orchestrators.data ?? []) : []),
  ];
  const threads = snapshot?.threads ?? [];
  const worksetCount = snapshot?.worksets?.items.length ?? 0;
  const agents: SessionAgents | null = subagents
    ? delegated.length > 0
      ? {
          count: delegated.length,
          running: delegated.filter((record) => RUNNING_CHILD.has(record.status)).length,
          panel: "delegated",
          noun: "agent",
        }
      : null
    : widePanels.includes("worksets") && (threads.length > 0 || worksetCount > 0)
      ? {
          count: threads.length,
          running: snapshot?.active_threads?.length ?? 0,
          panel: worksetCount > 0 ? "worksets" : "insights",
          noun: "thread",
        }
      : null;

  const goalQuery = useSessionGoal(sessionId, direct && !readOnly);
  const schedules = useSessionSchedules(sessionId, widePanels.includes("heartbeats"));

  // Status: the same ladder the sidebar and Home draw. The composer already
  // polls permissions and questions; these read the shared cache entries.
  const permissions = useSessionPermissions(sessionId, direct, false);
  const questions = useTaskQuestions(sessionId, behavior === "direct");
  const status = sessionStatus({
    pendingPermissions: permissions.data?.requests.length ?? 0,
    pendingQuestions: (questions.data ?? []).filter((question) => question.status === "pending")
      .length,
    failedUnseen: !running && snapshot?.run_failure != null,
    running: running || stopping,
    childrenRunning: (agents?.running ?? 0) > 0,
  });

  const project = entry?.summary.project_id
    ? projectList?.projects.find((item) => item.project_id === entry.summary.project_id)
    : undefined;
  const repo = workspace?.repo_label ?? workspace?.workspace_display ?? null;
  const branch = workspace?.branch ?? null;
  const environment = sessionEnvLabel(entry?.summary);
  const place = project?.name ?? repo;
  const meta = [place, branch, environment === "Local" ? null : environment].filter(
    (part): part is string => Boolean(part),
  );

  const parentEntry = lineage
    ? sessions.find((item) => item.summary.session_id === lineage.parent_session_id)
    : undefined;

  return {
    title: sessionTitle(entry?.summary),
    behavior,
    lineage,
    parent: lineage
      ? {
          id: lineage.parent_session_id,
          title: parentEntry ? sessionTitle(parentEntry.summary) : "Parent session",
        }
      : null,
    policy,
    readOnly,
    direct,
    meta,
    repo,
    branch,
    environment,
    status,
    running,
    additions: totals?.total_additions ?? 0,
    deletions: totals?.total_deletions ?? 0,
    agents,
    goal: goalQuery.data ?? null,
    terminal: widePanels.includes("terminal"),
    schedules: schedules.count,
    schedulesActive: schedules.active,
  };
}
