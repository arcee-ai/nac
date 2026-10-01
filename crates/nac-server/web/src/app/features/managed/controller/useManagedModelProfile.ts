import { useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo } from "react";

import { readAsync } from "@/app/effect/remote";
import { managedModelPick, matchesManagedModelPick } from "@/app/features/managed/model";
import { managedHostStatusAtom } from "@/app/features/managed/queries";
import type { CatalogPick } from "@/app/lib/catalog";

export function useManagedModelProfile() {
  const host = readAsync(useAtomValue(managedHostStatusAtom));
  const status = host.data ?? null;
  const defaultPick = useMemo<CatalogPick | null>(() => managedModelPick(status), [status]);
  const matches = useCallback(
    (pick: CatalogPick | null) => matchesManagedModelPick(status, pick),
    [status],
  );

  return {
    defaultPick,
    configured: defaultPick !== null,
    matches,
    credentialReady: Boolean(status?.model_ready),
    initializing: host.isPending,
  };
}
