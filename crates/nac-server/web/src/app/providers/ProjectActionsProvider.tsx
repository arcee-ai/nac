import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AssignToProjectModal } from "@/app/components/modals/AssignToProjectModal";
import { CreateProjectModal } from "@/app/components/modals/CreateProjectModal";
import { DeleteProjectModal } from "@/app/components/modals/DeleteProjectModal";
import { RenameProjectModal } from "@/app/components/modals/RenameProjectModal";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { NEW_PROJECT_KEYS } from "@/app/lib/shortcuts";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useCreateSession, useToggleProjectPin } from "@/app/services/queries";
import type { ProjectRecord, SessionSummarySnapshot } from "@/app/types/api";

interface ProjectActions {
  create: () => void;
  /** Adopts a session that belongs to no project. */
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
  const navigate = useNavigate();
  const pin = useToggleProjectPin();
  const createSession = useCreateSession();
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [session, setSession] = useState<SessionSummarySnapshot | null>(null);

  const togglePin = pin.toggle;
  const startSession = createSession.mutateAsync;

  const newChat = useCallback(
    async (projectId: string) => {
      try {
        // Everything else is the project's: sending a cwd or model here would
        // either be rejected or quietly diverge from its siblings.
        const snapshot = await startSession({ project_id: projectId });
        const newId = snapshot.metadata.session_id;
        if (newId) navigate(routes.session(newId));
      } catch (error) {
        toast.error(`Failed to start a chat: ${humanErrorText(toRunError(error))}`);
      }
    },
    [startSession, navigate, toast],
  );

  const value = useMemo<ProjectActions>(
    () => ({
      create: () => setModal("create"),
      assign: (summary) => {
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
    [togglePin, newChat, toast],
  );

  // Creating a project is the one action reachable from anywhere, so it is the
  // one bound to a key; the rest all need a project or chat picked out first.
  useKeyboardShortcuts(
    useMemo(() => [{ keys: NEW_PROJECT_KEYS, onTrigger: () => setModal("create") }], []),
  );

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
