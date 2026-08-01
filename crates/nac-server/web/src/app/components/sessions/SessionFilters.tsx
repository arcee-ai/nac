import type React from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Input,
  InputLeading,
  InputSize,
  IconName,
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

function Section({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 px-4 py-6">{children}</div>;
}

function FilterRow({
  label,
  items,
  value,
  onValueChange,
}: {
  label: string;
  items: SelectItem[];
  value: string;
  onValueChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="label-small text-basic-secondary shrink-0">{label}</div>
      <Select
        items={items}
        value={value}
        onValueChange={onValueChange}
        size={ButtonSize.Small}
        variant={ButtonVariant.Secondary}
        className="min-w-0"
        panelClassName="right-0"
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
  labelOf = (option: T) => option as string,
}: {
  label: string;
  options: readonly T[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  emptyText?: string;
  labelOf?: (value: T) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="label-small text-basic-secondary">{label}</div>
      {options.length === 0 ? (
        <div className="text-micro text-basic-muted">{emptyText}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <Button
              key={option}
              size={ButtonSize.Small}
              content={ButtonContent.Text}
              variant={
                selected.includes(option)
                  ? ButtonVariant.SecondaryAccentHighlighted
                  : ButtonVariant.Secondary
              }
              onClick={() => onToggle(option)}
              aria-pressed={selected.includes(option)}
              style={CHIP_PADDING}
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
}: {
  sessions: ManagedSessionSummary[];
}) {
  const query = useFilterQuery();
  const sort = useSort();
  const createdRange = useCreatedRange();
  const modifiedRange = useModifiedRange();
  const envs = useSelectedEnvs();
  const providers = useSelectedProviders();
  const providerOptions = useSessionProviders(sessions);

  return (
    <div className="flex flex-col">
      <Section>
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
      <Section>
        <FilterRow
          label="Sort by"
          items={SORT_ITEMS}
          value={sort}
          onValueChange={(id) => setSort(id as SortId)}
        />
        <FilterRow
          label="Creation date"
          items={RANGE_ITEMS}
          value={createdRange}
          onValueChange={(id) => setCreatedRange(id as RangeId)}
        />
        <FilterRow
          label="Modification date"
          items={RANGE_ITEMS}
          value={modifiedRange}
          onValueChange={(id) => setModifiedRange(id as RangeId)}
        />
      </Section>
      <Divider />
      <Section>
        <Chips<SessionEnv>
          label="Environment"
          options={SESSION_ENVS}
          selected={envs}
          onToggle={toggleEnv}
        />
      </Section>
      <Divider />
      <Section>
        <Chips
          label="Provider"
          options={providerOptions}
          selected={providers}
          onToggle={toggleProvider}
          emptyText="No providers yet"
          labelOf={providerLabel}
        />
      </Section>
    </div>
  );
}
