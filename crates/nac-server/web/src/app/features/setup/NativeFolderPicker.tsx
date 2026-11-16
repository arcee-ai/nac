import { useEffect, useEffectEvent, useState } from "react";
import { Button, ButtonVariant, Modal } from "@/app/atoms";
import { errorMessage } from "@/app/providers/ToastProvider";
import { selectLocalFolder, type NativeDirectoryPort } from "./localFolder";

/** Keeps a shared overlay lifetime while AppKit owns the actual folder sheet.
 * Unmount/close/backend replacement cancels this invocation before late results. */
export function NativeFolderPicker({
  port,
  initialPath,
  open,
  onSelect,
  onClose,
}: {
  port: NativeDirectoryPort;
  initialPath: string;
  open: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const selected = useEffectEvent(onSelect);
  const cancelled = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const request = selectLocalFolder(port, initialPath, {
      selected,
      cancelled,
      failed: setFailure,
    });
    return request.cancel;
  }, [port, initialPath, open, attempt]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Select Working Folder"
      footer={
        <>
          <Button variant={ButtonVariant.Secondary} onClick={onClose}>
            Cancel
          </Button>
          {failure ? (
            <Button
              onClick={() => {
                setFailure(null);
                setAttempt((value) => value + 1);
              }}
            >
              Try Again
            </Button>
          ) : null}
        </>
      }
    >
      <p role="status" className="text-micro text-basic-muted">
        {failure ? errorMessage(failure) : "Choose a folder in the Mac folder picker."}
      </p>
    </Modal>
  );
}
