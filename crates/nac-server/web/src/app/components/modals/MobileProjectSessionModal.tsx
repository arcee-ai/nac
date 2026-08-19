import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Modal,
  SessionAvatar,
  StickyButton,
  StickyInput,
  StickyInputVariant,
} from "@/app/atoms";
import { ChatSessionList } from "@/app/components/projects/ChatSessionList";
import { ProjectsList } from "@/app/components/projects/ProjectsList";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import {
  findProject,
  orphanSessions,
  projectForSessionLocation,
  projectListItems,
  type ProjectListItem,
} from "@/app/lib/projects";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  useAssignSessionToProject,
  useCreateProject,
  useProjects,
  useSessions,
} from "@/app/services/queries";
import type { ManagedSessionSummary, SessionSummarySnapshot } from "@/app/types/api";

type Tab = "assign" | "chats" | "projects";

function matchesItem(
  item: ProjectListItem,
  needle: string,
  sessionTitle: (summary: SessionSummarySnapshot) => string,
): boolean {
  if (item.kind === "project") {
    return `${item.entry.project.name} ${item.entry.project.cwd}`.toLowerCase().includes(needle);
  }
  return `${sessionTitle(item.session.summary)} ${item.session.summary.cwd}`
    .toLowerCase()
    .includes(needle);
}

/**
 * The phone's navigator: a full-screen modal box (not a popover sheet) holding
 * the chat list, the project list, and — for an unassigned chat — the assign
 * flow, switched by the floating bar at the bottom.
 */
export function MobileProjectSessionModal({
  open,
  onClose,
  projectId,
  sessions,
  activeSessionId,
  summary,
}: {
  open: boolean;
  onClose: () => void;
  /** Null when the open chat belongs to no project, or none is open. */
  projectId: string | null;
  /** The open project's chats; empty when there is no project. */
  sessions: ManagedSessionSummary[];
  activeSessionId: string | null;
  summary: SessionSummarySnapshot | null;
}) {
  const navigate = useNavigate();
  const actions = useProjectActions();
  const sessionActions = useSessionActions();
  const sessionTitle = useSessionTitle();
  const { data: projectList } = useProjects();
  const { data: allSessions = [] } = useSessions();
  const orphan = summary != null && !projectId;
  const project = findProject(projectList?.projects ?? [], projectId);

  const [tab, setTab] = useState<Tab>(projectId || summary ? "chats" : "projects");
  const [query, setQuery] = useState("");
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setTab(projectId || summary ? "chats" : "projects");
      setQuery("");
    }
    wasOpen.current = open;
  }, [open, projectId, summary]);

  const title = summary ? sessionTitle(summary) : (project?.name ?? "Projects");
  const subtitle = summary ? (project?.name ?? "Not assigned") : null;

  const chatSessions = projectId ? sessions : orphanSessions(allSessions);
  const visibleChats = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chatSessions;
    return chatSessions.filter((entry) =>
      sessionTitle(entry.summary).toLowerCase().includes(needle),
    );
  }, [chatSessions, query, sessionTitle]);

  const projectItems = useMemo(
    () => projectListItems(projectList?.projects ?? [], allSessions),
    [projectList, allSessions],
  );
  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projectItems;
    return projectItems.filter((item) => matchesItem(item, needle, sessionTitle));
  }, [projectItems, query, sessionTitle]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setQuery("");
  };

  const closeAnd = (run: () => void) => {
    onClose();
    run();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex flex-col min-w-0 justify-center">
          <span className="truncate">{title}</span>
          {subtitle ? (
            <span
              className={cn(
                "text-micro font-normal truncate",
                orphan ? "text-danger-primary" : "text-basic-muted",
              )}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
      }
      bodyClassName="!p-0 relative flex flex-col overflow-hidden"
    >
      {tab !== "assign" ? (
        <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-3 px-2 py-4">
          <StickyInput
            className="flex-1 min-w-0"
            variant={StickyInputVariant.Search}
            placeholder={tab === "chats" ? "Search chat sessions..." : "Search projects..."}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            aria-label={tab === "chats" ? "Search chat sessions" : "Search projects"}
          />
          {tab === "chats" && projectId ? (
            <StickyButton
              variant={ButtonVariant.Secondary}
              content={ButtonContent.Icon}
              aria-label="New chat"
              onClick={() => closeAnd(() => void actions.newChat(projectId))}
            >
              <Icon iconName={IconName.Add} />
            </StickyButton>
          ) : null}
          {tab === "projects" ? (
            <>
              <StickyButton
                variant={ButtonVariant.Secondary}
                content={ButtonContent.Icon}
                aria-label="New project"
                onClick={() => closeAnd(actions.create)}
              >
                <Icon iconName={IconName.Add} />
              </StickyButton>
              <StickyButton
                variant={ButtonVariant.Secondary}
                content={ButtonContent.Icon}
                aria-label="All projects"
                onClick={() => closeAnd(() => navigate(routes.list()))}
              >
                <Icon iconName={IconName.Grid} />
              </StickyButton>
            </>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
          tab === "assign" ? "px-4 py-4" : "px-2 pt-[72px] pb-[96px]",
        )}
      >
        {tab === "assign" && summary ? (
          <AssignPanel summary={summary} onAssigned={onClose} />
        ) : tab === "chats" ? (
          <ChatSessionList
            sessions={visibleChats}
            activeSessionId={activeSessionId}
            isMobile
            emptyLabel={query.trim() ? "No matching chats" : "No chats yet"}
            onOpen={(entry) => closeAnd(() => navigate(routes.session(entry.summary.session_id)))}
            onPin={(entry) => void sessionActions.togglePin(entry.summary)}
            onRename={(entry) => closeAnd(() => sessionActions.rename(entry.summary))}
            onDelete={(entry) => closeAnd(() => sessionActions.remove(entry.summary))}
          />
        ) : (
          <ProjectsList
            items={visibleProjects}
            activeId={projectId ?? activeSessionId}
            isMobile
            emptyLabel={query.trim() ? "No matching projects" : "No projects yet"}
            onOpenProject={(id) => closeAnd(() => navigate(routes.project(id)))}
            onOpenSession={(id) => closeAnd(() => navigate(routes.session(id)))}
            renderActions={(item) => {
              if (item.kind === "project") {
                const { project: row } = item.entry;
                return (
                  <>
                    <RowIcon
                      label={`Rename ${row.name}`}
                      icon={IconName.Edit}
                      onClick={() => closeAnd(() => actions.rename(row))}
                    />
                    <RowIcon
                      label={`Delete ${row.name}`}
                      icon={IconName.Trash}
                      variant={ButtonVariant.GhostDestructive}
                      onClick={() => closeAnd(() => actions.remove(row))}
                    />
                  </>
                );
              }
              const { summary: row } = item.session;
              const name = sessionTitle(row);
              return (
                <>
                  <RowIcon
                    label={`Rename ${name}`}
                    icon={IconName.Edit}
                    onClick={() => closeAnd(() => sessionActions.rename(row))}
                  />
                  <RowIcon
                    label={`Delete ${name}`}
                    icon={IconName.Trash}
                    variant={ButtonVariant.GhostDestructive}
                    onClick={() => closeAnd(() => sessionActions.remove(row))}
                  />
                </>
              );
            }}
          />
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 px-2 py-4 pointer-events-none">
        <div
          className="flex items-center gap-1 w-full p-[2px] rounded-[18px] bg-elevation-level-3 shadow-2xl overflow-hidden pointer-events-auto"
          role="tablist"
        >
          {orphan ? (
            <ModalTab
              active={tab === "assign"}
              icon={IconName.FolderOpen}
              label="Assign"
              onClick={() => switchTab("assign")}
            />
          ) : null}
          <ModalTab
            active={tab === "chats"}
            icon={IconName.Chat}
            label="Chat sessions"
            onClick={() => switchTab("chats")}
          />
          <ModalTab
            active={tab === "projects"}
            icon={IconName.Folder}
            label="Projects"
            onClick={() => switchTab("projects")}
          />
        </div>
      </div>
    </Modal>
  );
}

function ModalTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        "flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]",
        active ? "btn-primary" : "btn-ghost",
      )}
      onClick={onClick}
    >
      <Icon iconName={icon} size={28} />
      <span
        className={cn(
          "label-micro font-bold truncate max-w-full",
          active ? null : "text-basic-primary",
        )}
      >
        {label}
      </span>
    </button>
  );
}

