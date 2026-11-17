import { useState } from "react";
import { Button, ButtonVariant, Input } from "@/app/atoms";
import type { FreshTaskRetainedAllowance } from "@/app/types/api";
import { useFreshRetainedAllowance } from "./queries";

export function RetainedAllowanceControls({
  projectId,
  allowance,
  disabled,
}: {
  projectId: string;
  allowance: FreshTaskRetainedAllowance;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<{ revision: number; limit: number } | null>(null);
  const command = useFreshRetainedAllowance(projectId, () => setDraft(null));
  const busy = command.intent !== null || command.control.isPending;
  return (
    <section
      aria-label="Host retained task allowance"
      className="type-body-chrome flex flex-col gap-3 rounded-lg bg-elevation-sublevel-variant-A p-4 text-basic-secondary"
    >
      <p className="tabular text-basic-primary">
        Host retained resources: {allowance.retained_count} / {allowance.retained_limit} across all
        interval task schedules.
      </p>
      <p className="type-meta text-basic-tertiary">
        Reservations and partial launches count even after task deletion. A limit change preserves
        existing resources and suspended schedules; review a suspended schedule before resuming it.
      </p>
      {draft ? (
        <form
          aria-label="Change host retained allowance"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            command.submit(draft.revision, draft.limit);
          }}
        >
          <Input
            type="number"
            label="Host retained allowance"
            aria-label="Host retained allowance"
            required
            min={1}
            max={10000}
            disabled={disabled || busy}
            value={draft.limit}
            onChange={(event) => setDraft({ ...draft, limit: event.target.valueAsNumber })}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={ButtonVariant.Primary} disabled={disabled || busy}>
              Save host allowance
            </Button>
            <Button variant={ButtonVariant.Ghost} disabled={busy} onClick={() => setDraft(null)}>
              Cancel host allowance change
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant={ButtonVariant.Secondary}
          className="self-start"
          disabled={disabled || busy}
          onClick={() =>
            setDraft({ revision: allowance.revision, limit: allowance.retained_limit })
          }
        >
          Change host allowance
        </Button>
      )}
      {command.error && (
        <div role="alert" className="flex flex-col items-start gap-2 text-error-primary">
          <p>{command.error.message}</p>
          {command.intent && (
            <Button
              variant={ButtonVariant.Secondary}
              disabled={command.control.isPending}
              onClick={command.retry}
            >
              Retry same allowance request
            </Button>
          )}
          {command.rejected && (
            <Button variant={ButtonVariant.Secondary} onClick={command.reviewLatest}>
              Review latest host allowance
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
