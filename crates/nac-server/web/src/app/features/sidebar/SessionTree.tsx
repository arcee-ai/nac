import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useNow } from "@/app/hooks/useNow";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { parseStoreTime } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { sessionBehaviorPresentation } from "@/app/lib/sessionBehavior";
import { mostUrgent, needsYou, type SessionStatus } from "@/app/lib/sessionStatus";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

import { ProjectGroupHeader } from "./ProjectGroupHeader";
import { ProjectsSectionHeader } from "./ProjectsSectionHeader";
import { SessionRow } from "./SessionRow";
import { useSessionStatuses, type SessionStatusIndex } from "./sessionStatuses";

/** Unpinned top-level rows shown per group before "See N more". */
const PREVIEW_LIMIT = 6;
const AGE_TICK_MS = 30_000;

function byRecency(a: ManagedSessionSummary, b: ManagedSessionSummary) {
  return parseStoreTime(b.summary.updated_at) - parseStoreTime(a.summary.updated_at);
}

/** Pinned first, then most recently active. */
function rootOrder(a: ManagedSessionSummary, b: ManagedSessionSummary) {
  const pinned = Number(Boolean(b.summary.pinned)) - Number(Boolean(a.summary.pinned));
  return pinned || byRecency(a, b);
}

interface TreeIndex {
  children: ReadonlyMap<string, ManagedSessionSummary[]>;
  roots: ManagedSessionSummary[];
  /** Ancestors of the session on screen, so its parents unfold to show it. */
  activeAncestors: ReadonlySet<string>;
}

function indexTree(sessions: readonly ManagedSessionSummary[], activeId: string | null): TreeIndex {
  const byId = new Map(sessions.map((entry) => [entry.summary.session_id, entry]));
  const children = new Map<string, ManagedSessionSummary[]>();
  const roots: ManagedSessionSummary[] = [];
  for (const entry of sessions) {
    const parent = entry.lineage?.parent_session_id;
    if (entry.lineage == null) roots.push(entry);
    else if (parent && byId.has(parent)) {
      const bucket = children.get(parent);
      if (bucket) bucket.push(entry);
      else children.set(parent, [entry]);
    }
  }
  for (const bucket of children.values()) bucket.sort(byRecency);
  roots.sort(rootOrder);
  const activeAncestors = new Set<string>();
  let cursor = activeId ? byId.get(activeId)?.lineage?.parent_session_id : undefined;
  while (cursor && !activeAncestors.has(cursor)) {
    activeAncestors.add(cursor);
    cursor = byId.get(cursor)?.lineage?.parent_session_id;
  }
  return { children, roots, activeAncestors };
}

interface TreeContext {
  index: TreeIndex;
  statuses: SessionStatusIndex;
  activeSessionId: string | null;
  expandedToggles: readonly string[];
  now: number;
  touch: boolean;
  open: (id: string) => void;
}

function RowTree({
  entry,
  depth,
  ctx,
  orphan = false,
}: {
  entry: ManagedSessionSummary;
  depth: number;
  ctx: TreeContext;
  orphan?: boolean;
}) {
  const { toggleParentExpanded } = useNativeRuntime().stores.sidebarLayoutStore;
  const sessionTitle = useSessionTitle();
  const policy = useUiPolicy();
  const sessionActions = useSessionActions();
  const projectActions = useProjectActions();
  const id = entry.summary.session_id;
  const title = sessionTitle(entry.summary);
  const kids = ctx.index.children.get(id) ?? [];
  // A parent of the session on screen starts open; a click flips either default.
  const expanded =
    kids.length > 0 && ctx.expandedToggles.includes(id) !== ctx.index.activeAncestors.has(id);
  const label = policy.orchestrationEnabled
    ? `${title}, ${sessionBehaviorPresentation(entry.summary.behavior).navigationLabel}`
    : title;
  return (
    <>
      <SessionRow
        title={title}
        label={label}
        status={expanded ? ctx.statuses.own(id) : ctx.statuses.rolled(id)}
        updatedAt={entry.summary.updated_at}
        now={ctx.now}
        active={id === ctx.activeSessionId}
        depth={depth}
        pinned={depth === 0 && Boolean(entry.summary.pinned)}
        childCount={kids.length}
        expanded={expanded}
        onToggleChildren={() => toggleParentExpanded(id)}
        touch={ctx.touch}
        onOpen={() => ctx.open(id)}
        onPin={depth === 0 ? () => void sessionActions.togglePin(entry.summary) : undefined}
        onRename={() => sessionActions.rename(entry.summary)}
        onDelete={() => sessionActions.remove(entry.summary)}
        onAssign={orphan ? () => projectActions.assign(entry.summary) : undefined}
      />
      {expanded
        ? kids.map((child) => (
            <RowTree key={child.summary.session_id} entry={child} depth={depth + 1} ctx={ctx} />
          ))
        : null}
    </>
  );
}