function RowIcon({
  label,
  icon,
  onClick,
  variant = ButtonVariant.Ghost,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  variant?: ButtonVariant;
}) {
  return (
    <Button
      variant={variant}
      size={ButtonSize.Small}
      content={ButtonContent.Icon}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon iconName={icon} />
    </Button>
  );
}

/**
 * Files the open unassigned chat under the project that already covers its
 * working directory, or names a new one when none does.
 */
function AssignPanel({
  summary,
  onAssigned,
}: {
  summary: SessionSummarySnapshot;
  onAssigned: () => void;
}) {
  const toast = useToast();
  const { data: projectList } = useProjects();
  const assign = useAssignSessionToProject();
  const createProject = useCreateProject();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const existing = useMemo(
    () => projectForSessionLocation(projectList?.projects ?? [], summary),
    [projectList, summary],
  );
  const busy = assign.isPending || createProject.isPending;

  const submit = async () => {
    if (busy) return;
    setError(null);
    try {
      const project =
        existing ??
        (await createProject.mutateAsync({
          name: name.trim() || null,
          cwd: summary.cwd,
          ssh_host: summary.ssh_host ?? null,
        }));
      await assign.mutateAsync({
        projectId: project.project_id,
        sessionId: summary.session_id,
      });
      toast.success(`Assigned to ${project.name}`);
      onAssigned();
    } catch (assignError) {
      setError(humanErrorText(toRunError(assignError)));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-medium text-basic-secondary">
        This chat session will be assigned to the project (according to its working directory):
      </p>
      {existing ? (
        <div className="flex items-center gap-4 min-w-0">
          <SessionAvatar id={existing.project_id} size={40} className="rounded-[4px] shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="header-md truncate">{existing.name}</span>
            <span className="code-micro text-basic-tertiary truncate">{existing.cwd}</span>
          </div>
        </div>
      ) : (
        <Input
          label="Project name"
          inputSize={InputSize.Large}
          placeholder="Taken from the git remote"
          value={name}
          onChange={(event) => {
            setError(null);
            setName(event.target.value);
          }}
        />
      )}
      {error ? <p className="text-error-primary text-micro">{error}</p> : null}
      <Button
        variant={ButtonVariant.Primary}
        size={ButtonSize.Large}
        content={ButtonContent.Text}
        className="w-full"
        onClick={() => void submit()}
        loading={busy}
      >
        {existing ? "Assign" : "Create and assign"}
      </Button>
    </div>
  );
}
