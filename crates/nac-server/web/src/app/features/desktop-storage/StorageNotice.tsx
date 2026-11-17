import { useSyncExternalStore } from "react";
import type { DesktopStorage } from "./adapter";

export function StorageNotice({ storage }: { storage: DesktopStorage }) {
  const state = useSyncExternalStore(storage.subscribe, storage.status, storage.status);
  return state === "unavailable" ? (
    <div
      role="status"
      className="type-body-chrome flex items-center gap-2 border-b border-danger-secondary bg-danger-primary px-4 py-2 text-basic-primary"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-[var(--f-amber)]" />
      <span className="min-w-0">
        Workspace storage is unavailable. You can keep typing and sending; recent changes may not
        restore.
      </span>
    </div>
  ) : null;
}
