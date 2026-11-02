import "./session-name-disclosure.css";
import { useState, type ReactElement } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import Modal from "../modal";

/** Direct-child trigger keeps the navigation atom's layout and focus selectors intact. */
function SessionNameHint({
  name,
  description,
  disabled,
  children,
}: {
  name: string;
  description?: string;
  disabled: boolean;
  children: ReactElement;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const available = !mobile && !disabled;
  if (open && !available) setOpen(false);
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && available)}>
      <TooltipTrigger
        asChild
        onMouseEnter={() => setOpen(available)}
        onFocus={(event) => {
          if (!event.target.matches(":focus-visible")) event.preventDefault();
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        collisionPadding={8}
        className="label-micro w-max max-w-[min(360px,calc(100vw-16px))] max-h-[calc(100dvh-16px)] overflow-y-auto rounded-interaction bg-elevation-ground-inverse p-2 text-primary-inverse shadow-xl whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {name}
        {description ? <div className="mt-1 text-secondary-inverse">{description}</div> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** Presentation only: callers supply the existing resolver's current display name. */
export function useSessionNameDisclosure(name: string, description?: string) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<{ name: string; message: string } | null>(null);
  // An unavailable summary must not leave a stale or empty disclosure open.
  if (open && !name) setOpen(false);
  const view = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!name) return;
    event.currentTarget.focus();
    setCopyStatus(null);
    setOpen(true);
  };
  return {
    hint: (children: ReactElement, disabled = false) => (
      <SessionNameHint name={name} description={description} disabled={open || disabled || !name}>
        {children}
      </SessionNameHint>
    ),
    view,
    action: (
      <Button
        variant={ButtonVariant.Tertiary}
        size={ButtonSize.Small}
        content={ButtonContent.Icon}
        aria-label="View full name"
        title="View full name"
        aria-haspopup="dialog"
        disabled={!name}
        onClick={view}
        className="session-name-view shrink-0"
      >
        <Icon iconName={IconName.Info} />
      </Button>
    ),
    overlay: open ? (
      <div className="contents" onClick={(event) => event.stopPropagation()}>
        <Modal
          open
          title="Full session name"
          className="session-name-dialog"
          // Popovers/sheets use layer 120; keep the caller mounted for focus return.
          zIndex={130}
          onClose={() => setOpen(false)}
          onNavigate={() => setOpen(false)}
          footer={
            <div className="flex min-w-0 items-center gap-3">
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(name);
                    setCopyStatus({ name, message: "Name copied" });
                  } catch {
                    setCopyStatus({
                      name,
                      message: "Could not copy. Select the name and copy it manually.",
                    });
                  }
                }}
              >
                Copy name
              </Button>
              <span role="status">{copyStatus?.name === name ? copyStatus.message : ""}</span>
            </div>
          }
        >
          <div
            className="select-text whitespace-pre-wrap [overflow-wrap:anywhere] text-basic-primary"
            data-full-session-name
          >
            {name}
          </div>
        </Modal>
      </div>
    ) : null,
  };
}

/** A heading's name is itself the explicit read-only disclosure action. */
export default function SessionNameDisclosure({
  name,
  className,
  running = false,
}: {
  name: string;
  className?: string;
  running?: boolean;
}) {
  const disclosure = useSessionNameDisclosure(name);
  return (
    <>
      {disclosure.hint(
        <button
          type="button"
          className={`flex items-center gap-1 text-left ${className ?? ""}`}
          aria-label={`View full name: ${name}`}
          aria-haspopup="dialog"
          disabled={!name}
          onClick={disclosure.view}
        >
          <span className={`min-w-0 flex-1 truncate ${running ? "text-shimmer-basic" : ""}`}>
            {name}
          </span>
          <Icon iconName={IconName.Info} size={16} className="shrink-0 text-basic-tertiary" />
        </button>,
      )}
      {disclosure.overlay}
    </>
  );
}
