import type { ReactNode } from "react";

import { cn } from "@/app/lib/cn";

import { ButtonContent, ButtonVariant, Icon, IconName, StickyButton } from "@/app/atoms";
import { usePanelPhoneChrome } from "@/app/providers/PanelPhoneChrome";

/**
 * One screen of the side box on a phone: a list of rows, or the row opened
 * from it. Its header defaults to floating over content, with 56px scroller
 * clearance. Selected child and Files list owners can reserve an in-flow
 * header instead; Files actions wrap below the title above the scroller.
 *
 * A list screen leaves the dialog through its back button and keeps the panel
 * tab bar over its last rows; an opened row goes back to its list instead.
 */
export function PanelPhoneScreen({
  title,
  titleAction,
  actions,
  back,
  bar = false,
  headerInFlow = false,
  actionsBelowTitle = false,
  children,
}: {
  title: ReactNode;
  /** Belongs to the title itself, beside it rather than trailing. */
  titleAction?: ReactNode;
  /** The screen's own controls, trailing the header. */
  actions?: ReactNode;
  /** Where the leading button leads. Omitted, it closes the dialog. */
  back?: { label: string; onClick: () => void };
  bar?: boolean;
  /** Opt-in for selected child detail or a Files list's wrapping controls. */
  headerInFlow?: boolean;
  /** Files use a full row; selected child actions wrap only in a narrow container. */
  actionsBelowTitle?: boolean | "narrow";
  children: ReactNode;
}) {
  const chrome = usePanelPhoneChrome();
  return (
    <div
      className={cn(
        "relative flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-ground",
        actionsBelowTitle === "narrow" && "@container/panel-phone",
      )}
    >
      <header
        className={cn(
          "z-10 flex items-center gap-4 py-1 pl-2 pr-1",
          actionsBelowTitle && "flex-wrap gap-y-2",
          actionsBelowTitle === "narrow" && "@min-[280px]/panel-phone:flex-nowrap",
          headerInFlow
            ? "relative min-h-14 shrink-0 bg-elevation-ground"
            : "fade-from-top absolute inset-x-0 top-0 h-14",
        )}
      >
        <StickyButton
          variant={ButtonVariant.Ghost}
          content={ButtonContent.Icon}
          className="!h-11 shrink-0"
          buttonClassName="!h-11 !min-w-11"
          aria-label={back?.label ?? "Close"}
          onClick={back?.onClick ?? chrome?.close}
        >
          <Icon iconName={IconName.Left} />
        </StickyButton>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="header-md min-w-0 truncate text-basic-primary">{title}</h2>
          {titleAction}
        </div>
        {actions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-2",
              actionsBelowTitle && "basis-full min-w-0",
              actionsBelowTitle === "narrow" && "@min-[280px]/panel-phone:basis-auto",
            )}
          >
            {actions}
          </div>
        ) : null}
      </header>
      {children}
      {bar ? chrome?.bar : null}
    </div>
  );
}
