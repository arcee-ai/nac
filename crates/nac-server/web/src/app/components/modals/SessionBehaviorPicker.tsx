import { cn } from "@/app/lib/cn";
import { SESSION_BEHAVIORS } from "@/app/lib/sessionBehavior";
import { behaviorLabel } from "@/app/features/home/behaviors";
import type { SessionBehavior } from "@/app/types/api";

export function SessionBehaviorPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: SessionBehavior;
  onChange: (behavior: SessionBehavior) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="type-label mb-1 text-basic-primary">How should this session work?</legend>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3" role="radiogroup">
        {SESSION_BEHAVIORS.map((option, index) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              className={cn(
                "flex cursor-pointer flex-col gap-1.5 rounded-card border p-3.5 text-left outline-none md:min-h-[188px]",
                "transition-[border-color,background-color] duration-150 ease-out motion-reduce:transition-none",
                "focus-visible:ring-2 focus-visible:ring-[var(--f-ring)]",
                selected
                  ? "border-[var(--f-line-ink)] bg-[var(--f-wash-1)]"
                  : "border-tertiary bg-elevation-level-1 hover:border-secondary",
                disabled && "cursor-not-allowed opacity-60",
              )}
              onClick={() => onChange(option.id)}
              onKeyDown={(event) => {
                const direction =
                  event.key === "ArrowRight" || event.key === "ArrowDown"
                    ? 1
                    : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? -1
                      : 0;
                const targetIndex =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? SESSION_BEHAVIORS.length - 1
                      : direction
                        ? (index + direction + SESSION_BEHAVIORS.length) % SESSION_BEHAVIORS.length
                        : null;
                if (targetIndex == null) return;
                event.preventDefault();
                onChange(SESSION_BEHAVIORS[targetIndex].id);
                const radios =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                    '[role="radio"]',
                  );
                radios?.[targetIndex]?.focus();
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="type-strong text-basic-primary">{behaviorLabel(option.id)}</span>
                {option.id === "orchestrator" ? (
                  <span className="type-tag shrink-0 text-basic-tertiary">Default</span>
                ) : null}
              </span>
              <span className="type-meta text-basic-secondary">{option.topLevel}</span>
              <span className="type-meta text-basic-secondary">{option.editing}</span>
              <span className="type-meta text-basic-secondary">{option.delegation}</span>
              <span className="type-meta mt-auto pt-1 text-basic-muted">{option.inspection}</span>
            </button>
          );
        })}
      </div>
      <p className="type-meta mt-1 text-basic-muted">
        Behavior is fixed for the lifetime of a session. Start a new session to choose a different
        behavior.
      </p>
    </fieldset>
  );
}
