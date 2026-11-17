import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * A titled group of settings rows: one hairline card whose rows are split by
 * hairlines, the way a system settings pane reads. Rows are 52px on desktop
 * and at least 56px on a phone so every one is a comfortable target.
 */
export function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      {title || description ? (
        <header className="flex flex-col gap-0.5 px-1">
          {title ? (
            <h3 id={headingId} className="type-strong text-basic-primary">
              {title}
            </h3>
          ) : null}
          {description ? (
            <p className="type-meta text-basic-tertiary text-pretty">{description}</p>
          ) : null}
        </header>
      ) : null}
      <div className="flex min-w-0 flex-col divide-y divide-[var(--f-line-soft)] overflow-hidden rounded-card border border-tertiary bg-elevation-level-1">
        {children}
      </div>
    </section>
  );
}

function RowIcon({ icon }: { icon: IconName }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--f-wash-2)] text-basic-secondary">
      <Icon iconName={icon} size={16} />
    </span>
  );
}

/** One row: label (and hint) on the left, its control on the right. */
export function SettingsRow({
  label,
  hint,
  control,
  stacked = false,
  icon,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  control?: ReactNode;
  /** Put the control under the label (long values such as a path). */
  stacked?: boolean;
  /** Leading glyph, matching `SettingsLinkRow` rows in the same group. */
  icon?: IconName;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[52px] min-w-0 gap-3 px-4 py-3 max-md:min-h-14",
        stacked ? "flex-col items-stretch" : "items-center justify-between max-sm:flex-wrap",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <RowIcon icon={icon} /> : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="type-label text-basic-primary">{label}</div>
          {hint ? <div className="type-meta text-basic-tertiary text-pretty">{hint}</div> : null}
        </div>
      </div>
      {control ? (
        <div className={cn("flex min-w-0 items-center gap-2", !stacked && "shrink-0")}>
          {control}
        </div>
      ) : null}
    </div>
  );
}

/** A row that navigates: to another settings section or outside the app. */
export function SettingsLinkRow({
  label,
  hint,
  value,
  to,
  href,
  icon,
}: {
  label: string;
  hint?: ReactNode;
  value?: ReactNode;
  to?: string;
  href?: string;
  icon?: IconName;
}) {
  const content = (
    <>
      {icon ? <RowIcon icon={icon} /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-label text-basic-primary">{label}</span>
        {hint ? <span className="type-meta truncate text-basic-tertiary">{hint}</span> : null}
      </span>
      {value ? (
        <span className="type-meta shrink-0 text-basic-tertiary tabular">{value}</span>
      ) : null}
      <Icon
        iconName={href ? IconName.External : IconName.Right}
        size={16}
        className="shrink-0 text-basic-muted"
      />
    </>
  );
  const className =
    "flex min-h-[52px] min-w-0 items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors duration-150 ease-out hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-2)] max-md:min-h-14";
  if (href) {
    return (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }
  return (
    <Link className={className} to={to ?? "/"}>
      {content}
    </Link>
  );
}

/** Lead paragraph under a section's title. */
export function SectionLead({ children }: { children: ReactNode }) {
  return (
    <p className="type-body-chrome max-w-[60ch] text-basic-secondary text-pretty">{children}</p>
  );
}
