import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";
import { Icon } from "./icon.js";
import { Button, ButtonSize, ButtonVariant, ButtonContent } from "./button.js";

export const InputSize = {
  Small: "input-small",
  Medium: "input-medium",
  Large: "input-large",
};
export const InputLeading = { None: "none", Icon: "icon", Button: "button" };
export const InputTrailing = { None: "none", Icon: "icon", Button: "button" };

const buttonSizeFor = {
  "input-small": ButtonSize.Small,
  "input-medium": ButtonSize.Medium,
  "input-large": ButtonSize.Large,
};
const iconSizeFor = { "input-small": 16, "input-medium": 20, "input-large": 24 };
const padLeft = { "input-small": "pl-1", "input-medium": "pl-2", "input-large": "pl-3" };
const padRight = { "input-small": "pr-1", "input-medium": "pr-2", "input-large": "pr-3" };
const padLeftIcon = { "input-small": "pl-6", "input-medium": "pl-9", "input-large": "pl-12" };
const padRightIcon = { "input-small": "pr-7", "input-medium": "pr-11", "input-large": "pr-14" };
const leadingIconPos = { "input-small": "top-1 left-1", "input-medium": "top-2 left-2", "input-large": "top-3 left-3" };
const trailingIconPos = { "input-small": "top-1 right-1", "input-medium": "top-2 right-2", "input-large": "top-3 right-3" };

function InputWrapper({ label, required, validation, validationText, hintText, className, children }) {
  return html`
    <div class=${cn("flex text-left flex-col gap-1", className)}>
      ${label
        ? html`<div class="flex gap-2 items-center">
            <label class=${cn("label-small", validation ? "text-error-primary" : "text-basic-secondary")}>${label}</label>
            ${required
              ? html`<div class=${cn("text-micro", validation ? "text-error-secondary" : "text-basic-tertiary")}>* Required</div>`
              : null}
          </div>`
        : null}
      ${children}
      ${validation && validationText
        ? html`<p class="pt-1 text-error-primary text-micro">${validationText}</p>`
        : !validation && hintText
          ? html`<p class="pt-1 text-basic-muted text-micro">${hintText}</p>`
          : null}
    </div>
  `;
}

export function Input({
  inputSize = InputSize.Large,
  leading = InputLeading.None,
  leadingOnClick,
  trailing = InputTrailing.None,
  trailingOnClick,
  leadingIconName = "add",
  trailingIconName = "search",
  inputClassName = "",
  label = "",
  required = false,
  rounded = false,
  placeholder = "",
  isDisabled = false,
  validation = false,
  validationText = "",
  hintText,
  className = "",
  inputRef,
  ...props
}) {
  const inputClasses = cn(
    "w-full input font-normal",
    inputSize,
    inputClassName,
    rounded ? "rounded-full" : "rounded-[4px]",
    leading === InputLeading.None ? padLeft[inputSize] : padLeftIcon[inputSize],
    trailing === InputTrailing.None ? padRight[inputSize] : padRightIcon[inputSize],
    isDisabled && "input-disabled",
    validation && "input-validation",
  );
  const bSize = buttonSizeFor[inputSize];
  const iSize = iconSizeFor[inputSize];

  const content = html`
    <div class="input-wrapper relative w-full h-fit">
      ${leading === InputLeading.Icon
        ? html`<${Icon}
            name=${leadingIconName}
            size=${iSize}
            className=${cn("absolute", leadingIconPos[inputSize])}
            color=${isDisabled ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)"}
          />`
        : null}
      ${leading === InputLeading.Button
        ? html`<${Button}
            size=${bSize}
            variant=${ButtonVariant.Ghost}
            content=${ButtonContent.Icon}
            onClick=${leadingOnClick}
            className=${cn("input-btn-leading", !rounded && "rounded-lg")}
          >
            <${Icon} name=${leadingIconName} />
          </${Button}>`
        : null}

      <input
        ref=${inputRef}
        class=${inputClasses}
        placeholder=${placeholder}
        disabled=${isDisabled}
        ...${props}
      />

      ${trailing === InputTrailing.Icon
        ? html`<${Icon}
            name=${trailingIconName}
            size=${iSize}
            className=${cn("absolute", trailingIconPos[inputSize])}
            color=${isDisabled ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)"}
          />`
        : null}
      ${trailing === InputTrailing.Button
        ? html`<${Button}
            size=${bSize}
            variant=${ButtonVariant.Ghost}
            content=${ButtonContent.Icon}
            onClick=${trailingOnClick}
            className=${cn("input-btn-trailing", !rounded && "rounded-lg")}
          >
            <${Icon} name=${trailingIconName} />
          </${Button}>`
        : null}
    </div>
  `;

  return html`<${InputWrapper}
    label=${label}
    required=${required}
    validation=${validation}
    validationText=${validationText}
    hintText=${hintText}
    className=${className}
    >${content}</${InputWrapper}
  >`;
}
