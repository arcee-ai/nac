import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  StickyButton,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useMcpServers } from "@/app/services/queries";

/**
 * The tools a session can reach for are worth one tap from anywhere, so they
 * sit in the bar rather than behind the menu. The phone drops the label and
 * takes the floating pill form the width already uses for its own controls.
 *
 * The count is of servers a new session will actually connect to: a disabled
 * server is kept in the config but never started, so it does not count, and
 * with none enabled the badge is absent rather than a zero.
 */
export function McpServersButton({ onOpen }: { onOpen: () => void }) {
  const isMobile = useIsMobile();
  const { data } = useMcpServers();
  const active = data?.servers.filter((server) => server.enabled).length ?? 0;
  // The badge itself is decorative, so the count rides on the button's name.
  const label = active ? `MCP servers, ${active} active` : "MCP servers";

  return (
    <div className="relative shrink-0">
      {isMobile ? (
        <StickyButton
          variant={ButtonVariant.Ghost}
          content={ButtonContent.Icon}
          aria-label={label}
          onClick={onOpen}
        >
          <Icon iconName={IconName.Toolbox} />
        </StickyButton>
      ) : (
        <Button
          variant={ButtonVariant.Secondary}
          size={ButtonSize.Medium}
          content={ButtonContent.IconLeft}
          aria-label={label}
          onClick={onOpen}
        >
          <Icon iconName={IconName.Toolbox} />
          MCP
        </Button>
      )}
      {active ? (
        <span
          aria-hidden
          className="label-micro pointer-events-none absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 bg-btn-primary text-btn-primary"
        >
          {active}
        </span>
      ) : null}
    </div>
  );
}
