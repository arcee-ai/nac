import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { ManagedHostModal, type ManagedTab } from "@/app/components/modals/ManagedHostModal";
import { ManagedRepositoryModal } from "@/app/components/modals/ManagedRepositoryModal";
import { useManagedHostStatus } from "@/app/services/queries";
import type { ManagedHostStatus } from "@/app/types/api";

interface ManagedHostActions {
  status: ManagedHostStatus | null;
  isManaged: boolean;
  openSettings: () => void;
  addRepository: () => void;
}

const ManagedHostContext = createContext<ManagedHostActions | null>(null);

export function ManagedHostProvider({ children }: { children: React.ReactNode }) {
  const statusQuery = useManagedHostStatus();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<ManagedTab>("status");
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [resumeRepositoryAfterConnect, setResumeRepositoryAfterConnect] = useState(false);
  const status = statusQuery.data ?? null;

  const openSettings = useCallback(() => {
    setResumeRepositoryAfterConnect(false);
    setSettingsTab("status");
    setSettingsOpen(true);
  }, []);
  const authorizeForRepository = useCallback(() => {
    setRepositoryOpen(false);
    setResumeRepositoryAfterConnect(true);
    setSettingsTab("github");
    setSettingsOpen(true);
  }, []);
  const addRepository = useCallback(() => {
    if (status?.github_status === "connected") {
      setRepositoryOpen(true);
      return;
    }
    authorizeForRepository();
  }, [authorizeForRepository, status?.github_status]);
  const handleGitHubConnected = useCallback(() => {
    if (!resumeRepositoryAfterConnect) return;
    setResumeRepositoryAfterConnect(false);
    setSettingsOpen(false);
    setRepositoryOpen(true);
  }, [resumeRepositoryAfterConnect]);
  const value = useMemo<ManagedHostActions>(
    () => ({
      status,
      isManaged: status?.managed === true,
      openSettings,
      addRepository,
    }),
    [addRepository, openSettings, status],
  );

  return (
    <ManagedHostContext.Provider value={value}>
      {children}
      <ManagedHostModal
        open={settingsOpen}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        onClose={() => {
          setSettingsOpen(false);
          setResumeRepositoryAfterConnect(false);
        }}
        onGitHubConnected={handleGitHubConnected}
      />
      {repositoryOpen ? (
        <ManagedRepositoryModal
          open
          onClose={() => setRepositoryOpen(false)}
          onConnect={authorizeForRepository}
        />
      ) : null}
    </ManagedHostContext.Provider>
  );
}

export function useManagedHost(): ManagedHostActions {
  const context = useContext(ManagedHostContext);
  if (!context) throw new Error("useManagedHost must be used within ManagedHostProvider");
  return context;
}
