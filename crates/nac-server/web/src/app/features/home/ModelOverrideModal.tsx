import { useCallback, useState } from "react";

import { Button, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import type { LaunchModelSelection } from "@/app/features/setup/modelSelection";
import { ModelSetupSection } from "@/app/features/setup/ModelSetupSection";

import type { ModelOverride } from "./modelChoice";

/** Choose a model for the session being composed. */
export function ModelOverrideModal({
  open,
  current,
  onApply,
  onReset,
  onClose,
}: {
  open: boolean;
  current: ModelOverride | null;
  onApply: (override: ModelOverride) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <ModelOverrideForm current={current} onApply={onApply} onReset={onReset} onClose={onClose} />
  );
}

function ModelOverrideForm({
  current,
  onApply,
  onReset,
  onClose,
}: Omit<Parameters<typeof ModelOverrideModal>[0], "open">) {
  const [selection, setSelection] = useState<LaunchModelSelection | null>(
    current?.selection ?? null,
  );
  const [error, setError] = useState("");
  const onSelection = useCallback((next: LaunchModelSelection | null) => {
    setSelection(next);
    setError("");
  }, []);
  const seed = current
    ? { ...current.selection, extra_headers: current.selection.extra_headers ?? {} }
    : undefined;

  const apply = () => {
    if (!selection) {
      setError("Choose the primary model first.");
      return;
    }
    onApply({ selection });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size={ModalSize.Wide}
      title="Model for this session"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            variant={ButtonVariant.Ghost}
            className="max-md:min-h-11"
            disabled={!current}
            onClick={() => {
              onReset();
              onClose();
            }}
          >
            Clear selection
          </Button>
          <Button
            variant={ButtonVariant.Primary}
            className="max-md:min-h-11"
            disabled={!selection}
            onClick={apply}
          >
            Use this model
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="type-body-chrome text-basic-secondary">Choose the model for this session.</p>
        <ModelSetupSection
          initial={seed}
          onChange={onSelection}
          invalid={Boolean(error)}
          errorText={error || undefined}
        />
      </div>
    </Modal>
  );
}
