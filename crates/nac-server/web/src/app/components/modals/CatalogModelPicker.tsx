// Browsing `GET /models` the way the legacy dashboard did: the catalog is local
// and credential-free, so every model a build knows about can be searched and
// picked before any key exists. Picking one names the provider too, which is
// the whole point — a model id alone does not say who serves it.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputLeading,
  InputSize,
  Popover,
  PopoverPlacement,
  Separator,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { formatTokensCompact } from "@/app/lib/format";
import { providerLabel } from "@/app/lib/providers";
import type {
  BackendKind,
  CatalogModel,
  CatalogProvider,
  ModelCatalog,
  ModelCostRates,
} from "@/app/types/api";

/**
 * The only model `arcee-auth` accepts: `validate_backend_model` in
 * crates/nac-core/src/model/client/mod.rs rejects every other id, so offering
 * them here would just build a session the server refuses.
 */
const ARCEE_AUTH_MODEL = "trinity-large-thinking";

export interface CatalogPick {
  backend: BackendKind;
  model: string;
  /** The endpoint the catalog names for this provider, managed one first. */
  baseUrl: string;
}

interface Row {
  provider: CatalogProvider;
  model: CatalogModel;
}

/** Where a session on this provider sends its requests. */
function catalogBaseUrl(provider: CatalogProvider): string {
  return provider.managed_base_url ?? provider.default_base_url ?? "";
}

