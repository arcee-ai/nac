import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  Separator,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { useStoreInfo } from "@/app/services/queries";

const REPO_URL = "https://github.com/arcee-ai/nac";
const DOCS_URL = "https://github.com/arcee-ai/nac#readme";

/**
 * Everything the bar used to spell out — where the store lives, the docs, the
 * repository — behind one button, alongside the configurations the launch
 * modal otherwise only offers while a session is being created.
 */
export function HeaderMenu({
  onConfigurations,
}: {
  onConfigurations: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: storeInfo } = useStoreInfo();
  const storePath = storeInfo?.store_path ?? "store path pending";

  const act = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const openExternally = (url: string) =>
    act(() => window.open(url, "_blank", "noopener"));

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={PopoverPlacement.BottomLeft}
      size="w-[280px]"
      content={
        <>
          <div className="flex items-center gap-1 h-9 pl-2">
            <span className="label-small text-basic-primary shrink-0">
              Store:
            </span>
            <span
              className="code code-small text-info-primary flex-1 min-w-0 truncate"
              title={storePath}
            >
              {storePath}
            </span>
            <CopyButton
              value={storePath}
              size={ButtonSize.Medium}
              variant={ButtonVariant.Ghost}
              title="Copy the store path"
            />
          </div>
          <Separator />
          <TabButton
            size={TabButtonSize.Medium}
            onClick={act(onConfigurations)}
          >
            <Icon iconName={IconName.Gear} />
            <span className="text-left flex-grow">Configurations</span>
          </TabButton>
          <Separator />
          <TabButton
            size={TabButtonSize.Medium}
            onClick={openExternally(DOCS_URL)}
          >
            <Icon iconName={IconName.Book} />
            <span className="text-left flex-grow">See docs</span>
            <Icon iconName={IconName.External} />
          </TabButton>
          <TabButton
            size={TabButtonSize.Medium}
            onClick={openExternally(REPO_URL)}
          >
            <Icon iconName={IconName.Github} />
            <span className="text-left flex-grow">See Github</span>
            <Icon iconName={IconName.External} />
          </TabButton>
        </>
      }
    >
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Icon}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close the menu" : "Open the menu"}
      >
        <Icon iconName={open ? IconName.Close : IconName.Hamburger} />
      </Button>
    </Popover>
  );
}
