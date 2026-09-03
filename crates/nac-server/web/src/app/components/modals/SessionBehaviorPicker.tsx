import { cn } from "@/app/lib/cn";
import { CREATE_SESSION_BEHAVIORS } from "@/app/lib/sessionBehavior";
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
      <legend className="label-small text-basic-primary">How should this chat work?</legend>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3" role="radiogroup">
        {CREATE_SESSION_BEHAVIORS.map((option, index) => {
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
                "flex min-h-[196px] cursor-pointer flex-col gap-2 rounded-[6px] border p-3 text-left transition-colors",
                selected
                  ? "border-accent-primary bg-accent-secondary"
                  : "border-border-primary bg-elevation-level-1 hover:bg-elevation-level-2",
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
                      ? CREATE_SESSION_BEHAVIORS.length - 1
                      : direction
                        ? (index + direction + CREATE_SESSION_BEHAVIORS.length) %
                          CREATE_SESSION_BEHAVIORS.length
                        : null;
                if (targetIndex == null) return;
                event.preventDefault();
                onChange(CREATE_SESSION_BEHAVIORS[targetIndex].id);
                const radios =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                    '[role="radio"]',
                  );
                radios?.[targetIndex]?.focus();
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-small font-medium text-basic-primary">{option.label}</span>
                {option.id === "direct" ? (
                  <span className="tag-label shrink-0 text-basic-tertiary">Default</span>
                ) : null}
              </span>
              <span className="text-xs text-basic-secondary">{option.topLevel}</span>
              <span className="text-xs text-basic-secondary">{option.editing}</span>
              <span className="text-xs text-basic-secondary">{option.delegation}</span>
              <span className="mt-auto text-xs text-basic-muted">{option.inspection}</span>
            </button>
          );
        })}
      </div>
      <p className="text-micro text-basic-muted">
        Behavior is fixed for the lifetime of this chat. Start a new chat to choose a different
        behavior.
      </p>
    </fieldset>
  );
}
