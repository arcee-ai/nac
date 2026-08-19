import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

import { DeleteModal } from "@/app/components/modals/DeleteModal";
import { RenameModal } from "@/app/components/modals/RenameModal";
import { SettingsModal } from "@/app/components/modals/SettingsModal";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useCancelRun, useTogglePin } from "@/app/services/queries";
import { pushLocalEvent } from "@/app/store/runtimeStore";
import type { SessionSummarySnapshot } from "@/app/types/api";
import { toRunError } from "@/app/lib/providerError";

/**
 * Actions on a single chat. Creating one is a project-level action, because a
 * chat is always started inside a project — see `ProjectActionsProvider`.
 */
interface SessionActions {
  rename: (summary: SessionSummarySnapshot) => void;
  remove: (summary: SessionSummarySnapshot) => void;
  settings: (sessionId: string) => void;
  togglePin: (summary: SessionSummarySnapshot) => Promise<void>;
  stopRun: (summary: SessionSummarySnapshot) => Promise<void>;
}

const SessionActionsContext = createContext<SessionActions | null>(null);

type ModalKind = "rename" | "delete" | "settings";

/**
 * Owns the actions a session card and the inspector header share, along with
 * the two small modals they open, so both surfaces behave identically.
 */
export function SessionActionsProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const pin = useTogglePin();
  const cancelRun = useCancelRun();
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [target, setTarget] = useState<SessionSummarySnapshot | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  const openModal = useCallback(
    (kind: ModalKind) => (summary: SessionSummarySnapshot) => {
      setTarget(summary);
      setModal(kind);
    },
    [],
  );

  const togglePin = pin.toggle;
  const value = useMemo<SessionActions>(
    () => ({
      rename: openModal("rename"),
      remove: openModal("delete"),
      settings: (sessionId) => {
        setSettingsId(sessionId);
        setModal("settings");
      },
      togglePin: async (summary) => {
        try {
          await togglePin(summary);
        } catch (error) {
          toast.error(`Failed to update pin: ${errorMessage(toRunError(error))}`);
        }
      },
      stopRun: async (summary) => {
        try {
          await cancelRun.mutateAsync(summary.session_id);
          pushLocalEvent("run", "■ run cancellation requested");
          toast.success("Run cancellation requested");
        } catch (error) {
          toast.error(`Failed to stop run: ${errorMessage(toRunError(error))}`);
        }
      },
    }),
    [openModal, togglePin, cancelRun, toast],
  );

  const close = () => setModal(null);

  return (
    <SessionActionsContext.Provider value={value}>
      {children}
      <RenameModal open={modal === "rename"} onClose={close} summary={target} />
      <DeleteModal open={modal === "delete"} onClose={close} summary={target} />
      <SettingsModal open={modal === "settings"} id={settingsId} onClose={close} />
    </SessionActionsContext.Provider>
  );
}

export function useSessionActions(): SessionActions {
  const ctx = useContext(SessionActionsContext);
  if (!ctx) {
    throw new Error("useSessionActions must be used within SessionActionsProvider");
  }
  return ctx;
}