function RevealRow({
  hidden,
  onReveal,
  touch,
}: {
  hidden: number;
  onReveal: () => void;
  touch: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onReveal}
      className={cn(
        "type-meta flex w-full items-center rounded-md pl-[34px] text-left text-basic-tertiary",
        "hover:bg-[var(--f-wash-1)] hover:text-basic-primary",
        touch ? "min-h-11" : "h-7",
      )}
    >
      See {hidden} more
    </button>
  );
}

/** Top-level rows of one group, trimmed to a preview until revealed. */
function GroupRows({
  groupId,
  roots,
  ctx,
  orphan = false,
}: {
  groupId: string;
  roots: ManagedSessionSummary[];
  ctx: TreeContext;
  orphan?: boolean;
}) {
  const { revealGroup, useRevealedGroups } = useNativeRuntime().stores.sidebarLayoutStore;
  const revealed = useRevealedGroups().includes(groupId);
  let budget = PREVIEW_LIMIT;
  const shown = revealed
    ? roots
    : roots.filter((entry) => {
        const id = entry.summary.session_id;
        if (entry.summary.pinned) return true;
        if (id === ctx.activeSessionId || ctx.index.activeAncestors.has(id)) return true;
        if (budget <= 0) return false;
        budget -= 1;
        return true;
      });
  const hidden = roots.length - shown.length;
  return (
    <div className="flex flex-col gap-px">
      {shown.map((entry) => (
        <RowTree key={entry.summary.session_id} entry={entry} depth={0} ctx={ctx} orphan={orphan} />
      ))}
      {hidden > 0 ? (
        <RevealRow hidden={hidden} touch={ctx.touch} onReveal={() => revealGroup(groupId)} />
      ) : null}
    </div>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <p className="type-meta-strong px-2.5 pt-3 pb-1 text-basic-tertiary">{children}</p>;
}

const STATUS_GROUPS: { id: string; label: string; test: (status: SessionStatus) => boolean }[] = [
  { id: "status:needs", label: "Needs you", test: needsYou },
  {
    id: "status:running",
    label: "Running",
    test: (status) => status === "working" || status === "waiting",
  },
  { id: "status:recent", label: "Recent", test: () => true },
];

/**
 * The sidebar's session list: by project (default) or by status, with
 * subagents folded under their parents. Shared by the desktop sidebar and the
 * phone menu.
 */
export function SessionTree({
  projects,
  sessions,
  activeSessionId,
  touch = false,
  onNavigate,
}: {
  projects: readonly ProjectRecord[];
  sessions: readonly ManagedSessionSummary[];
  activeSessionId: string | null;
  touch?: boolean;
  onNavigate?: () => void;
}) {
  const stores = useNativeRuntime().stores;
  const { useOrganize, useCollapsedProjects, useExpandedParents, toggleProjectCollapsed } =
    stores.sidebarLayoutStore;
  const projectActions = useProjectActions();
  const managed = useManagedHost();
  const [projectsOpen, setProjectsOpen] = useState(true);
  const { clearAttention } = stores.attentionStore;
  const organize = useOrganize();
  const collapsed = useCollapsedProjects();
  const expandedToggles = useExpandedParents();
  const navigate = useNavigate();
  const now = useNow(AGE_TICK_MS);
  const statuses = useSessionStatuses(sessions);
  const index = useMemo(() => indexTree(sessions, activeSessionId), [sessions, activeSessionId]);

  const ctx: TreeContext = {
    index,
    statuses,
    activeSessionId,
    expandedToggles,
    now,
    touch,
    open: (id) => {
      onNavigate?.();
      clearAttention(id);
      navigate(routes.session(id));
    },
  };

  if (organize === "status") {
    if (index.roots.length === 0) {
      return <p className="type-meta px-2.5 py-3 text-basic-muted">No sessions yet</p>;
    }
    const remaining = new Set(index.roots);
    return (
      <div className="flex flex-col">
        {STATUS_GROUPS.map((group) => {
          const roots = [...remaining].filter((entry) =>
            group.test(statuses.rolled(entry.summary.session_id)),
          );
          for (const entry of roots) remaining.delete(entry);
          if (roots.length === 0) return null;
          return (
            <section key={group.id} aria-label={group.label} className="flex flex-col">
              <GroupLabel>{group.label}</GroupLabel>
              <GroupRows groupId={group.id} roots={roots} ctx={ctx} />
            </section>
          );
        })}
      </div>
    );
  }

  const byProject = new Map<string, ManagedSessionSummary[]>();
  const orphans: ManagedSessionSummary[] = [];
  const known = new Set(projects.map((project) => project.project_id));
  for (const entry of index.roots) {
    const projectId = entry.summary.project_id;
    // A session whose project is gone (or not loaded yet) stays reachable.
    if (!projectId || !known.has(projectId)) {
      orphans.push(entry);
      continue;
    }
    const bucket = byProject.get(projectId);
    if (bucket) bucket.push(entry);
    else byProject.set(projectId, [entry]);
  }

  return (
    <div className="flex flex-col gap-1">
      <ProjectsSectionHeader
        expanded={projectsOpen}
        touch={touch}
        createLabel={managed.isManaged ? "Add repository" : "New project"}
        onToggle={() => setProjectsOpen((open) => !open)}
        onCreate={() => {
          onNavigate?.();
          if (managed.isManaged) managed.addRepository();
          else projectActions.create();
        }}
      />
      {projectsOpen && projects.length === 0 ? (
        <p className="type-meta px-2.5 py-1 text-basic-muted">No projects yet</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {(projectsOpen ? projects : []).map((project) => {
          const roots = byProject.get(project.project_id) ?? [];
          const expanded = !collapsed.includes(project.project_id);
          const status = mostUrgent(
            roots.map((entry) => statuses.rolled(entry.summary.session_id)),
          );
          return (
            <section
              key={project.project_id}
              aria-label={project.name}
              className="flex flex-col gap-px"
            >
              <ProjectGroupHeader
                project={project}
                count={roots.length}
                expanded={expanded}
                status={status}
                touch={touch}
                onToggle={() => toggleProjectCollapsed(project.project_id)}
                onNavigate={onNavigate}
              />
              {expanded && roots.length > 0 ? (
                <GroupRows groupId={project.project_id} roots={roots} ctx={ctx} />
              ) : null}
            </section>
          );
        })}
        {orphans.length > 0 ? (
          <section aria-label="Unassigned" className="flex flex-col gap-px">
            <p className="type-body-chrome flex h-8 items-center pl-[34px] text-basic-tertiary">
              Unassigned
            </p>
            <GroupRows groupId="unassigned" roots={orphans} ctx={ctx} orphan />
          </section>
        ) : null}
      </div>
    </div>
  );
}
