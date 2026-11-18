import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, IconName, Popover, PopoverPlacement } from "@/app/atoms";
import { ModelFacts } from "@/app/components/modals/CatalogModelPicker";
import { modelsForProvider } from "@/app/components/modals/catalogModelOverlay";
import { EFFORT_LEVEL_OPTIONS, reasoningOptionsFor } from "@/app/components/modals/options";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/app/features/sidebar/MenuItem";
import { catalogBaseUrl, type CatalogPick } from "@/app/lib/catalog";
import { providerAccountLabel, providerOrder } from "@/app/lib/providers";
import { routes } from "@/app/lib/routes";
import { useModelCatalog, useReadyProviderModels } from "@/app/services/queries";
import type { BackendKind, CatalogModel, ReasoningEffort } from "@/app/types/api";

import { Chip } from "./Chip";
import type { ModelOverride } from "./modelChoice";
import { catalogOverride } from "./suggestedModel";

const MODEL_DEFAULT = { id: "", label: "Default" };

type View = "overview" | "effort" | "model";

/** "DeepSeek: DeepSeek V4.1 Flash" reads "DeepSeek V4.1 Flash"; the group already names the vendor. */
function modelName(model: CatalogModel): string {
  const name = model.display_name || model.id;
  return name.replace(/^[^:]+:\s+/, "");
}

/** One setting on the overview: its name, its current value, and a way into its list. */
function SettingRow({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      onClick={onOpen}
      className="flex min-h-9 w-full min-w-0 items-center gap-3 rounded-md px-2.5 text-left outline-none transition-colors duration-150 ease-out hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)] motion-reduce:transition-none max-md:min-h-11"
    >
      <span className="type-label shrink-0 text-basic-primary">{label}</span>
      <span className="type-label min-w-0 flex-1 truncate text-right text-basic-tertiary">
        {value}
      </span>
      <Icon iconName={IconName.Right} size={12} className="shrink-0 text-basic-muted" />
    </button>
  );
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

/**
 * The composer's model chip, "GPT-6.1 Sol High": the model this session runs
 * on and its reasoning effort. Opens on an overview of both; each row leads to
 * its own list. Lists every model on a connected provider; accounts and keys
 * are added in Settings.
 */
export function ModelPicker({
  fallbackLabel,
  pending,
  value,
  effort,
  supportedEfforts,
  inheritedLabel,
  usingInherited,
  disabled,
  onPick,
  onEffort,
  onUseInherited,
  onAdvanced,
}: {
  /** Shown when the model is not in the catalog (an older saved setup). */
  fallbackLabel: string | null;
  pending: boolean;
  value: { backend: BackendKind; model: string } | null;
  /** "" is the model's own default. */
  effort: string;
  supportedEfforts: readonly ReasoningEffort[];
  /** The project's own model, offered as a way back after picking another. */
  inheritedLabel: string | null;
  usingInherited: boolean;
  disabled?: boolean;
  onPick: (override: ModelOverride) => void;
  onEffort: (effort: string) => void;
  onUseInherited: () => void;
  /** Light-model and preset options, where orchestration still offers them. */
  onAdvanced?: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const catalog = useModelCatalog();
  const live = useReadyProviderModels(catalog.data);

  const connected = useMemo(
    () =>
      (catalog.data?.providers ?? [])
        .filter((provider) => provider.auth_status === "ready" && catalogBaseUrl(provider))
        .sort((left, right) => providerOrder(left.id) - providerOrder(right.id))
        .map((provider) => ({
          provider,
          models: modelsForProvider(provider, live.get(provider.id)),
        })),
    [catalog.data, live],
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
  const efforts = reasoningOptionsFor(supportedEfforts, effort, [
    MODEL_DEFAULT,
    ...EFFORT_LEVEL_OPTIONS,
  ]);
  const effortLabel = effort
    ? String(efforts.find((option) => option.id === effort)?.label ?? effort)
    : null;

  const close = () => {
    setOpen(false);
    setView("overview");
    setFilter("");
  };
  const pick = (pick: CatalogPick) => {
    if (!catalog.data) return;
    onPick(catalogOverride(catalog.data, pick));
    close();
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
    <Menu label="Model settings" autoFocus>
      {value ? (
        <SettingRow
          label="Effort"
          value={effortLabel ?? "Default"}
          onOpen={() => setView("effort")}
        />
      ) : null}
      {value ? <MenuSeparator /> : null}
      <SettingRow label="Model" value={name ?? "Choose"} onOpen={() => setView("model")} />
    </Menu>
  );

  const effortList = (
    <div className="flex flex-col gap-0.5">
      <BackHeader label="Effort" onBack={() => setView("overview")} />
      <Menu label="Effort" autoFocus>
        {efforts.map((option) => (
          <MenuItem
            key={option.id}
            label={option.label}
            checked={option.id === effort}
            onSelect={() => {
              onEffort(String(option.id));
              setView("overview");
            }}
          />
        ))}
      </Menu>
    </div>
  );

  const modelList = (
    <div className="flex max-h-[min(480px,65vh)] flex-col gap-1">
      <BackHeader
        label="Model"
        onBack={() => {
          setFilter("");
          setView("overview");
        }}
      />
      <input
        autoFocus
        aria-label="Search models"
        placeholder="Search models"
        autoComplete="off"
        spellCheck={false}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={onFilterKey}
        className="type-body-chrome h-8 w-full shrink-0 rounded-lg border border-tertiary bg-elevation-level-1 px-2.5 text-basic-primary outline-none placeholder:text-basic-muted focus:border-secondary max-md:h-11 max-md:text-base"
      />
      <div ref={list} className="min-h-0 overflow-y-auto">
        <Menu label="Model">
          {inheritedLabel && !filter ? (
            <>
              <MenuItem
                label={inheritedLabel}
                hint="Project default"
                checked={usingInherited}
                onSelect={() => {
                  onUseInherited();
                  close();
                }}
              />
              <MenuSeparator />
            </>
          ) : null}
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
              <div key={provider.id} className="flex flex-col gap-0.5">
                <MenuLabel>{providerAccountLabel(provider.id)}</MenuLabel>
                {models.map((model) => (
                  <MenuItem
                    key={model.id}
                    label={modelName(model)}
                    checked={
                      !usingInherited && value?.backend === provider.id && value.model === model.id
                    }
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
        {onAdvanced ? (
          <MenuItem
            icon={IconName.Controls}
            label="Light model and presets…"
            onSelect={() => {
              close();
              onAdvanced();
            }}
          />
        ) : null}
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
      placement={PopoverPlacement.BottomLeft}
      size={view === "model" ? "w-[360px]" : "w-[280px]"}
      content={view === "effort" ? effortList : view === "model" ? modelList : overview}
    >
      <Chip
        disabled={disabled}
        className="text-basic-primary"
        aria-label={
          name
            ? `Model: ${name}${effortLabel ? `, ${effortLabel} reasoning` : ""}`
            : "Choose a model"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {pending ? (
          "Model…"
        ) : (
          <>
            {name ?? "Choose a model"}
            {effortLabel ? <span className="ml-1.5 text-basic-muted">{effortLabel}</span> : null}
          </>
        )}
      </Chip>
    </Popover>
  );
}
