import { useCallback, useMemo, useState } from "react";

import { useManagedHostStatus } from "@/app/features/managed/queries";
import {
  ManagedHostContext,
  type ManagedHostActions,
} from "@/app/features/managed/controller/useManagedHost";
import type { ManagedTab } from "@/app/features/managed/model";
import { ManagedHostModal } from "@/app/features/managed/presentation/ManagedHostModal";
import { ManagedRepositoryModal } from "@/app/features/managed/presentation/ManagedRepositoryModal";

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
