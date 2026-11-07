import { useId, type ReactNode } from "react";

import { cn } from "@/app/lib/cn";

/** Presentation only: field state, validation and actions stay with the caller. */
export function FormSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={heading} className="label-medium text-basic-primary">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-small !leading-[22px] text-basic-secondary">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
