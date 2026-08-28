import { useCallback, useMemo } from "react";

import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { managedModelPick, matchesManagedModelPick } from "@/app/features/managed/model";
import type { CatalogPick } from "@/app/lib/catalog";

export function useManagedModelProfile() {
  const { status } = useManagedHost();
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
