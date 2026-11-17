import { Modal, ModalSize } from "@/app/atoms";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { ShortcutList } from "./ShortcutList";

/** ⌘/ — the shortcut catalog as a sheet over whatever is on screen. */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size={ModalSize.Medium}
      zIndex={140}
      bodyClassName="p-5 max-md:p-4"
    >
      <ShortcutList />
    </Modal>
  );
}
