/** A quiet section heading on Home, with an optional trailing control. */
export function SectionHeading({
  children,
  trailing,
}: {
  children: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-1">
      <h2 className="type-subheading text-basic-primary">{children}</h2>
      {trailing}
    </div>
  );
}
