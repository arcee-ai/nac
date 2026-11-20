import { useCallback, useState } from "react";
import { Input } from "@/app/atoms";
import { ModelSetupSection } from "@/app/features/setup/ModelSetupSection";
import type {
  LaunchModelSelection,
  SessionModelInitial,
} from "@/app/features/setup/modelSelection";
import type { FreshTaskDestination } from "@/app/types/api";

export function DestinationFields({
  value,
  onChange,
  git,
  savedDefaultRef,
}: {
  value: FreshTaskDestination;
  onChange: (value: FreshTaskDestination) => void;
  git: boolean;
  savedDefaultRef: string | null;
}) {
  const update = (patch: Partial<FreshTaskDestination>) => onChange({ ...value, ...patch });
  const [initial] = useState<SessionModelInitial | undefined>(() =>
    value.model_selection
      ? {
          ...value.model_selection,
          backend: value.model_selection.backend as SessionModelInitial["backend"],
          api_key_env: value.model_selection.api_key_env ?? null,
          reasoning_effort: value.model_selection.reasoning_effort ?? null,
          extra_headers: value.model_selection.extra_headers ?? {},
        }
      : undefined,
  );
  const onModelChange = useCallback(
    (selection: LaunchModelSelection | null) => {
      const next = selection
        ? {
            backend: selection.backend,
            model: selection.model,
            base_url: selection.base_url,
            allow_insecure_http: selection.allow_insecure_http,
            api_key_env: selection.api_key_env,
            reasoning_effort: selection.reasoning_effort,
            extra_headers: selection.extra_headers,
            compaction_threshold: selection.compaction_threshold ?? null,
          }
        : null;
      if (JSON.stringify(value.model_selection ?? null) !== JSON.stringify(next)) {
        onChange({ ...value, model_selection: next, model: null, reasoning_effort: null });
      }
    },
    [value, onChange],
  );
  return (
    <fieldset className="flex flex-col gap-4" aria-label="Scheduled task destination">
      <p className="type-body-chrome text-basic-secondary">
        {git
          ? "Each occurrence creates an isolated retained Git checkout. Source edits are excluded."
          : "This Local project has no Git repository. Each task uses the project directory and shares its files with other tasks."}
      </p>
      {git && (
        <>
          <p className="type-body-chrome text-basic-secondary">
            Default branch: {savedDefaultRef ?? "choose the project's configured branch below"}. Its
            current committed head is resolved once for each new occurrence.
          </p>
          {!savedDefaultRef && (
            <Input
              label="Save project default branch"
              aria-label="Scheduled project default branch"
              value={value.default_ref ?? ""}
              required
              onChange={(event) => update({ default_ref: event.target.value || null })}
            />
          )}
          <Input
            label="Pinned commit (optional)"
            aria-label="Scheduled pinned commit"
            value={value.pinned_commit ?? ""}
            maxLength={64}
            onChange={(event) => update({ pinned_commit: event.target.value || null })}
            hintText="A complete pinned commit wins over the saved branch. Retries keep the original resolution."
          />
        </>
      )}
      <ModelSetupSection
        initial={initial}
        onChange={onModelChange}
        invalid={!value.model_selection}
      />
      <Input
        label="Retained task allowance"
        aria-label="Retained task allowance"
        type="number"
        required
        min={1}
        max={1000}
        value={value.retained_limit}
        onChange={(event) => update({ retained_limit: event.target.valueAsNumber })}
        hintText="Includes reserved and partial launches and resources whose task was deleted. At the allowance, the schedule suspends. Nothing is automatically pruned or archived."
      />
    </fieldset>
  );
}
