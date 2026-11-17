import { Fragment } from "react";

import {
  BoxSurface,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
} from "@/app/atoms";
import { TabsPreview } from "@/app/components/pages/design-preview/TabsPreview";

const VARIANTS = [
  { label: "Primary", variant: ButtonVariant.Primary },
  { label: "Secondary", variant: ButtonVariant.Secondary },
  { label: "Secondary highlighted", variant: ButtonVariant.SecondaryHighlighted },
  { label: "Secondary destructive", variant: ButtonVariant.SecondaryDestructive },
  { label: "Secondary accent", variant: ButtonVariant.SecondaryAccent },
  { label: "Secondary accent highlighted", variant: ButtonVariant.SecondaryAccentHighlighted },
  { label: "Ghost", variant: ButtonVariant.Ghost },
  { label: "Ghost highlighted", variant: ButtonVariant.GhostHighlighted },
  { label: "Ghost destructive", variant: ButtonVariant.GhostDestructive },
  { label: "Ghost accent", variant: ButtonVariant.GhostAccent },
  { label: "Ghost highlighted accent", variant: ButtonVariant.GhostHighlightedAccent },
  { label: "Tertiary", variant: ButtonVariant.Tertiary },
  { label: "Tertiary destructive", variant: ButtonVariant.TertiaryDestructive },
  { label: "Tertiary accent", variant: ButtonVariant.TertiaryAccent },
];

const SIZE_VARIANTS = [
  { label: "Secondary", variant: ButtonVariant.Secondary },
  { label: "Ghost highlighted", variant: ButtonVariant.GhostHighlighted },
  { label: "Tertiary", variant: ButtonVariant.Tertiary },
];

const SIZES = [
  { label: "small", size: ButtonSize.Small },
  { label: "medium", size: ButtonSize.Medium },
  { label: "large", size: ButtonSize.Large },
];

const CONTENTS = [
  { label: "Icon", content: ButtonContent.Icon },
  { label: "Icon left", content: ButtonContent.IconLeft },
  { label: "Text", content: ButtonContent.Text },
  { label: "Icon right", content: ButtonContent.IconRight },
];

function Sample({
  variant,
  size = ButtonSize.Medium,
  content = ButtonContent.IconLeft,
  disabled = false,
}: {
  variant: ButtonVariant;
  size?: ButtonSize;
  content?: ButtonContent;
  disabled?: boolean;
}) {
  const iconOnly = content === ButtonContent.Icon;
  return (
    <Button
      variant={variant}
      size={size}
      content={content}
      disabled={disabled}
      aria-label={iconOnly ? "Add" : undefined}
    >
      {iconOnly || content === ButtonContent.IconLeft ? <Icon iconName={IconName.Add} /> : null}
      {iconOnly ? null : "Label"}
      {content === ButtonContent.IconRight ? <Icon iconName={IconName.Right} /> : null}
    </Button>
  );
}

function VariantMatrix() {
  return (
    <div className="grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3">
      <span />
      {["Default", "Disabled", "Icon", "Icon, disabled"].map((label) => (
        <span key={label} className="type-meta-strong text-basic-muted">
          {label}
        </span>
      ))}
      {VARIANTS.map(({ label, variant }) => (
        <Fragment key={label}>
          <span className="type-body-chrome text-basic-secondary">{label}</span>
          <Sample variant={variant} />
          <Sample variant={variant} disabled />
          <Sample variant={variant} content={ButtonContent.Icon} />
          <Sample variant={variant} content={ButtonContent.Icon} disabled />
        </Fragment>
      ))}
    </div>
  );
}

function SizeMatrix() {
  return (
    <div className="grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3">
      <span />
      {CONTENTS.map(({ label }) => (
        <span key={label} className="type-meta-strong text-basic-muted">
          {label}
        </span>
      ))}
      {SIZE_VARIANTS.flatMap((variant) =>
        SIZES.map((size) => (
          <Fragment key={`${variant.label}-${size.label}`}>
            <span className="type-body-chrome text-basic-secondary">
              {variant.label}, {size.label}
            </span>
            {CONTENTS.map(({ label, content }) => (
              <Sample key={label} variant={variant.variant} size={size.size} content={content} />
            ))}
          </Fragment>
        )),
      )}
    </div>
  );
}

/** Hover, press and keyboard focus are live: point at or Tab through a row. */
export function ButtonsSection() {
  return (
    <BoxSurface title="Buttons">
      <div className="p-4 flex flex-col gap-8 overflow-x-auto [&>*]:shrink-0">
        <div className="flex flex-col gap-2">
          <p className="type-body-chrome text-basic-tertiary">
            Every control is a pill. Primary is ink; secondary is a surface with a hairline; ghost
            and tertiary carry no box until hovered. Accent variants are ink washes: there is no
            brand hue. Small 24, medium 32, large 40.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant={ButtonVariant.Primary}>Primary</Button>
            <Button variant={ButtonVariant.Secondary}>Secondary</Button>
            <Button variant={ButtonVariant.Ghost}>Ghost</Button>
            <Button variant={ButtonVariant.Tertiary}>Tertiary</Button>
            <Button variant={ButtonVariant.SecondaryDestructive}>Delete</Button>
            <Button variant={ButtonVariant.GhostDestructive}>Remove</Button>
            <Button variant={ButtonVariant.Primary} loading>
              Loading
            </Button>
            <Button variant={ButtonVariant.Secondary} disabled>
              Disabled
            </Button>
            <Button variant={ButtonVariant.Secondary} content={ButtonContent.IconLeft}>
              <Icon iconName={IconName.Add} />
              New session
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <span className="type-subheading text-basic-primary">Variants and states</span>
          <VariantMatrix />
          <SizeMatrix />
        </div>
        <TabsPreview />
      </div>
    </BoxSurface>
  );
}
