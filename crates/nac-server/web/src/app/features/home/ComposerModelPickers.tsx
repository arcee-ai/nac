import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, IconName, Popover, PopoverPlacement } from "@/app/atoms";
import { ModelFacts } from "@/app/components/modals/CatalogModelPicker";
import { modelsForProvider } from "@/app/components/modals/catalogModelOverlay";
import { EFFORT_LEVEL_OPTIONS, reasoningOptionsFor } from "@/app/components/modals/options";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/app/features/sidebar/MenuItem";
import { catalogBaseUrl, type CatalogPick } from "@/app/lib/catalog";
import { cn } from "@/app/lib/cn";
import { providerAccountLabel, providerOrder } from "@/app/lib/providers";
import { routes } from "@/app/lib/routes";
import {
  speedLabel,
  supportsSpeed,
  type ServiceTier,
  type speedForRoute,
} from "@/app/lib/serviceTier";
import { useModelCatalog, useReadyProviderModels } from "@/app/services/queries";
import type { BackendKind, CatalogModel, ModelCatalog, ReasoningEffort } from "@/app/types/api";

import { Chip } from "./Chip";

type View = "overview" | "speed" | "model";

/** "DeepSeek: DeepSeek V4.1 Flash" reads "DeepSeek V4.1 Flash"; the group already names the vendor. */
function modelName(model: CatalogModel): string {
  const name = model.display_name || model.id;
  return name.replace(/^[^:]+:\s+/, "");
}

/** A submenu's heading, which steps back to the overview. */
function BackHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="type-meta flex h-7 w-full shrink-0 items-center gap-1.5 rounded-md px-1.5 text-left text-basic-tertiary outline-none hover:text-basic-primary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]"
    >
      <Icon iconName={IconName.Left} size={12} className="shrink-0" />
      {label}
    </button>
  );
}

type CatalogProvider = ModelCatalog["providers"][number];

const providerReady = (provider: CatalogProvider) => provider.auth_status === "ready";

/**
 * One composer control for model, reasoning and speed. The current model
 * opens the searchable catalog; the overview exposes the capabilities of
 * just that model and route.
 */
