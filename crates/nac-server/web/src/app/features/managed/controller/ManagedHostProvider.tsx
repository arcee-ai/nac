import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useManagedHostStatus } from "@/app/features/managed/queries";
import {
  ManagedHostContext,
  type ManagedHostActions,
} from "@/app/features/managed/controller/useManagedHost";
import type { ManagedTab } from "@/app/features/managed/model";
import {
  ManagedSettingsContext,
  type ManagedSettingsState,
} from "@/app/features/managed/presentation/managedSettingsContext";
import { ManagedRepositoryModal } from "@/app/features/managed/presentation/ManagedRepositoryModal";
import { routes } from "@/app/lib/routes";

/**
 * Managed host product state. Host settings (status, GitHub device auth,
 * secrets) live at Settings › Managed host; "Add repository" stays a dialog and
 * may detour through GitHub authorization before reopening itself.
 */
export function ManagedHostProvider({ children }: { children: React.ReactNode }) {
  const statusQuery = useManagedHostStatus();
  const navigate = useNavigate();
  const [settingsTab, setSettingsTab] = useState<ManagedTab>("status");
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [resumeRepositoryAfterConnect, setResumeRepositoryAfterConnect] = useState(false);
  const status = statusQuery.data ?? null;

  const openSettings = useCallback(() => {
    setResumeRepositoryAfterConnect(false);
    setSettingsTab("status");
    navigate(routes.settings("managed"));
  }, [navigate]);
  const authorizeForRepository = useCallback(() => {
    setRepositoryOpen(false);
    setResumeRepositoryAfterConnect(true);
    setSettingsTab("github");
    navigate(routes.settings("managed"));
  }, [navigate]);
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
    setRepositoryOpen(true);
  }, [resumeRepositoryAfterConnect]);
  const selectTab = useCallback((tab: ManagedTab) => {
    // Picking another part of the page by hand ends the repository detour.
    setResumeRepositoryAfterConnect(false);
    setSettingsTab(tab);
  }, []);
  const value = useMemo<ManagedHostActions>(
    () => ({
      status,
      isManaged: status?.managed === true,
      openSettings,
      addRepository,
    }),
    [addRepository, openSettings, status],
  );
  const settings = useMemo<ManagedSettingsState>(
    () => ({ tab: settingsTab, setTab: selectTab, onGitHubConnected: handleGitHubConnected }),
    [handleGitHubConnected, selectTab, settingsTab],
  );

  return (
    <ManagedHostContext.Provider value={value}>
      <ManagedSettingsContext.Provider value={settings}>
        {children}
        {repositoryOpen ? (
          <ManagedRepositoryModal
            open
            onClose={() => setRepositoryOpen(false)}
            onConnect={authorizeForRepository}
          />
        ) : null}
      </ManagedSettingsContext.Provider>
    </ManagedHostContext.Provider>
  );
}
