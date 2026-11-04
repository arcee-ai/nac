import { useSyncExternalStore } from "react";
import type { DesktopStorage } from "./adapter";

export function StorageNotice({ storage }: { storage: DesktopStorage }) {
  const state = useSyncExternalStore(storage.subscribe, storage.status, storage.status);
  return state === "unavailable" ? (
    <div role="status" className="bg-elevation-level-2 px-4 py-2 text-small text-basic-secondary">
      Workspace storage is unavailable. You can keep typing and sending; recent changes may not
      restore.
    </div>
  ) : null;
}
