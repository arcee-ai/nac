import { Input } from "@/app/atoms";
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
  return (
    <fieldset className="flex flex-col gap-4" aria-label="Scheduled task destination">
      <p>
        {git
          ? "Each occurrence creates an isolated retained Git checkout. Source edits are excluded."
          : "This Local project has no Git repository. Each task uses the project directory and shares its files with other tasks."}
      </p>
      {git && (
        <>
          <p>
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
      <Input
        label="Model override (optional)"
        aria-label="Scheduled model override"
        value={value.model ?? ""}
        maxLength={256}
        onChange={(event) => update({ model: event.target.value || null })}
        hintText="Leave empty to use the destination project's model defaults."
      />
      <Input
        label="Reasoning override (optional)"
        aria-label="Scheduled reasoning override"
        value={value.reasoning_effort ?? ""}
        maxLength={64}
        onChange={(event) => update({ reasoning_effort: event.target.value || null })}
        hintText="Leave empty to use the destination project's reasoning default."
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
