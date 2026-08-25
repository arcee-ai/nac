import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AssignToProjectModal } from "@/app/components/modals/AssignToProjectModal";
import { CreateProjectModal } from "@/app/components/modals/CreateProjectModal";
import { NewChatModal } from "@/app/components/modals/NewChatModal";
import { DeleteProjectModal } from "@/app/components/modals/DeleteProjectModal";
import { RenameProjectModal } from "@/app/components/modals/RenameProjectModal";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { primarySessions, projectForSessionLocation } from "@/app/lib/projects";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { projectIdFromPath, routes, sessionIdFromPath } from "@/app/lib/routes";
import { NEW_CHAT_KEYS, NEW_PROJECT_KEYS } from "@/app/lib/shortcuts";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { pruneChatTabs } from "@/app/store/chatTabsStore";
import {
  useAssignSessionToProject,
  useProjects,
  useSessions,
  useToggleProjectPin,
} from "@/app/services/queries";
import type { ProjectRecord, SessionSummarySnapshot } from "@/app/types/api";

interface ProjectActions {
  create: () => void;
  /**
   * Files a session that belongs to no project. Asks nothing when a project
   * already covers the session's location — there is only ever the one it can
   * go to — and opens the dialog to name a new project otherwise.
   */
  assign: (summary: SessionSummarySnapshot) => void;
  rename: (project: ProjectRecord) => void;
  remove: (project: ProjectRecord) => void;
  togglePin: (project: ProjectRecord) => Promise<void>;
  /** Starts a chat inside a project, inheriting its location and defaults. */
  newChat: (projectId: string) => Promise<void>;
}

const ProjectActionsContext = createContext<ProjectActions | null>(null);

type ModalKind = "create" | "assign" | "rename" | "delete";

/**
 * Owns the project-level actions the trail, the popovers and the project cards
 * share, along with the dialogs they open, so every surface behaves the same.
 */
export function ProjectActionsProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: sessions = [], isSuccess: sessionsLoaded } = useSessions();
  const { data: projectList } = useProjects();
  const pin = useToggleProjectPin();
  const assignSession = useAssignSessionToProject();
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [session, setSession] = useState<SessionSummarySnapshot | null>(null);
  const [newChatProjectId, setNewChatProjectId] = useState<string | null>(null);

  const togglePin = pin.toggle;
  const adoptSession = assignSession.mutateAsync;

  const adopt = useCallback(
    async (target: ProjectRecord, summary: SessionSummarySnapshot) => {
      try {
        await adoptSession({
          projectId: target.project_id,
          sessionId: summary.session_id,
        });
        toast.success(`Assigned to ${target.name}`);
      } catch (error) {
        toast.error(`Failed to assign the chat: ${humanErrorText(toRunError(error))}`);
      }
    },
    [adoptSession, toast],
  );

  const newChat = useCallback(async (projectId: string) => setNewChatProjectId(projectId), []);

  const value = useMemo<ProjectActions>(
    () => ({
      create: () => setModal("create"),
      assign: (summary) => {
        // A session keeps its own working directory and the backend refuses to
        // file it anywhere else, so a project covering that location is not a
        // choice to present — it is the answer.
        const covering = projectForSessionLocation(projectList?.projects ?? [], summary);
        if (covering) {
          void adopt(covering, summary);
          return;
        }
        setSession(summary);
        setModal("assign");
      },
      rename: (target) => {
        setProject(target);
        setModal("rename");
      },
      remove: (target) => {
        setProject(target);
        setModal("delete");
      },
      togglePin: async (target) => {
        try {
          await togglePin(target);
        } catch (error) {
          toast.error(`Failed to update pin: ${errorMessage(toRunError(error))}`);
        }
      },
      newChat,
    }),
    [togglePin, newChat, toast, adopt, projectList],
  );

  // The tab strips remember how they were arranged across visits, and this is
  // the one place holding both full lists, so it is where that memory is kept
  // clear of chats and projects that have since been deleted.
  useEffect(() => {
    if (!sessionsLoaded || !projectList) return;
    pruneChatTabs(
      sessions.map((entry) => entry.summary.session_id),
      projectList.projects.map((project) => project.project_id),
    );
  }, [sessionsLoaded, sessions, projectList]);

  // Which project the screen is about, whether it was reached by its own route
  // or through one of its chats.
  const openSessionId = sessionIdFromPath(pathname);
  const openProjectId =
    projectIdFromPath(pathname) ??
    sessions.find((entry) => entry.summary.session_id === openSessionId)?.summary.project_id ??
    null;

  // "Make me a new one" is the single gesture bound to a key, and it means
  // whatever the screen is a list of: another chat inside an open project,
  // another project everywhere else. The two can never both apply, so the same
  // chord is unambiguous.
  useKeyboardShortcuts([
    {
      keys: NEW_CHAT_KEYS,
      enabled: openProjectId != null,
      onTrigger: () => {
        if (openProjectId) void newChat(openProjectId);
      },
    },
    {
      keys: NEW_PROJECT_KEYS,
      enabled: openProjectId == null,
      onTrigger: () => setModal("create"),
    },
  ]);

  const close = () => setModal(null);
  const closeNewChat = () => {
    const targetProjectId = newChatProjectId;
    setNewChatProjectId(null);
    // An empty project route has no screen behind this required first-chat
    // dialog. Closing it must therefore return to the project list rather than
    // exposing an indefinite loader. Successful creation immediately replaces
    // this navigation with the new session route.
    if (
      targetProjectId &&
      projectIdFromPath(pathname) === targetProjectId &&
      !primarySessions(sessions).some((entry) => entry.summary.project_id === targetProjectId)
    ) {
      navigate(routes.list(), { replace: true });
    }
  };

  return (
    <ProjectActionsContext.Provider value={value}>
      {children}
      <CreateProjectModal open={modal === "create"} onClose={close} />
      <NewChatModal projectId={newChatProjectId} onClose={closeNewChat} />
      <AssignToProjectModal open={modal === "assign"} onClose={close} summary={session} />
      <RenameProjectModal open={modal === "rename"} onClose={close} project={project} />
      <DeleteProjectModal open={modal === "delete"} onClose={close} project={project} />
    </ProjectActionsContext.Provider>
  );
}

export function useProjectActions(): ProjectActions {
  const ctx = useContext(ProjectActionsContext);
  if (!ctx) {
    throw new Error("useProjectActions must be used within ProjectActionsProvider");
  }
  return ctx;
}
