import { Fragment } from "react";

import {
  HorizontalTabsItem,
  HorizontalTabsItemContent,
  HorizontalTabsItemSize,
  Icon,
  IconName,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";

const STATES = [
  { label: "Default", active: false, disabled: false },
  { label: "Active", active: true, disabled: false },
  { label: "Disabled", active: false, disabled: true },
  { label: "Active, disabled", active: true, disabled: true },
];

const TAB_VARIANTS = [
  { label: "Regular", variant: TabButtonVariant.Regular },
  { label: "Accent", variant: TabButtonVariant.Accent },
  { label: "Destructive", variant: TabButtonVariant.Destructive },
];

const TAB_SIZES = [
  { label: "small", size: TabButtonSize.Small },
  { label: "medium", size: TabButtonSize.Medium },
  { label: "large", size: TabButtonSize.Large },
];

const ITEM_SIZES = [
  { label: "Small", size: HorizontalTabsItemSize.Small },
  { label: "Medium", size: HorizontalTabsItemSize.Medium },
  { label: "Large", size: HorizontalTabsItemSize.Large },
];

const ITEM_CONTENTS = [
  { label: "Icon left", content: HorizontalTabsItemContent.IconLeft },
  { label: "Icon right", content: HorizontalTabsItemContent.IconRight },
  { label: "Icon", content: HorizontalTabsItemContent.IconOnly },
  { label: "Text", content: HorizontalTabsItemContent.TextOnly },
  { label: "Full", content: HorizontalTabsItemContent.Full },
];

function TabButtonMatrix() {
  return (
    <div className="grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2">
      <span />
      {STATES.map((state) => (
        <span key={state.label} className="type-meta-strong text-basic-muted">
          {state.label}
        </span>
      ))}
      {TAB_VARIANTS.flatMap((variant) =>
        TAB_SIZES.map((size) => (
          <Fragment key={`${variant.label}-${size.label}`}>
            <span className="type-body-chrome text-basic-secondary">
              {variant.label}, {size.label}
            </span>
            {STATES.map((state) => (
              <TabButton
                key={state.label}
                variant={variant.variant}
                size={size.size}
                active={state.active}
                disabled={state.disabled}
              >
                <Icon iconName={IconName.Search} />
                <span className="flex-1 min-w-0 truncate text-left">New session</span>
                <Icon iconName={IconName.Edit} />
              </TabButton>
            ))}
          </Fragment>
        )),
      )}
    </div>
  );
}

function HorizontalTabMatrix() {
  return (
    <div className="grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3">
      <span />
      {ITEM_CONTENTS.map((content) => (
        <span key={content.label} className="type-meta-strong text-basic-muted">
          {content.label}
        </span>
      ))}
      {ITEM_SIZES.flatMap((size) =>
        STATES.map((state) => (
          <Fragment key={`${size.label}-${state.label}`}>
            <span className="type-body-chrome text-basic-secondary">
              {size.label}, {state.label.toLowerCase()}
            </span>
            {ITEM_CONTENTS.map((content) => (
              <HorizontalTabsItem
                key={content.label}
                size={size.size}
                content={content.content}
                active={state.active}
                disabled={state.disabled}
                iconName={IconName.Play}
                trailingIcon={IconName.Right}
                aria-label={
                  content.content === HorizontalTabsItemContent.IconOnly ? "Run" : undefined
                }
              >
                Run
              </HorizontalTabsItem>
            ))}
          </Fragment>
        )),
      )}
    </div>
  );
}

/** Tab button and horizontal tab item, every type and size per state. */
export function TabsPreview() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <span className="type-subheading text-basic-primary">Rows (menus, lists)</span>
        <TabButtonMatrix />
      </div>
      <div className="flex flex-col gap-3">
        <span className="type-subheading text-basic-primary">Tabs</span>
        <HorizontalTabMatrix />
      </div>
    </>
  );
}
