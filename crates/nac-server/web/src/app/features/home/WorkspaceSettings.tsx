import { useState, type ReactNode } from "react";

import {
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
  Switch,
  Tooltip,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * The composer strip's "⋯" button: whether the session gets an isolated
 * checkout, and the ref it starts from. Folded away so a plain session never
 * meets checkout choices. The checkout needs a direct agent on a Local Git
 * project, so the switch is live only when `available`.
 */
export function WorkspaceSettings({
  isolated,
  available,
  onIsolatedChange,
  gitRef,
  defaultRef,
  onRefChange,
  disabled,
}: {
  isolated: boolean;
  available: boolean;
  onIsolatedChange: (isolated: boolean) => void;
  gitRef: string;
  defaultRef: string | null;
  onRefChange: (ref: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "ref">("main");
  const [draft, setDraft] = useState(gitRef);
  const startRef = gitRef || defaultRef;
  const close = () => {
    setOpen(false);
    setView("main");
  };
  const applyRef = (ref: string) => {
    onRefChange(ref);
    setView("main");
  };

  return (
    <Popover
      open={open}
      onClose={close}
      sticky
      focusScope="Additional settings"
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Medium}
      content={
        view === "main" ? (
          <>
            <p className="type-meta px-2.5 pt-1.5 pb-1 text-basic-tertiary">Additional settings</p>
            <SettingRow icon={IconName.FolderCopy} label="Isolated checkout">
              <Switch
                aria-label="Isolated checkout"
                checked={isolated}
                disabled={!available && !isolated}
                onChange={onIsolatedChange}
              />
            </SettingRow>
            {available ? null : (
              <p className="type-meta px-2.5 pb-1.5 text-basic-tertiary">
                Needs a direct agent in a local Git project.
              </p>
            )}
            <button
              type="button"
              disabled={!isolated || !available}
              onClick={() => {
                setDraft(gitRef);
                setView("ref");
              }}
              className={cn(
                "flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-basic-primary outline-none max-md:min-h-11",
                "hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)] disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <Icon iconName={IconName.Scheme} size={14} className="shrink-0 text-basic-tertiary" />
              <span className="flex-1">Start from</span>
              <span className="min-w-0 truncate text-basic-tertiary">
                {startRef ?? "Choose a ref"}
              </span>
              <Icon iconName={IconName.Right} size={12} className="shrink-0 text-basic-muted" />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1 px-1 pt-0.5 pb-1">
              <button
                type="button"
                aria-label="Back"
                onClick={() => setView("main")}
                className="flex size-6 items-center justify-center rounded-md text-basic-secondary outline-none hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)]"
              >
                <Icon iconName={IconName.Left} size={14} />
              </button>
              <span className="type-meta text-basic-tertiary">Start from</span>
            </div>
            <div className="px-1 pb-1">
              <input
                autoFocus
                aria-label="Branch, tag or commit"
                placeholder={defaultRef ?? "Branch, tag or commit"}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  applyRef(draft.trim());
                }}
                className="type-body-chrome h-8 w-full rounded-lg border border-tertiary bg-elevation-level-1 px-2.5 text-basic-primary outline-none placeholder:text-basic-muted focus:border-secondary max-md:h-11 max-md:text-base"
              />
            </div>
            {defaultRef ? (
              <button
                type="button"
                onClick={() => applyRef("")}
                className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-basic-primary outline-none hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)] max-md:min-h-11"
              >
                <span className="flex-1">Default branch ({defaultRef})</span>
                {gitRef ? null : (
                  <Icon iconName={IconName.Check} size={14} className="text-basic-secondary" />
                )}
              </button>
            ) : (
              <p className="type-meta px-2.5 py-1.5 text-basic-tertiary">
                This project has no saved default branch yet; you can save one when the task starts.
              </p>
            )}
          </>
        )
      }
    >
      <Tooltip
        title={isolated ? `Isolated checkout from ${startRef ?? "…"}` : "Additional settings"}
        disabled={open}
      >
        <button
          type="button"
          aria-label="Additional settings"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => (open ? close() : setOpen(true))}
          className={cn(
            "type-label inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-pill px-1.5 text-basic-secondary outline-none max-md:h-11 max-md:min-w-11",
            "hover:bg-[var(--f-wash-2)] hover:text-basic-primary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] disabled:opacity-50",
            (open || isolated) && "bg-[var(--f-wash-2)] text-basic-primary",
          )}
        >
          {isolated ? (
            <span className="flex min-w-0 items-center gap-1 pl-1">
              <Icon iconName={IconName.FolderCopy} size={14} className="shrink-0" />
              <span className="max-w-40 truncate">{startRef ?? "Isolated"}</span>
            </span>
          ) : null}
          <Icon iconName={IconName.MenuHorizontal} size={16} className="shrink-0" />
        </button>
      </Tooltip>
    </Popover>
  );
}

function SettingRow({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 px-2.5 text-basic-primary max-md:min-h-11">
      <Icon iconName={icon} size={14} className="shrink-0 text-basic-tertiary" />
      <span className="flex-1">{label}</span>
      {children}
    </div>
  );
}
