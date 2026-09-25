import { useEffect } from "react";
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
import { type SessionEnv } from "@/app/lib/format";
import { providerLabel } from "@/app/lib/providers";
import {
  RANGE_ITEMS,
  SORT_ITEMS,
  pruneUnavailableFacets,
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
  useSessionEnvs,
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

function Section({ children, gap }: { children: React.ReactNode; gap: string }) {
  return <div className={cn("flex flex-col px-4 py-6", gap)}>{children}</div>;
}

function FilterRow({
  label,
  items,
  value,
  onValueChange,
  stacked,
  sidebar = false,
}: {
  label: string;
  items: SelectItem[];
  value: string;
  onValueChange: (id: string) => void;
  /** Label above a full-width field, which is all a phone has room for. */
  stacked: boolean;
  /** Compact row for the All Projects sidebar: primary label, hugging trigger. */
  sidebar?: boolean;
}) {
  return (
    <div
      className={cn(
        stacked
          ? "flex flex-col gap-1"
          : sidebar
            ? "flex items-center gap-1"
            : "flex items-center justify-between gap-3",
      )}
    >
      <div
        className={cn(
          stacked ? "label-medium text-basic-primary" : "label-small shrink-0",
          sidebar || stacked ? "text-basic-primary" : "text-basic-secondary",
          sidebar && "flex-1 min-w-0",
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
        sticky={sidebar}
        className={stacked ? "w-full" : "min-w-0"}
        triggerClassName={stacked ? "w-full btn-field" : sidebar ? "!gap-1.5 !pl-3" : ""}
      />
    </div>
  );
}

/**
 * One facet, as a row of toggles.
 *
 * Only values something on the list actually has are offered, and a facet down
 * to a single value is left out entirely by the caller: a chip every project
 * matches sorts nothing, and saying "Local" over an all-local list reads as a
 * choice that isn't there.
 */
function Chips<T extends string>({
  label,
  options,
  selected,
  onToggle,
  // SAFETY: the default labeler is only used for string options, where the
  // cast is the identity.
  labelOf = (option: T) => option as string,
  touch,
  sidebar = false,
}: {
  label: string;
  options: readonly T[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  labelOf?: (value: T) => string;
  /** Taller chips and a heavier label, for the phone's filters dialog. */
  touch: boolean;
  /** Primary 14px label and an 8px gap, matching the All Projects sidebar. */
  sidebar?: boolean;
}) {
  return (
    <div className={cn("flex flex-col", sidebar ? "gap-2" : "gap-3")}>
      <div
        className={cn(
          touch ? "label-medium text-basic-primary" : "label-small",
          sidebar || touch ? "text-basic-primary" : "text-basic-secondary",
        )}
      >
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            // The 36px chip already carries the design's 16px padding.
            size={touch ? ButtonSize.Medium : ButtonSize.Small}
            content={ButtonContent.Text}
            variant={selected.includes(option) ? ButtonVariant.Primary : ButtonVariant.Secondary}
            onClick={() => onToggle(option)}
            aria-pressed={selected.includes(option)}
            style={touch ? undefined : CHIP_PADDING}
          >
            {labelOf(option)}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function SessionFilters({
  sessions,
  showSearch = true,
  mobile = false,
  sidebar = false,
  onChange,
}: {
  sessions: ManagedSessionSummary[];
  /** Off where the page already carries the search field, e.g. on a phone. */
  showSearch?: boolean;
  /** Stacked fields and touch-sized chips, for the phone's filters dialog. */
  mobile?: boolean;
  /** Compact rows for the All Projects sidebar. Search stays in the nav above. */
  sidebar?: boolean;
  /** Runs after any filter moves. The phone's dialog closes on it. */
  onChange?: () => void;
}) {
  const query = useFilterQuery();
  const sort = useSort();
  const createdRange = useCreatedRange();
  const modifiedRange = useModifiedRange();
  const envs = useSelectedEnvs();
  const providers = useSelectedProviders();
  const envOptions = useSessionEnvs(sessions);
  const providerOptions = useSessionProviders(sessions);

  // Deleting the last project of some kind takes its chip away, and the
  // selection has to go with it or the list stays narrowed by a control that is
  // no longer on screen.
  useEffect(() => {
    pruneUnavailableFacets(envOptions, providerOptions);
  }, [envOptions, providerOptions]);

  const commit =
    <T,>(apply: (value: T) => void) =>
    (value: T) => {
      apply(value);
      onChange?.();
    };

  const sortRows = (
    <>
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
        sidebar={sidebar}
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
        sidebar={sidebar}
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
        sidebar={sidebar}
      />
    </>
  );

  if (sidebar) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-6 py-2">{sortRows}</div>
        {envOptions.length > 1 ? (
          <>
            <Divider />
            <div className="py-2">
              <Chips<SessionEnv>
                label="Environment"
                options={envOptions}
                selected={envs}
                onToggle={commit(toggleEnv)}
                touch={false}
                sidebar
              />
            </div>
          </>
        ) : null}
        {providerOptions.length > 1 ? (
          <>
            <Divider />
            <div className="py-2">
              <Chips
                label="Provider"
                options={providerOptions}
                selected={providers}
                onToggle={commit(toggleProvider)}
                labelOf={providerLabel}
                touch={false}
                sidebar
              />
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {showSearch ? (
        <>
          <Section gap="gap-4">
            <Input
              inputSize={InputSize.Medium}
              leading={InputLeading.Icon}
              leadingIconName={IconName.Search}
              placeholder="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search projects"
            />
          </Section>
          <Divider />
        </>
      ) : null}
      <Section gap={mobile ? "gap-6" : "gap-4"}>{sortRows}</Section>
      {envOptions.length > 1 ? (
        <>
          <Divider />
          <Section gap="gap-4">
            <Chips<SessionEnv>
              label="Environment"
              options={envOptions}
              selected={envs}
              onToggle={commit(toggleEnv)}
              touch={mobile}
            />
          </Section>
        </>
      ) : null}
      {providerOptions.length > 1 ? (
        <>
          <Divider />
          <Section gap="gap-4">
            <Chips
              label="Provider"
              options={providerOptions}
              selected={providers}
              onToggle={commit(toggleProvider)}
              labelOf={providerLabel}
              touch={mobile}
            />
          </Section>
        </>
      ) : null}
    </div>
  );
}
