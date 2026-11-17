import { useState } from "react";

import { MANAGED_TABS, type ManagedTab } from "@/app/features/managed/model";
import { ManagedGitHubPanel } from "@/app/features/managed/presentation/ManagedGitHubPanel";
import { ManagedSecretsPanel } from "@/app/features/managed/presentation/ManagedSecretsPanel";
import { ManagedStatusPanel } from "@/app/features/managed/presentation/ManagedStatusPanel";
import { useManagedSettings } from "@/app/features/managed/presentation/managedSettingsContext";
import { cn } from "@/app/lib/cn";

const TAB_LABEL: Record<ManagedTab, string> = {
  status: "Status",
  github: "GitHub",
  secrets: "Secrets",
};

/**
 * Settings › Managed host: the host's status, GitHub device authorization and
 * host secrets, one segment at a time. The panels keep their own queries; only
 * the frame changed from a dialog to the page.
 */
export function ManagedHostSettings() {
  const shared = useManagedSettings();
  const [localTab, setLocalTab] = useState<ManagedTab>("status");
  const tab = shared?.tab ?? localTab;
  const setTab = shared?.setTab ?? setLocalTab;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <nav
        aria-label="Managed host sections"
        className="inline-flex max-w-full self-start overflow-x-auto rounded-pill bg-[var(--f-wash-2)] p-0.5"
      >
        {MANAGED_TABS.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={tab === item ? "page" : undefined}
            className={cn(
              "type-label inline-flex h-7 shrink-0 items-center rounded-pill px-3.5 transition-colors duration-150 ease-out max-md:h-11 max-md:px-4",
              tab === item
                ? "bg-elevation-level-1 text-basic-primary shadow-md"
                : "text-basic-tertiary hover:text-basic-primary",
            )}
            onClick={() => setTab(item)}
          >
            {TAB_LABEL[item]}
          </button>
        ))}
      </nav>
      <div className="min-w-0 rounded-card border border-tertiary bg-elevation-level-1 p-4 md:p-6">
        {tab === "status" ? <ManagedStatusPanel /> : null}
        {tab === "github" ? <ManagedGitHubPanel onConnected={shared?.onGitHubConnected} /> : null}
        {tab === "secrets" ? <ManagedSecretsPanel /> : null}
      </div>
    </div>
  );
}
