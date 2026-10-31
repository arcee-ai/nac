import type { ReactNode } from "react";

import { ButtonContent, ButtonVariant, Icon, IconName, StickyButton } from "@/app/atoms";
import { usePanelPhoneChrome } from "@/app/providers/PanelPhoneChrome";

/**
 * One screen of the side box on a phone: a list of rows, or the row opened
 * from it. Its header floats over the content the way the dialog header does
 * elsewhere on a phone, so scrollers start 56px down and run under the fade.
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
  children: ReactNode;
}) {
  const chrome = usePanelPhoneChrome();
  return (
    <div className="relative flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-ground">
      <header className="fade-from-top absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-4 py-1 pl-2 pr-1">
        <StickyButton
          variant={ButtonVariant.Ghost}
          content={ButtonContent.Icon}
          className="shrink-0"
          aria-label={back?.label ?? "Close"}
          onClick={back?.onClick ?? chrome?.close}
        >
          <Icon iconName={IconName.Left} />
        </StickyButton>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="header-md min-w-0 truncate text-basic-primary">{title}</h2>
          {titleAction}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
      {bar ? chrome?.bar : null}
    </div>
  );
}