export function ModelPicker({
  fallbackLabel,
  pending,
  value,
  effort,
  supportedEfforts,
  speed,
  disabled,
  placement = PopoverPlacement.BottomLeft,
  usableProvider = providerReady,
  onPick,
  onEffort,
}: {
  /** Shown when the model is not in the catalog (an older saved setup). */
  fallbackLabel: string | null;
  pending: boolean;
  value: { backend: BackendKind; model: string } | null;
  /** A reasoning level; "" uses the model default. */
  effort: string;
  supportedEfforts: readonly ReasoningEffort[];
  speed?: ReturnType<typeof speedForRoute> & {
    value: ServiceTier | null;
    onChange: (tier: ServiceTier | null) => void;
  };
  disabled?: boolean;
  placement?: PopoverPlacement;
  /** Whose models are listed: connected providers unless a host mounts its own. */
  usableProvider?: (provider: CatalogProvider) => boolean;
  /** Rejected selections keep the model list open with an explanation. */
  onPick: (
    pick: CatalogPick,
    clearIncompatibleSpeed: boolean,
  ) => { error: string; confirmSpeedClear?: boolean } | { notice: string } | void;
  onEffort: (effort: string) => void;
}) {
  const navigate = useNavigate();
  const effortGroup = useId();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [confirmPick, setConfirmPick] = useState<CatalogPick | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const catalog = useModelCatalog();
  const live = useReadyProviderModels(catalog.data);

  const connected = useMemo(
    () =>
      (catalog.data?.providers ?? [])
        .filter((provider) => usableProvider(provider) && catalogBaseUrl(provider))
        .sort((left, right) => providerOrder(left.id) - providerOrder(right.id))
        .map((provider) => ({
          provider,
          models: modelsForProvider(provider, live.get(provider.id)),
        })),
    [catalog.data, live, usableProvider],
  );
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return connected.filter((group) => group.models.length > 0);
    return connected
      .map((group) => ({
        ...group,
        models: group.models.filter((model) =>
          `${model.id} ${model.display_name ?? ""}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.models.length > 0);
  }, [connected, filter]);

  const current = value
    ? connected
        .find((group) => group.provider.id === value.backend)
        ?.models.find((model) => model.id === value.model)
    : undefined;
  const name = current ? modelName(current) : fallbackLabel;
  // A model that accepts no explicit level runs without one, shown as None;
  // the server rejects even "none" for it, so choosing None sends nothing.
  const noEfforts = value != null && Boolean(catalog.data) && supportedEfforts.length === 0;
  const efforts = noEfforts
    ? [{ id: "", label: "None" }]
    : reasoningOptionsFor(supportedEfforts, effort, EFFORT_LEVEL_OPTIONS);
  const effortLabel = noEfforts
    ? "None"
    : effort
      ? String(efforts.find((option) => option.id === effort)?.label ?? effort)
      : null;
  const fast = supportsSpeed(speed?.tiers ?? null, "fast");
  const ultra = supportsSpeed(speed?.tiers ?? null, "ultrafast");
  const unavailable = Boolean(
    speed?.value && (!speed.explicitTiersAllowed || !supportsSpeed(speed.tiers, speed.value)),
  );
  const speedChoices = fast || ultra || unavailable;
  const currentSpeedLabel = speedLabel(speed?.value);

  const close = () => {
    setOpen(false);
    setView("overview");
    setFilter("");
    setModelError(null);
    setConfirmPick(null);
    setModelNotice(null);
  };
  const pick = (pick: CatalogPick, clearIncompatibleSpeed = false) => {
    const result = onPick(pick, clearIncompatibleSpeed);
    if (result && "error" in result) {
      setModelError(result.error);
      setConfirmPick(result.confirmSpeedClear ? pick : null);
      return;
    }
    setModelError(null);
    setConfirmPick(null);
    setModelNotice(result?.notice ?? null);
    setFilter("");
    setView("overview");
  };
  const onFilterKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.click();
    }
  };

  const overview = (
    <div className="flex flex-col gap-2 p-1">
      <button
        type="button"
        aria-label={name ? `Choose model: ${name}` : "Choose model"}
        disabled={disabled}
        autoFocus
        onClick={() => setView("model")}
        className="type-label flex min-h-9 items-center justify-center gap-2 rounded-lg px-2 text-basic-primary outline-none hover:bg-[var(--f-wash-1)] focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] max-md:min-h-11"
      >
        <span className="truncate">{name ?? "Choose a model"}</span>
        <Icon iconName={IconName.Right} size={12} className="shrink-0 text-basic-muted" />
      </button>
      {value && !noEfforts ? (
        <fieldset
          className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-[var(--f-wash-1)] p-1.5"
          disabled={disabled}
        >
          <legend className="type-meta px-1 text-basic-secondary">
            Reasoning{effortLabel ? ` · ${effortLabel}` : ""}
          </legend>
          <div
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${efforts.length <= 4 ? efforts.length : Math.ceil(efforts.length / 2)}, minmax(0, 1fr))`,
            }}
          >
            {efforts.map(({ id, label }) => (
              <label key={id} className="cursor-pointer">
                <input
                  type="radio"
                  className="peer sr-only"
                  name={effortGroup}
                  value={id}
                  checked={id === effort}
                  onChange={() => onEffort(String(id))}
                />
                <span className="type-meta flex min-h-8 items-center justify-center rounded-md px-1.5 text-basic-secondary hover:text-basic-primary peer-checked:bg-elevation-level-1 peer-checked:text-basic-primary peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--f-focus)] max-md:min-h-11">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {modelNotice ? (
        <p role="status" className="type-meta px-2 text-basic-secondary">
          {modelNotice}
        </p>
      ) : null}
      {speed && speedChoices ? (
        <div className="flex flex-col gap-1 border-t border-tertiary pt-1">
          {fast && !ultra && !unavailable ? (
            <button
              type="button"
              role="switch"
              aria-label="Fast speed"
              aria-checked={speed.value === "fast"}
              disabled={disabled}
              onClick={() => speed.onChange(speed.value === "fast" ? "standard" : "fast")}
              className="type-label flex min-h-9 items-center justify-between gap-3 rounded-lg px-2 text-basic-primary outline-none hover:bg-[var(--f-wash-1)] focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] max-md:min-h-11"
            >
              <span>Speed</span>
              <span className="flex items-center gap-2">
                <span className="type-meta text-basic-secondary">{currentSpeedLabel}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-9 items-center rounded-pill bg-[var(--f-wash-2)] p-0.5",
                    speed.value === "fast" && "justify-end bg-[var(--f-ink)]",
                  )}
                >
                  <span className="size-4 rounded-pill bg-elevation-level-1 shadow-sm" />
                </span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Speed: ${currentSpeedLabel}${unavailable ? " (unavailable)" : ""}`}
              disabled={disabled}
              onClick={() => setView("speed")}
              className="type-label flex min-h-9 items-center justify-between gap-2 rounded-lg px-2 text-basic-primary outline-none hover:bg-[var(--f-wash-1)] focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] max-md:min-h-11"
            >
              Speed
              <span className="ml-auto truncate text-basic-secondary">
                {currentSpeedLabel}
                {unavailable ? " (unavailable)" : ""}
              </span>
              <Icon iconName={IconName.Right} size={12} className="shrink-0 text-basic-muted" />
            </button>
          )}
          {speed.openAiApi && (fast || ultra) ? (
            <p className="type-meta px-2 pb-1 text-basic-secondary">
              Faster tiers cost more and depend on project access.{" "}
              <a
                className="underline"
                href="https://developers.openai.com/api/docs/pricing"
                target="_blank"
                rel="noreferrer"
              >
                OpenAI pricing
              </a>
              {fast && speed.fastContextLimit != null
                ? `. Fast supports fewer than ${speed.fastContextLimit.toLocaleString()} input tokens.`
                : null}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const availableTiers: ServiceTier[] = [];
  if (speed?.explicitTiersAllowed) availableTiers.push("standard");
  if (fast) availableTiers.push("fast");
  if (ultra) availableTiers.push("ultrafast");

  const speedList = speed ? (
    <div className="flex flex-col gap-0.5">
      <BackHeader label="Speed" onBack={() => setView("overview")} />
      <Menu label="Speed" autoFocus>
        {availableTiers.map((tier) => (
          <MenuItem
            key={tier}
            label={speedLabel(tier)}
            checked={tier === speed.value}
            disabled={disabled}
            onSelect={() => {
              speed.onChange(tier);
              setView("overview");
            }}
          />
        ))}
        {unavailable && !speed.explicitTiersAllowed ? (
          <MenuItem
            label="Clear unavailable speed"
            disabled={disabled}
            onSelect={() => {
              speed.onChange(null);
              setView("overview");
            }}
          />
        ) : null}
      </Menu>
    </div>
  ) : null;

  const modelList = (
    <div className="flex max-h-[min(480px,65vh)] flex-col gap-1 md:max-h-[min(480px,65vh,calc(var(--radix-popover-content-available-height)_-_16px))]">
      <BackHeader
        label="Model"
        onBack={() => {
          setFilter("");
          setView("overview");
          setModelError(null);
          setConfirmPick(null);
        }}
      />
      {modelError ? (
        <p role="alert" className="type-meta px-2.5 text-error-primary">
          {modelError}
        </p>
      ) : null}
      {confirmPick ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => pick(confirmPick, true)}
          className="type-label min-h-9 rounded-md bg-[var(--f-wash-1)] px-2 text-basic-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] max-md:min-h-11"
        >
          Switch model and clear speed
        </button>
      ) : null}
      <input
        autoFocus
        aria-label="Search models"
        placeholder="Search models"
        autoComplete="off"
        spellCheck={false}
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
          setModelError(null);
          setConfirmPick(null);
        }}
        onKeyDown={onFilterKey}
        className="type-body-chrome h-8 w-full shrink-0 rounded-lg border border-tertiary bg-elevation-level-1 px-2.5 text-basic-primary outline-none placeholder:text-basic-muted focus:border-secondary max-md:h-11 max-md:text-base"
      />
      <div ref={list} className="min-h-0 overflow-y-auto">
        <Menu label="Model">
          {catalog.isPending ? (
            <p className="type-meta px-2.5 py-2 text-basic-muted">Loading models…</p>
          ) : catalog.isError ? (
            <p className="type-meta px-2.5 py-2 text-error-primary">
              The model list could not be loaded.
            </p>
          ) : groups.length === 0 ? (
            <p className="type-meta px-2.5 py-2 text-basic-muted">
              {filter ? "No matching models" : "No providers connected"}
            </p>
          ) : (
            groups.map(({ provider, models }) => (
              <div
                key={provider.id}
                role="group"
                aria-label={providerAccountLabel(provider.id)}
                className="flex flex-col gap-0.5"
              >
                <MenuLabel>{providerAccountLabel(provider.id)}</MenuLabel>
                {models.map((model) => (
                  <MenuItem
                    key={model.id}
                    label={modelName(model)}
                    checked={value?.backend === provider.id && value.model === model.id}
                    disabled={disabled}
                    trailing={<ModelFacts model={model} />}
                    onSelect={() =>
                      pick({
                        backend: provider.id,
                        model: model.id,
                        baseUrl: catalogBaseUrl(provider),
                      })
                    }
                  />
                ))}
              </div>
            ))
          )}
        </Menu>
      </div>
      <MenuSeparator />
      <Menu label="Model options">
        <MenuItem
          icon={IconName.Key}
          label="Connect more providers"
          onSelect={() => {
            close();
            navigate(routes.settings("accounts"));
          }}
        />
      </Menu>
    </div>
  );

  return (
    <Popover
      open={open}
      onClose={close}
      sticky
      className="min-w-0 max-w-full"
      placement={placement}
      size={view === "model" ? "w-[360px]" : "w-[280px]"}
      focusScope="Model settings"
      content={view === "speed" ? speedList : view === "model" ? modelList : overview}
    >
      <Chip
        disabled={disabled}
        className="text-basic-primary"
        aria-label={
          name
            ? `Model: ${name}${effortLabel ? `, ${effortLabel} reasoning` : ""}${speed?.value ? `, ${currentSpeedLabel} speed` : ""}`
            : "Choose a model"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {pending ? (
          "Model…"
        ) : (
          <>
            {name ?? "Choose a model"}
            {effortLabel ? <span className="ml-1.5 text-basic-muted">{effortLabel}</span> : null}
            {speed?.value && speed.value !== "standard" ? (
              <span className="ml-1.5 text-basic-muted">{currentSpeedLabel}</span>
            ) : null}
          </>
        )}
      </Chip>
    </Popover>
  );
}
