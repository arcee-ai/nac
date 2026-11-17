import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { IconName } from "@/app/atoms";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { useProductNavigationOwner } from "@/app/features/product-context/context";
import { SETTINGS_SECTION_META } from "@/app/features/settings/sections";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { isActiveRun, parseStoreTime } from "@/app/lib/format";
import { projectIdFromPath, routes, sessionIdFromPath, type SessionPanel } from "@/app/lib/routes";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import { sessionStatus, type SessionStatus } from "@/app/lib/sessionStatus";
import { NEW_SESSION_KEYS, NEXT_NEEDS_YOU_KEYS, TOGGLE_SIDEBAR_KEYS } from "@/app/lib/shortcuts";
import { useInbox } from "@/app/features/inbox/inboxContext";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { THEMES, useTheme, type Theme } from "@/app/providers/ThemeProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useProjects, useSessionSnapshot, useVisibleSessions } from "@/app/services/queries";
import { setTranscriptDensity, useTranscriptDensity } from "@/app/store/transcriptDensityStore";
import type { ManagedSessionSummary } from "@/app/types/api";
import { requestSidebarToggle, useSidebarToggleAvailable } from "./paletteSignal";

export type PaletteGroup =
  | "Sessions"
  | "Session panels"
  | "Actions"
  | "Projects"
  | "New session in…"
  | "Settings"
  | "Theme"
  | "Transcript";

/** Group order in the list. Empty-query lists show a few of the long groups. */
export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  "Sessions",
  "Session panels",
  "Actions",
  "Projects",
  "New session in…",
  "Settings",
  "Theme",
  "Transcript",
];

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Second, quieter line or trailing context (project, "Subagent of …"). */
  detail?: string;
  /** Extra words the filter also matches. */
  keywords?: string;
  icon?: IconName;
  status?: SessionStatus;
  shortcut?: string[];
  /** Marks the current choice (theme, density, current session). */
  current?: boolean;
  /** Nested under a parent session. */
  child?: boolean;
  /** Recency for sessions; higher is newer. */
  recency?: number;
  run(): void;
}

const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
const THEME_ICON: Record<Theme, IconName> = {
  system: IconName.Desktop,
  light: IconName.Sun,
  dark: IconName.Moon,
};

const PANELS: readonly { panel: SessionPanel; label: string; icon: IconName }[] = [
  { panel: "files", label: "Changes", icon: IconName.Code },
  { panel: "delegated", label: "Subagents", icon: IconName.People },
  { panel: "terminal", label: "Terminal", icon: IconName.Terminal },
  { panel: "insights", label: "Insights", icon: IconName.Activity },
  { panel: "history", label: "History", icon: IconName.History },
];

function statusOf(
  entry: ManagedSessionSummary,
  running: ReadonlySet<string>,
  flagged: Readonly<Record<string, boolean>>,
  childrenRunning: ReadonlySet<string>,
): SessionStatus {
  const id = entry.summary.session_id;
  return sessionStatus({
    running: running.has(id),
    childrenRunning: childrenRunning.has(id),
    attention: Boolean(flagged[id]),
  });
}

/**
 * Everything the ⌘K palette can do, built from the same queries, stores and
 * owners the rest of the app uses. Nothing here runs on its own: each item's
 * `run` is called only when the user picks it.
 */