function rowsFor(catalog: ModelCatalog | undefined, query: string): Row[] {
  const needle = query.trim().toLowerCase();
  const rows: Row[] = [];
  for (const provider of catalog?.providers ?? []) {
    for (const model of provider.models) {
      if (provider.id === "arcee-auth" && model.id !== ARCEE_AUTH_MODEL)
        continue;
      if (needle) {
        const haystack =
          `${model.id} ${model.display_name ?? ""} ${provider.id}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      rows.push({ provider, model });
    }
  }
  return rows;
}

function rate(value: number): string | null {
  return Number.isFinite(value) && value > 0
    ? `$${Number(value.toFixed(2))}`
    : null;
}

/** Catalog rates are $/1M tokens; all-zero means unknown pricing, never free. */
function pricing(cost: ModelCostRates): string {
  const input = rate(cost.input);
  const output = rate(cost.output);
  return input && output ? `${input}/${output} per 1M` : "pricing unknown";
}

function modelMeta(model: CatalogModel): string {
  const context =
    model.context_window > 0
      ? `${formatTokensCompact(model.context_window)} ctx`
      : "";
  return [context, pricing(model.cost)].filter(Boolean).join(" · ");
}

const modelName = (model: CatalogModel) => model.display_name || model.id;

/**
 * A missing credential never blocks a pick — the badge only says what has to
 * happen before the session can run, which for an API-key provider is the key
 * asked for right below this row.
 */
function ProviderBadges({ provider }: { provider: CatalogProvider }) {
  if (provider.auth_status !== "no_credential") return null;
  return (
    <Badge
      text={
        provider.managed_base_url ? "login required" : "no credential detected"
      }
      color={BadgeColor.Yellow}
      className="shrink-0 whitespace-nowrap"
    />
  );
}

export function CatalogModelPicker({
  catalog,
  loading,
  failed,
  value,
  onSelect,
}: {
  catalog: ModelCatalog | undefined;
  loading: boolean;
  failed: boolean;
  value: CatalogPick | null;
  onSelect: (pick: CatalogPick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => rowsFor(catalog, query), [catalog, query]);
  // A shorter list can leave the highlight past its end.
  const index = Math.min(active, Math.max(rows.length - 1, 0));

  // The highlight belongs to the list a query produced, so it is reset next to
  // the query itself: an effect would land a frame later, over rows the search
  // has already replaced.
  const search = (next: string) => {
    setQuery(next);
    setActive(0);
  };

  // Keeps the keyboard highlight visible without scrolling the modal behind it.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-row="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, index]);

  const selected = rows.find(
    (row) =>
      row.provider.id === value?.backend && row.model.id === value?.model,
  );

  const pick = (row: Row) => {
    onSelect({
      backend: row.provider.id,
      model: row.model.id,
      baseUrl: catalogBaseUrl(row.provider),
    });
    setOpen(false);
    search("");
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const next = Math.min(current, rows.length - 1) + step;
        return (next + rows.length) % rows.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[index];
      if (row) pick(row);
    }
  };

  const label = value
    ? selected
      ? modelName(selected.model)
      : value.model
    : loading
      ? "Loading models…"
      : failed
        ? "Model catalog unavailable"
        : "Select a model";

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      // Grows leftwards from the control column, which keeps a panel this wide
      // inside the dialog instead of hanging off its right edge.
      placement={PopoverPlacement.BottomLeft}
      size="w-[520px]"
      // Portalled: the dialog scrolls its own body, which would clip the list.
      sticky
      className="shrink-0"
      panelClassName="p-2"
      content={
        <>
          <Input
            inputSize={InputSize.Medium}
            leading={InputLeading.Icon}
            leadingIconName={IconName.Search}
            placeholder="Search models…"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => search(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div
            ref={listRef}
            className="flex flex-col max-h-[320px] overflow-auto [&>*]:shrink-0"
          >
            {rows.length === 0 ? (
              <p className="px-2 py-3 text-micro text-basic-muted">
                {loading
                  ? "Reading the catalog…"
                  : failed
                    ? "The model catalog could not be read."
                    : `No model matches "${query.trim()}".`}
              </p>
            ) : (
              rows.map((row, position) => {
                const first =
                  position === 0 ||
                  rows[position - 1].provider.id !== row.provider.id;
                const chosen =
                  row.provider.id === value?.backend &&
                  row.model.id === value?.model;
                return (
                  <div key={`${row.provider.id}/${row.model.id}`}>
                    {first ? (
                      <div className="flex items-center gap-2 px-2 pt-6 pb-2">
                        <span className="tag-label text-basic-muted whitespace-nowrap shrink-0">
                          {providerLabel(row.provider.id)}
                        </span>
                        {/* Basis 100%, so it eats the row's slack and leaves the
                            label and badge at their natural width. */}
                        <Separator className="shrink" />
                        <ProviderBadges provider={row.provider} />
                      </div>
                    ) : null}
                    <TabButton
                      size={TabButtonSize.Medium}
                      variant={
                        chosen
                          ? TabButtonVariant.Accent
                          : TabButtonVariant.Regular
                      }
                      active={position === index}
                      data-row={position}
                      onMouseEnter={() => setActive(position)}
                      onClick={() => pick(row)}
                    >
                      <span className="flex-1 min-w-0 text-left truncate">
                        {modelName(row.model)}
                      </span>
                      <span className="code-small text-basic-muted truncate max-w-[180px]">
                        {row.model.id}
                      </span>
                      <span className="text-micro text-basic-muted shrink-0">
                        {modelMeta(row.model)}
                      </span>
                    </TabButton>
                  </div>
                );
              })
            )}
          </div>
        </>
      }
    >
      <Button
        variant={ButtonVariant.Secondary}
        size={ButtonSize.Medium}
        content={ButtonContent.IconRight}
        disabled={!catalog}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="w-[280px]"
      >
        <span className="flex-1 min-w-0 text-left truncate">{label}</span>
        {/* Some providers name their flagship after themselves; saying it twice
            on one line reads like a mistake. */}
        {value && providerLabel(value.backend) !== label ? (
          <span className="text-micro text-basic-muted truncate max-w-[110px]">
            {providerLabel(value.backend)}
          </span>
        ) : null}
        <Icon
          iconName={IconName.Down}
          className={cn(
            "transition-transform duration-150 ease-out",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </Button>
    </Popover>
  );
}
