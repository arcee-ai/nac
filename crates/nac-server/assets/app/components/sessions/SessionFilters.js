import { html } from "../../lib/html.js";
import { Input, InputSize, InputLeading } from "../../atoms/input.js";
import { Select } from "../../atoms/select.js";
import { Button, ButtonSize, ButtonVariant, ButtonContent } from "../../atoms/button.js";
import { SESSION_ENVS } from "../../lib/format.js";
import {
  SORT_ITEMS,
  RANGE_ITEMS,
  setQuery,
  setSort,
  setCreatedRange,
  setModifiedRange,
  toggleEnv,
  toggleModel,
  useQuery,
  useSort,
  useCreatedRange,
  useModifiedRange,
  useSelectedEnvs,
  useSelectedModels,
  useSessionModels,
} from "../../store/sessionFiltersStore.js";

// Chips are Small/Text buttons; the design's 12px inline padding beats the
// atom's 8px, and inline style is the only way to win over `.btn-small.btn-text`.
const CHIP_PADDING = { paddingInline: "12px" };

function Divider() {
  return html`<div class="h-px w-full bg-divider-muted shrink-0"></div>`;
}

function Section({ className = "", children }) {
  return html`<div class=${`flex flex-col gap-4 px-4 py-6 ${className}`}>${children}</div>`;
}

function FilterRow({ label, items, value, onValueChange }) {
  return html`<div class="flex items-center justify-between gap-3">
    <div class="label-small text-basic-secondary shrink-0">${label}</div>
    <${Select}
      items=${items}
      value=${value}
      onValueChange=${onValueChange}
      size=${ButtonSize.Small}
      variant=${ButtonVariant.Secondary}
      className="min-w-0"
      panelClassName="right-0"
    />
  </div>`;
}

function Chips({ label, options, selected, onToggle, emptyText }) {
  return html`<div class="flex flex-col gap-3">
    <div class="label-small text-basic-secondary">${label}</div>
    ${options.length === 0
      ? html`<div class="text-micro text-basic-muted">${emptyText}</div>`
      : html`<div class="flex flex-wrap gap-2">
          ${options.map(
            (option) => html`<${Button}
              key=${option}
              size=${ButtonSize.Small}
              content=${ButtonContent.Text}
              variant=${selected.includes(option)
                ? ButtonVariant.SecondaryAccentHighlighted
                : ButtonVariant.Secondary}
              onClick=${() => onToggle(option)}
              aria-pressed=${selected.includes(option) ? "true" : "false"}
              style=${CHIP_PADDING}
            >
              ${option}
            </${Button}>`,
          )}
        </div>`}
  </div>`;
}

export function SessionFilters() {
  const query = useQuery();
  const sort = useSort();
  const createdRange = useCreatedRange();
  const modifiedRange = useModifiedRange();
  const envs = useSelectedEnvs();
  const models = useSelectedModels();
  const modelOptions = useSessionModels();

  return html`<div class="flex flex-col">
    <${Section}>
      <${Input}
        inputSize=${InputSize.Medium}
        leading=${InputLeading.Icon}
        leadingIconName="search"
        placeholder="Search sessions"
        value=${query}
        onInput=${(e) => setQuery(e.target.value)}
        aria-label="Search sessions"
      />
    </${Section}>
    <${Divider} />
    <${Section}>
      <${FilterRow} label="Sort by" items=${SORT_ITEMS} value=${sort} onValueChange=${setSort} />
      <${FilterRow}
        label="Creation date"
        items=${RANGE_ITEMS}
        value=${createdRange}
        onValueChange=${setCreatedRange}
      />
      <${FilterRow}
        label="Modification date"
        items=${RANGE_ITEMS}
        value=${modifiedRange}
        onValueChange=${setModifiedRange}
      />
    </${Section}>
    <${Divider} />
    <${Section}>
      <${Chips}
        label="Environment"
        options=${SESSION_ENVS}
        selected=${envs}
        onToggle=${toggleEnv}
      />
    </${Section}>
    <${Divider} />
    <${Section}>
      <${Chips}
        label="Model"
        options=${modelOptions}
        selected=${models}
        onToggle=${toggleModel}
        emptyText="No models yet"
      />
    </${Section}>
  </div>`;
}
