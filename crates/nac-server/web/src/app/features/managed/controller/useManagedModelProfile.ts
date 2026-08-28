import { useCallback, useMemo } from "react";

import { managedModelPick, matchesManagedModelPick } from "@/app/features/managed/model";
import { useManagedHostStatus } from "@/app/features/managed/queries";
import type { CatalogPick } from "@/app/lib/catalog";

export function useManagedModelProfile() {
  const status = useManagedHostStatus().data ?? null;
  const defaultPick = useMemo<CatalogPick | null>(() => managedModelPick(status), [status]);
  const matches = useCallback(
    (pick: CatalogPick | null) => matchesManagedModelPick(status, pick),
    [status],
  );

  return {
    defaultPick,
    matches,
    credentialReady: Boolean(status?.model_ready),
  };
}