export function usePaletteCommands(): PaletteItem[] {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const runtime = useNativeRuntime();
  const flagged = runtime.stores.attentionStore.attentionStore.useStore((state) => state.flagged);
  const { data: sessions = [] } = useVisibleSessions();
  const { data: projectList } = useProjects();
  const title = useSessionTitle();
  const managed = useManagedHost();
  const projectActions = useProjectActions();
  const inbox = useInbox();
  const needsYouCount = inbox.model.badge;
  const openNextNeedsYou = inbox.openNext;
  const settings = useProductNavigationOwner();
  const { theme = "system", setTheme } = useTheme();
  const density = useTranscriptDensity();
  const sidebarAvailable = useSidebarToggleAvailable();

  const sessionId = sessionIdFromPath(pathname);
  const current = sessions.find((entry) => entry.summary.session_id === sessionId);
  // Passive cache read: the palette never attaches or recovers a session.
  const { data: snapshot } = useSessionSnapshot(sessionId, { enabled: false });
  const projectId = projectIdFromPath(pathname) ?? current?.summary.project_id ?? null;

  return useMemo(() => {
    const items: PaletteItem[] = [];
    const projects = projectList?.projects ?? [];
    const projectName = new Map(projects.map((project) => [project.project_id, project.name]));
    const byId = new Map(sessions.map((entry) => [entry.summary.session_id, entry]));
    const running = new Set(
      sessions.filter((entry) => isActiveRun(entry.active_run)).map((e) => e.summary.session_id),
    );
    const childrenRunning = new Set<string>();
    for (const entry of sessions) {
      if (entry.lineage && running.has(entry.summary.session_id)) {
        childrenRunning.add(entry.lineage.parent_session_id);
      }
    }

    // Sessions, children included, newest activity first.
    for (const entry of sessions) {
      const id = entry.summary.session_id;
      const parent = entry.lineage ? byId.get(entry.lineage.parent_session_id) : undefined;
      const project = entry.summary.project_id
        ? projectName.get(entry.summary.project_id)
        : undefined;
      const label = title(entry.summary);
      items.push({
        id: `session:${id}`,
        group: "Sessions",
        label,
        detail: entry.lineage
          ? `Subagent of ${parent ? title(parent.summary) : "another session"}`
          : project,
        keywords: [project, entry.summary.last_user_prompt?.slice(0, 120)]
          .filter(Boolean)
          .join(" "),
        status: statusOf(entry, running, flagged, childrenRunning),
        current: id === sessionId,
        child: Boolean(entry.lineage),
        recency: parseStoreTime(entry.summary.updated_at),
        run: () => navigate(routes.session(id)),
      });
    }
    // Only sessions are in the list so far.
    items.sort((left, right) => (right.recency ?? 0) - (left.recency ?? 0));

    // The open session's panels, as its policy allows on this screen size.
    if (sessionId && current) {
      const policy = sessionPanelPolicy(current.summary.behavior, snapshot?.lineage?.kind);
      const allowed = isMobile ? policy.mobilePanels : policy.widePanels;
      for (const { panel, label, icon } of PANELS) {
        if (!allowed.includes(panel)) continue;
        items.push({
          id: `panel:${panel}`,
          group: "Session panels",
          label: `Show ${label}`,
          keywords: `${label} panel drawer`,
          icon,
          run: () => {
            navigate(routes.session(sessionId, panel));
            runtime.stores.sessionLayoutStore.revealSidePanel(isMobile);
          },
        });
      }
    }

    const here = projectId ? projectName.get(projectId) : undefined;
    if (needsYouCount > 0) {
      items.push({
        id: "action:next-needs-you",
        group: "Actions",
        label: "Next session that needs you",
        detail: `${needsYouCount} waiting`,
        keywords: "inbox approval question attention waiting",
        icon: IconName.Flag,
        shortcut: NEXT_NEEDS_YOU_KEYS,
        run: openNextNeedsYou,
      });
    }
    items.push({
      id: "action:new-session",
      group: "Actions",
      label: "New session",
      detail: here,
      icon: IconName.AddChat,
      shortcut: NEW_SESSION_KEYS,
      run: () => navigate(routes.newSession(projectId)),
    });
    items.push({
      id: "action:new-project",
      group: "Actions",
      label: managed.isManaged ? "Add repository" : "New project",
      keywords: "create project repository folder",
      icon: IconName.Folder,
      run: () => (managed.isManaged ? managed.addRepository() : projectActions.create()),
    });
    if (sidebarAvailable && !isMobile) {
      items.push({
        id: "action:sidebar",
        group: "Actions",
        label: "Toggle sidebar",
        icon: IconName.LeftSidebar,
        shortcut: TOGGLE_SIDEBAR_KEYS,
        run: () => void requestSidebarToggle(),
      });
    }
    items.push({
      id: "action:interval-tasks",
      group: "Actions",
      label: "Interval tasks",
      detail: here,
      keywords: "schedules heartbeats recurring",
      icon: IconName.Calendar,
      run: () => navigate(routes.taskSchedules(projectId ?? undefined)),
    });
    items.push({
      id: "action:home",
      group: "Actions",
      label: "Go Home",
      keywords: "projects list start",
      icon: IconName.Home,
      run: () => navigate(routes.list()),
    });

    for (const project of projects) {
      items.push({
        id: `project:${project.project_id}`,
        group: "Projects",
        label: project.name,
        icon: IconName.Folder,
        run: () => navigate(routes.project(project.project_id)),
      });
      items.push({
        id: `new-in:${project.project_id}`,
        group: "New session in…",
        label: `New session in ${project.name}`,
        keywords: "start create",
        icon: IconName.AddChat,
        run: () => navigate(routes.newSession(project.project_id)),
      });
    }

    for (const meta of SETTINGS_SECTION_META) {
      if (meta.id === "managed" && !managed.isManaged) continue;
      items.push({
        id: `settings:${meta.id}`,
        group: "Settings",
        label: meta.label,
        keywords: `settings preferences ${meta.rows.join(" ")}`,
        icon: meta.icon,
        run: () =>
          meta.id === "capabilities" ? settings.inspect() : settings.openSettings(meta.id),
      });
    }

    if (setTheme) {
      for (const option of THEMES) {
        items.push({
          id: `theme:${option}`,
          group: "Theme",
          label: `${THEME_LABEL[option]} theme`,
          keywords: `appearance mode ${option === "dark" ? "night" : ""}`,
          icon: THEME_ICON[option],
          current: theme === option,
          run: () => setTheme(option),
        });
      }
    }
    for (const option of ["compact", "detailed"] as const) {
      items.push({
        id: `density:${option}`,
        group: "Transcript",
        label: option === "compact" ? "Compact transcript" : "Detailed transcript",
        keywords: "density tools reasoning steps",
        icon: option === "compact" ? IconName.List : IconName.Layers,
        current: density === option,
        run: () => setTranscriptDensity(option),
      });
    }
    return items;
  }, [
    current,
    density,
    flagged,
    isMobile,
    managed,
    navigate,
    needsYouCount,
    openNextNeedsYou,
    projectActions,
    projectId,
    projectList,
    runtime,
    sessionId,
    sessions,
    settings,
    setTheme,
    sidebarAvailable,
    snapshot?.lineage?.kind,
    theme,
    title,
  ]);
}
