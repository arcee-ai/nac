import { cn } from "@/app/lib/cn";
import { SESSION_BEHAVIORS } from "@/app/lib/sessionBehavior";
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
        {SESSION_BEHAVIORS.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={cn(
                "flex min-h-[92px] flex-col gap-1 rounded-[6px] border p-3 text-left transition-colors",
                selected
                  ? "border-accent-primary bg-accent-secondary"
                  : "border-border-primary bg-elevation-level-1 hover:bg-elevation-level-2",
              )}
              onClick={() => onChange(option.id)}
            >
              <span className="text-small font-medium text-basic-primary">{option.label}</span>
              <span className="text-xs text-basic-secondary">{option.description}</span>
              {option.id === "orchestrator" ? (
                <span className="tag-label mt-auto text-basic-tertiary">Default</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-micro text-basic-muted">
        Behavior is fixed for the lifetime of this chat. New chats ask again.
      </p>
    </fieldset>
  );
}
