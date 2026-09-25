/** Count sitting on a panel icon. Shared by the side box tabs and the collapsed rail. */
export function PanelCountBadge({ count }: { count: number }) {
  return (
    <span className="pointer-events-none absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-btn-primary-disabled px-0.5 text-[9px] leading-3 font-medium text-basic-secondary">
      {count}
    </span>
  );
}
