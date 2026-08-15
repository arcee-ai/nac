import type React from "react";

import { cn } from "@/app/lib/cn";
import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Input,
  InputLeading,
  InputSize,
  IconName,
  PopoverPlacement,
  Select,
  type SelectItem,
} from "@/app/atoms";
import { SESSION_ENVS, type SessionEnv } from "@/app/lib/format";
import { providerLabel } from "@/app/lib/providers";
import {
  RANGE_ITEMS,
  SORT_ITEMS,
  setCreatedRange,
  setModifiedRange,
  setQuery,
  setSort,
  toggleEnv,
  toggleProvider,
  useCreatedRange,
  useFilterQuery,
  useModifiedRange,
  useSelectedEnvs,
  useSelectedProviders,
  useSessionProviders,
  useSort,
  type RangeId,
  type SortId,
} from "@/app/store/sessionFiltersStore";
import type { ManagedSessionSummary } from "@/app/types/api";

// Chips are Small/Text buttons; the design's 12px inline padding beats the
// atom's 8px, and inline style is the only way to win over `.btn-small.btn-text`.
const CHIP_PADDING = { paddingInline: "12px" };

function Divider() {
  return <div className="h-px w-full bg-divider-muted shrink-0" />;
}

function Section({
  children,
  gap,
}: {
  children: React.ReactNode;
  gap: string;
}) {
  return <div className={cn("flex flex-col px-4 py-6", gap)}>{children}</div>;
}

function FilterRow({
  label,
  items,
  value,
  onValueChange,
  stacked,
}: {
  label: string;
  items: SelectItem[];
  value: string;
  onValueChange: (id: string) => void;
  /** Label above a full-width field, which is all a phone has room for. */
  stacked: boolean;
}) {
  return (
    <div
      className={cn(
        stacked
          ? "flex flex-col gap-1"
          : "flex items-center justify-between gap-3",
      )}
    >
      <div
        className={cn(
          stacked
            ? "label-medium text-basic-primary"
            : "label-small text-basic-secondary shrink-0",
        )}
      >
        {label}
      </div>
      <Select
        items={items}
        value={value}
        onValueChange={onValueChange}
        size={stacked ? ButtonSize.Large : ButtonSize.Small}
        variant={ButtonVariant.Secondary}
        // The rail is narrow, so the panel hangs from the trigger's right edge
        // and grows inwards. As a placement rather than a class: adding
        // `right-0` on top of the default leaves both edges pinned, which
        // squeezes the panel to the trigger's width and spills the labels out.
        placement={PopoverPlacement.BottomLeft}
        className={stacked ? "w-full" : "min-w-0"}
        triggerClassName={stacked ? "w-full btn-field" : ""}
      />
    </div>
  );
}

function Chips<T extends string>({
  label,
  options,
  selected,
  onToggle,
  emptyText,
  // SAFETY: the default labeler is only used for string options, where the
  // cast is the identity.
  labelOf = (option: T) => option as string,
  touch,
}: {
  label: string;
  options: readonly T[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  emptyText?: string;
  labelOf?: (value: T) => string;
  /** Taller chips and a heavier label, for the phone's filters dialog. */
  touch: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          touch
            ? "label-medium text-basic-primary"
            : "label-small text-basic-secondary",
        )}
      >
        {label}
      </div>
      {options.length === 0 ? (
        <div className="text-micro text-basic-muted">{emptyText}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <Button
              key={option}
              // The 36px chip already carries the design's 16px padding.
              size={touch ? ButtonSize.Medium : ButtonSize.Small}
              content={ButtonContent.Text}
              variant={
                selected.includes(option)
                  ? ButtonVariant.Primary
                  : ButtonVariant.Secondary
              }
              onClick={() => onToggle(option)}
              aria-pressed={selected.includes(option)}
              style={touch ? undefined : CHIP_PADDING}
            >
              {labelOf(option)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SessionFilters({
  sessions,
  showSearch = true,
  mobile = false,
  onChange,
}: {
  sessions: ManagedSessionSummary[];
  /** Off where the page already carries the search field, e.g. on a phone. */
  showSearch?: boolean;
  /** Stacked fields and touch-sized chips, for the phone's filters dialog. */
  mobile?: boolean;
  /** Runs after any filter moves. The phone's dialog closes on it. */
  onChange?: () => void;
}) {
  const query = useFilterQuery();
  const sort = useSort();
  const createdRange = useCreatedRange();
  const modifiedRange = useModifiedRange();
  const envs = useSelectedEnvs();
  const providers = useSelectedProviders();
  const providerOptions = useSessionProviders(sessions);

  const commit =
    <T,>(apply: (value: T) => void) =>
    (value: T) => {
      apply(value);
      onChange?.();
    };

  return (
    <div className="flex flex-col">
      {showSearch ? (
        <>
          <Section gap="gap-4">
            <Input
              inputSize={InputSize.Medium}
              leading={InputLeading.Icon}
              leadingIconName={IconName.Search}
              placeholder="Search sessions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search sessions"
            />
          </Section>
          <Divider />
        </>
      ) : null}
      <Section gap={mobile ? "gap-6" : "gap-4"}>
        <FilterRow
          label="Sort by"
          items={SORT_ITEMS}
          value={sort}
          onValueChange={commit((id: string) =>
            // SAFETY: the ids are built from SORT_ITEMS, so every value the
            // picker can emit is a SortId.
            setSort(id as SortId),
          )}
          stacked={mobile}
        />
        <FilterRow
          label="Creation date"
          items={RANGE_ITEMS}
          value={createdRange}
          onValueChange={commit((id: string) =>
            // SAFETY: the ids are built from RANGE_ITEMS, so every value the
            // picker can emit is a RangeId.
            setCreatedRange(id as RangeId),
          )}
          stacked={mobile}
        />
        <FilterRow
          label="Modification date"
          items={RANGE_ITEMS}
          value={modifiedRange}
          onValueChange={commit((id: string) =>
            // SAFETY: the ids are built from RANGE_ITEMS, so every value the
            // picker can emit is a RangeId.
            setModifiedRange(id as RangeId),
          )}
          stacked={mobile}
        />
      </Section>
      <Divider />
      <Section gap="gap-4">
        <Chips<SessionEnv>
          label="Environment"
          options={SESSION_ENVS}
          selected={envs}
          onToggle={commit(toggleEnv)}
          touch={mobile}
        />
      </Section>
      <Divider />
      <Section gap="gap-4">
        <Chips
          label="Provider"
          options={providerOptions}
          selected={providers}
          onToggle={commit(toggleProvider)}
          emptyText="No providers yet"
          labelOf={providerLabel}
          touch={mobile}
        />
      </Section>
    </div>
  );
}
