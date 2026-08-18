import { Button, ButtonContent, ButtonSize, ButtonVariant, SessionIllustration } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

interface SessionsEmptyStateProps {
  /** Opens the launch modal. */
  onStart: () => void;
  mobile: boolean;
}

/**
 * Shown in place of the whole list — rail and search bar included — while the
 * account has no sessions at all, which is how the design frames the state at
 * every width. A filtered-away list keeps the regular chrome instead.
 */
export function SessionsEmptyState({ onStart, mobile }: SessionsEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center py-16",
        mobile ? "px-4" : "px-6",
      )}
    >
      <div className="flex w-[298px] max-w-full flex-col items-center gap-6">
        <SessionIllustration />
        <div className="w-full text-center">
          <p className="header-2xl text-basic-primary">No sessions yet</p>
          <p className="text-medium text-basic-tertiary">Create your first and start building!</p>
        </div>
        <Button
          variant={ButtonVariant.Primary}
          size={ButtonSize.Large}
          content={ButtonContent.Text}
          onClick={onStart}
        >
          Get Started
        </Button>
      </div>
    </div>
  );
}
