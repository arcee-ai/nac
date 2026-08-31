import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AssignToProjectModal } from "@/app/components/modals/AssignToProjectModal";
import { CreateProjectModal } from "@/app/components/modals/CreateProjectModal";
import { DeleteProjectModal } from "@/app/components/modals/DeleteProjectModal";
import { RenameProjectModal } from "@/app/components/modals/RenameProjectModal";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { newestPrimarySessionForProject, projectForSessionLocation } from "@/app/lib/projects";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { projectIdFromPath, routes, sessionIdFromPath } from "@/app/lib/routes";
import { NEW_PROJECT_KEYS } from "@/app/lib/shortcuts";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { pruneChatTabs } from "@/app/store/chatTabsStore";
import { api } from "@/app/services/api";
import {
  useAssignSessionToProject,
  useCreateSession,
  useProjects,
  useSessions,
  useToggleProjectPin,
} from "@/app/services/queries";
import type { ProjectRecord, SessionBehavior, SessionSummarySnapshot } from "@/app/types/api";

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
  /**
   * Starts a chat inside a project. `firstChat` serializes empty-project
   * admission on the server. Omit `behavior` to create the default Agent.
   */
  newChat: (projectId: string, firstChat?: boolean, behavior?: SessionBehavior) => Promise<void>;
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
  const createSession = useCreateSession();
  const createChat = createSession.mutateAsync;
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [session, setSession] = useState<SessionSummarySnapshot | null>(null);

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

  const newChat = useCallback(
    async (projectId: string, firstChat = false, behavior: SessionBehavior = "direct") => {
      try {
        if (firstChat) {
          const [projects, listed] = await Promise.all([
            api.listProjects(),
            api.listSessions({ projectId }),
          ]);
          if (!projects.projects.some((entry) => entry.project_id === projectId)) {
            navigate(routes.list(), { replace: true });
            return;
          }
          const existing = newestPrimarySessionForProject(listed, projectId);
          if (existing) {
            navigate(routes.session(existing.summary.session_id), { replace: true });
            return;
          }
        }
        const snapshot = await createChat({
          project_id: projectId,
          behavior,
          first_chat: firstChat,
        });
        const sessionId = snapshot.metadata.session_id;
        if (sessionId) navigate(routes.session(sessionId));
      } catch (error) {
        toast.error(`Failed to start a chat: ${humanErrorText(toRunError(error))}`);
        if (firstChat) navigate(routes.list(), { replace: true });
      }
    },
    [createChat, navigate, toast],
  );

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
      projectList.projects.map((entry) => entry.project_id),
    );
  }, [sessionsLoaded, sessions, projectList]);

  const openSessionId = sessionIdFromPath(pathname);
  const openProjectId =
    projectIdFromPath(pathname) ??
    sessions.find((entry) => entry.summary.session_id === openSessionId)?.summary.project_id ??
    null;

  useKeyboardShortcuts([
    {
      keys: NEW_PROJECT_KEYS,
      enabled: openProjectId == null,
      onTrigger: () => setModal("create"),
    },
  ]);

  const close = () => setModal(null);

  return (
    <ProjectActionsContext.Provider value={value}>
      {children}
      <CreateProjectModal open={modal === "create"} onClose={close} />
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
