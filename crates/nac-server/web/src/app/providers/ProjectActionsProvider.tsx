import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AssignToProjectModal } from "@/app/components/modals/AssignToProjectModal";
import { CreateProjectModal } from "@/app/components/modals/CreateProjectModal";
import { DeleteProjectModal } from "@/app/components/modals/DeleteProjectModal";
import { RenameProjectModal } from "@/app/components/modals/RenameProjectModal";
import { primarySessions, projectForSessionLocation } from "@/app/lib/projects";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";

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
  /**
   * Opens Home's composer pointed at a project: the one new-session flow. The
   * session is created when the user sends. `firstChat` is accepted for
   * existing callers (an empty project's redirect) and replaces the history
   * entry so Back does not bounce through the redirect.
   */
  newChat: (projectId: string, firstChat?: boolean) => Promise<void>;
}

const ProjectActionsContext = createContext<ProjectActions | null>(null);

type ModalKind = "create" | "assign" | "rename" | "delete";

/**
 * Owns the project-level actions the trail, the popovers and the project cards
 * share, along with the dialogs they open, so every surface behaves the same.
 */
export function ProjectActionsProvider({ children }: { children: React.ReactNode }) {
  const { pruneSessionNavigation } = useNativeRuntime().stores.sessionNavigationStore;

  const { pruneChatTabs } = useNativeRuntime().stores.chatTabsStore;

  const toast = useToast();
  const navigate = useNavigate();
  const sessionsQuery = useSessions();
  const sessionsLoaded = sessionsQuery.isSuccess;
  const { data: projectList } = useProjects();
  const pin = useToggleProjectPin();
  const assignSession = useAssignSessionToProject();
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
    async (projectId: string, firstChat = false) => {
      navigate(routes.newSession(projectId), {
        replace: firstChat,
        state: { focusComposer: Date.now() },
      });
    },
    [navigate],
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
    const existingSessions = sessionsQuery.data;
    if (!sessionsLoaded || !existingSessions || !projectList) return;
    // Presentation-hidden sessions still exist and keep their browser memory.
    pruneChatTabs(
      existingSessions.map((entry) => entry.summary.session_id),
      projectList.projects.map((project) => project.project_id),
    );
    pruneSessionNavigation(
      primarySessions(existingSessions).map((entry) => entry.summary.session_id),
    );
  }, [sessionsLoaded, sessionsQuery.data, projectList, pruneChatTabs, pruneSessionNavigation]);

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
