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
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
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
  onSshConfigs,
  onMcpServers,
}: {
  onConfigurations: () => void;
  onSshConfigs: () => void;
  onMcpServers: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data: storeInfo } = useStoreInfo();
  const storePath = storeInfo?.store_path ?? "store path pending";
  // The sheet is a touch surface, so its rows follow the design's 48px item.
  // The size class also scales the glyphs from 20px to 24px.
  const itemSize = isMobile ? TabButtonSize.Large : TabButtonSize.Medium;

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
      panelClassName="p-1"
      sheetClassName="px-2"
      content={
        <div className="flex flex-col gap-2">
          <div
            className={cn(
              "flex items-center",
              isMobile ? "h-16 gap-2 pl-4 pr-2" : "h-9 gap-1 pl-2",
            )}
          >
            <span
              className={cn(
                "text-basic-primary shrink-0",
                isMobile ? "label-medium" : "label-small",
              )}
            >
              Store:
            </span>
            <span
              className={cn(
                "code text-info-primary flex-1 min-w-0 truncate",
                isMobile ? "code-medium" : "code-small",
              )}
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
          <TabButton size={itemSize} onClick={act(onConfigurations)}>
            <Icon iconName={IconName.Gear} />
            <span className="text-left flex-grow">Configurations</span>
          </TabButton>
          <TabButton size={itemSize} onClick={act(onSshConfigs)}>
            <Icon iconName={IconName.Globe} />
            <span className="text-left flex-grow">SSH configs</span>
          </TabButton>
          <TabButton size={itemSize} onClick={act(onMcpServers)}>
            <Icon iconName={IconName.Toolbox} />
            <span className="text-left flex-grow">MCP servers</span>
          </TabButton>
          <Separator />
          <TabButton size={itemSize} onClick={openExternally(DOCS_URL)}>
            <Icon iconName={IconName.Book} />
            <span className="text-left flex-grow">See docs</span>
            <Icon iconName={IconName.External} />
          </TabButton>
          <TabButton size={itemSize} onClick={openExternally(REPO_URL)}>
            <Icon iconName={IconName.Github} />
            <span className="text-left flex-grow">See Github</span>
            <Icon iconName={IconName.External} />
          </TabButton>
        </div>
      }
    >
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Icon}
        className={cn(isMobile && "btn-round")}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close the menu" : "Open the menu"}
      >
        <Icon iconName={open ? IconName.Close : IconName.Hamburger} />
      </Button>
    </Popover>
  );
}
