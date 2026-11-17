import { useCallback, useState } from "react";

import { Button, ButtonVariant, Loader, LoaderSize, Modal, ModalSize } from "@/app/atoms";
import type { LaunchModelSelection } from "@/app/components/modals/ConfigurationsPanel";
import { LightModelSection, type LightSelection } from "@/app/components/modals/LightModelSection";
import { ModelSetupSection } from "@/app/features/setup/ModelSetupSection";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import type { SessionBehavior } from "@/app/types/api";

import type { InheritedModel, ModelOverride } from "./modelChoice";

/**
 * The composer's model chip, opened: the same model setup the old New Chat
 * dialog had (unified catalog, provider connections, advanced presets, light
 * model), applied to this one session without touching the project default.
 */
export function ModelOverrideModal({
  open,
  behavior,
  inherited,
  inheritancePending,
  inheritanceError,
  current,
  onApply,
  onReset,
  onClose,
}: {
  open: boolean;
  behavior: SessionBehavior;
  inherited: InheritedModel | null;
  inheritancePending: boolean;
  inheritanceError: Error | null;
  current: ModelOverride | null;
  onApply: (override: ModelOverride) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <ModelOverrideForm
      behavior={behavior}
      inherited={inherited}
      inheritancePending={inheritancePending}
      inheritanceError={inheritanceError}
      current={current}
      onApply={onApply}
      onReset={onReset}
      onClose={onClose}
    />
  );
}

function ModelOverrideForm({
  behavior,
  inherited,
  inheritancePending,
  inheritanceError,
  current,
  onApply,
  onReset,
  onClose,
}: Omit<Parameters<typeof ModelOverrideModal>[0], "open">) {
  const policy = useUiPolicy();
  const [selection, setSelection] = useState<LaunchModelSelection | null>(
    current?.selection ?? null,
  );
  const [light, setLight] = useState<LightSelection>(
    current?.light ?? { mode: "single", light: null },
  );
  const [error, setError] = useState("");
  const onSelection = useCallback((next: LaunchModelSelection | null) => {
    setSelection(next);
    setError("");
  }, []);
  const onLight = useCallback((next: LightSelection) => {
    setLight(next);
    setError("");
  }, []);

  // A saved setup selected inside the primary picker owns its light-model
  // default; catalog selections keep the project's effective choice.
  const selectedLight =
    selection?.kind === "resolved" && selection.light_model !== undefined
      ? selection.light_model
      : inherited?.light;
  const seed =
    current?.selection.kind === "resolved"
      ? { ...current.selection, extra_headers: current.selection.extra_headers ?? {} }
      : inherited?.initial;

  const apply = () => {
    if (!selection) {
      setError("Choose the primary model first.");
      return;
    }
    if (policy.orchestrationEnabled && light.mode === "dual" && !light.light) {
      setError("Pick the light model, or switch back to a single model.");
      return;
    }
    onApply({ selection, light, selectedLight });
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
            Use project default
          </Button>
          <Button
            variant={ButtonVariant.Primary}
            className="max-md:min-h-11"
            disabled={!selection || inheritancePending}
            onClick={apply}
          >
            Use this model
          </Button>
        </div>
      }
    >
      {inheritanceError ? (
        <p role="alert" className="type-body-chrome text-error-primary">
          The project's model settings could not be loaded. Close this and try again.
        </p>
      ) : inheritancePending ? (
        <div
          role="status"
          className="type-body-chrome flex items-center gap-2 py-6 text-basic-secondary"
        >
          <Loader size={LoaderSize.XSmall} />
          Loading the project's model settings…
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="type-body-chrome text-basic-secondary">
            {inherited
              ? `${inherited.source === "project-default" ? "Project default" : "Inherited from the latest session"}: ${inherited.initial.model} · reasoning ${inherited.initial.reasoning_effort ?? "model default"}.`
              : "This project has no saved model default."}{" "}
            A choice here applies to this session only.
          </p>
          <ModelSetupSection
            initial={seed}
            onChange={onSelection}
            invalid={Boolean(error)}
            errorText={error || undefined}
          />
          {policy.orchestrationEnabled ? (
            <LightModelSection
              key={JSON.stringify(selectedLight)}
              initial={current?.light.light ?? selectedLight}
              behavior={behavior}
              onChange={onLight}
            />
          ) : null}
        </div>
      )}
    </Modal>
  );
}
