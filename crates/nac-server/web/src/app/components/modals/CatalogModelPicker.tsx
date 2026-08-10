// Browsing `GET /models`: the catalog is local and credential-free, so every
// model a build knows about can be searched and picked before any key exists.
// Managed providers the server already authenticates as overlay their live
// `POST /providers/models` index (same path Create New uses after login).

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
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { formatTokensCompact } from "@/app/lib/format";
import { providerLabel, providerOrder } from "@/app/lib/providers";
import { useReadyManagedProviderModels } from "@/app/services/queries";
import type {
  BackendKind,
  CatalogModel,
  CatalogProvider,
  ModelCatalog,
  ModelCostRates,
  ProviderModel,
} from "@/app/types/api";

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

const EMPTY_COST: ModelCostRates = {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
};

/** Live discovery only returns id + display name; fill limits from the catalog. */
function modelsForProvider(
  provider: CatalogProvider,
  live: ProviderModel[] | undefined,
): CatalogModel[] {
  if (!live?.length) return provider.models;
  const known = new Map(provider.models.map((model) => [model.id, model]));
  return live.map((entry) => {
    const catalog = known.get(entry.id);
    if (catalog) {
      return entry.display_name && entry.display_name !== catalog.display_name
        ? { ...catalog, display_name: entry.display_name }
        : catalog;
    }
    return {
      id: entry.id,
      display_name: entry.display_name,
      context_window: provider.default_limits.context_window,
      max_tokens: provider.default_limits.max_tokens,
      cost: EMPTY_COST,
      reasoning: false,
      supported_efforts: provider.default_limits.supported_efforts,
      source: "fallback",
    };
  });
}

function rowsFor(
  catalog: ModelCatalog | undefined,
  query: string,
  liveByBackend: Map<BackendKind, ProviderModel[]>,
): Row[] {
  const needle = query.trim().toLowerCase();
  const providers = [...(catalog?.providers ?? [])].sort((left, right) => {
    const leftReady = left.auth_status === "ready" ? 0 : 1;
    const rightReady = right.auth_status === "ready" ? 0 : 1;
    if (leftReady !== rightReady) return leftReady - rightReady;
    return providerOrder(left.id) - providerOrder(right.id);
  });
  const rows: Row[] = [];
  for (const provider of providers) {
    for (const model of modelsForProvider(
      provider,
      liveByBackend.get(provider.id),
    )) {
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
  if (provider.auth_status === "ready") {
    return (
      <Badge
        text="available"
        color={BadgeColor.Green}
        className="shrink-0 whitespace-nowrap"
      />
    );
  }
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
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tabSize = isMobile ? TabButtonSize.Large : TabButtonSize.Medium;
  const liveByBackend = useReadyManagedProviderModels(catalog);

  const rows = useMemo(
    () => rowsFor(catalog, query, liveByBackend),
    [catalog, query, liveByBackend],
  );
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
      // Popover's root defaults to `w-fit`, which swallows `w-full` on the trigger.
      className={cn("shrink-0", isMobile && "w-full")}
      panelClassName="p-2 overflow-hidden"
      // The sheet sizes to its content by default (only max-h). Pin the sheet
      // itself to 70dvh — a height on the child alone loses to flex-1 + auto parent.
      sheetClassName="h-[70dvh] max-h-[70dvh] min-h-[70dvh] overflow-hidden [&>*]:min-h-0 [&>*]:h-full [&>*]:flex [&>*]:flex-col"
      content={
        <div
          className={cn(
            "flex flex-col min-h-0",
            isMobile ? "h-full" : "h-[340px]",
          )}
        >
          <div className="shrink-0 p-4 pt-0 md:p-0 md:pb-2">
            <Input
              inputSize={isMobile ? InputSize.Large : InputSize.Medium}
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
          </div>
          <div
            ref={listRef}
            className="flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0"
          >
            {rows.length === 0 ? (
              <p className="px-4 md:px-2 py-3 text-micro text-basic-muted">
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
                  <div
                    key={`${row.provider.id}/${row.model.id}`}
                    className="px-2 md:px-0"
                  >
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
                      size={tabSize}
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
                      {!isMobile ? (
                        <span className="code-small text-basic-muted truncate md:max-w-[180px]">
                          {row.model.id}
                        </span>
                      ) : null}
                      <span className="text-micro text-basic-muted shrink-0">
                        {modelMeta(row.model)}
                      </span>
                    </TabButton>
                  </div>
                );
              })
            )}
          </div>
        </div>
      }
    >
      <Button
        variant={ButtonVariant.Secondary}
        size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
        content={ButtonContent.IconRight}
        disabled={!catalog}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="w-full md:w-[280px]"
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
