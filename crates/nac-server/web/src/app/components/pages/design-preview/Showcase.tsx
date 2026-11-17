import type React from "react";
import { cn } from "@/app/lib/cn";

/** One chapter of the showcase: a quiet heading, a line of intent, its sections. */
export function ShowcaseGroup({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="type-title text-basic-primary">
          {title}
        </h2>
        <p className="type-body-chrome max-w-[60ch] text-basic-tertiary">{description}</p>
      </div>
      {/* Sections are plain siblings: the capture journeys measure one against the next. */}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A labelled row inside a section: the caption on the left, specimens on the right. */
export function Specimen({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-muted px-4 py-4 last:border-b-0 md:flex-row md:gap-6">
      <div className="flex w-full shrink-0 flex-col gap-0.5 md:w-[168px]">
        <span className="type-label text-basic-primary">{label}</span>
        {hint ? <span className="type-meta text-basic-tertiary">{hint}</span> : null}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-3", className)}>
        {children}
      </div>
    </div>
  );
}

/** Token name set in the code face, for captions under a swatch or a ramp step. */
export function TokenName({ children }: { children: React.ReactNode }) {
  return <code className="code-small text-basic-tertiary">{children}</code>;
}
