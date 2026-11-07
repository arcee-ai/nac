import { Modal, ModalSize } from "@/app/atoms";
import { MANAGED_TABS, type ManagedTab } from "@/app/features/managed/model";
import { ManagedGitHubPanel } from "@/app/features/managed/presentation/ManagedGitHubPanel";
import { ManagedSecretsPanel } from "@/app/features/managed/presentation/ManagedSecretsPanel";
import { ManagedStatusPanel } from "@/app/features/managed/presentation/ManagedStatusPanel";

export function ManagedHostModal({
  open,
  onClose,
  tab,
  onTabChange,
  onGitHubConnected,
}: {
  open: boolean;
  onClose: () => void;
  tab: ManagedTab;
  onTabChange: (tab: ManagedTab) => void;
  onGitHubConnected?: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Managed host"
      size={ModalSize.Large}
      flush
      className="h-[min(760px,calc(100vh-32px))] max-md:[&>header_.btn-sticky]:min-h-11 max-md:[&>header_.btn-sticky]:min-w-11 max-md:[&>header_div:has(>.btn-sticky)]:min-h-11"
      bodyClassName="min-h-0"
    >
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <nav
          aria-label="Managed host sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-basic md:w-44 md:flex-col md:border-b-0 md:border-r p-2"
        >
          {MANAGED_TABS.map((item) => (
            <button
              key={item}
              type="button"
              aria-current={tab === item ? "page" : undefined}
              className={`min-h-11 shrink-0 rounded-lg px-3 py-3 text-left label-small capitalize md:py-2 ${tab === item ? "bg-elevation-level-2 text-basic-primary" : "text-basic-secondary hover:bg-elevation-level-1"}`}
              onClick={() => onTabChange(item)}
            >
              {item === "github" ? "GitHub" : item}
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6">
          {tab === "status" ? <ManagedStatusPanel /> : null}
          {tab === "github" ? <ManagedGitHubPanel onConnected={onGitHubConnected} /> : null}
          {tab === "secrets" ? <ManagedSecretsPanel /> : null}
        </div>
      </div>
    </Modal>
  );
}
