import { createContext, useContext } from "react";

import type { ManagedHostStatus } from "@/app/types/api";

export interface ManagedHostActions {
  status: ManagedHostStatus | null;
  isManaged: boolean;
  openSettings: () => void;
  addRepository: () => void;
}

export const ManagedHostContext = createContext<ManagedHostActions | null>(null);

export function useManagedHost(): ManagedHostActions {
  const context = useContext(ManagedHostContext);
  if (!context) throw new Error("useManagedHost must be used within ManagedHostProvider");
  return context;
}
