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
      className="h-[min(760px,calc(100vh-32px))]"
    >
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-basic md:w-44 md:flex-col md:border-b-0 md:border-r p-2">
          {MANAGED_TABS.map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded px-3 py-2 text-left label-small capitalize ${tab === item ? "bg-elevation-level-2 text-basic-primary" : "text-basic-tertiary"}`}
              onClick={() => onTabChange(item)}
            >
              {item === "github" ? "GitHub" : item}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
          {tab === "status" ? <ManagedStatusPanel /> : null}
          {tab === "github" ? <ManagedGitHubPanel onConnected={onGitHubConnected} /> : null}
          {tab === "secrets" ? <ManagedSecretsPanel /> : null}
        </div>
      </div>
    </Modal>
  );
}
