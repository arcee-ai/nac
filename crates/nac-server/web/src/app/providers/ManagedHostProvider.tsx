import { createContext, useContext, useMemo, useState } from "react";

import { ManagedHostModal } from "@/app/components/modals/ManagedHostModal";
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
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const status = statusQuery.data ?? null;
  const value = useMemo<ManagedHostActions>(
    () => ({
      status,
      isManaged: status?.managed === true,
      openSettings: () => setSettingsOpen(true),
      addRepository: () => setRepositoryOpen(true),
    }),
    [status],
  );

  return (
    <ManagedHostContext.Provider value={value}>
      {children}
      <ManagedHostModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {repositoryOpen ? (
        <ManagedRepositoryModal
          open
          onClose={() => setRepositoryOpen(false)}
          onConnect={() => {
            setRepositoryOpen(false);
            setSettingsOpen(true);
          }}
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
