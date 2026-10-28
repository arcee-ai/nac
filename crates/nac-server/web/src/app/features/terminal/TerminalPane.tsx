import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  StickyButton,
  TabButton,
  TabButtonSize,
  TerminalTabButton,
  TerminalTabButtonSize,
} from "@/app/atoms";
import { PanelListNote } from "@/app/components/inspector/PanelMessages";
import { PanelEmpty, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type {
  ExecutionHistoryEntry,
  ExecutionStatus,
} from "../../../../packages/nac-client/src/index";
import { HistoryDetail, RecentExecutions } from "./RecentExecutionHistory";
import { NoticeAction, TerminalNotice, TerminalTag } from "./TerminalChrome";
import { ExecutionDetail } from "./TerminalDetail";
import { useExecutionHistory } from "./historyQueries";
import { useExecutions, useOpenUserTerminal, useStopExecution } from "./queries";
import {
  agentTagged,
  executionHeading,
  historyHeading,
  terminalState,
  terminalTitle,
} from "./terminalLabels";
import { useShellController } from "./useInputOwnership";

export interface TerminalSelectionCapture {
  readonly sessionId: string;
  readonly terminalId: string;
  readonly selectedText: string;
  readonly capturedAtMs: string;
  readonly sourceAlive: boolean;
}
export interface TerminalPaneProps {
  sessionId: string;
  onReviewSelection?: (capture: Readonly<TerminalSelectionCapture>) => void;
}

export function TerminalPane(props: TerminalPaneProps) {
  const { api } = useNativeRuntime();
  // A replaced consumer binding discards selection, handles and pending UI work.
  const binding = useMemo(() => ({ api, id: crypto.randomUUID() }), [api]);
  return <TerminalPaneOwner key={`${binding.id}:${props.sessionId}`} {...props} />;
}

function TerminalPaneOwner({ sessionId, onReviewSelection }: TerminalPaneProps) {
  const { showSidePanelList } = useNativeRuntime().stores.sessionLayoutStore;
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const list = useExecutions(sessionId);
  const history = useExecutionHistory(sessionId);
  const open = useOpenUserTerminal(sessionId);
  const [selected, setSelected] = useState<string | null>(null);
  // A recent entry open in the detail, instead of a live terminal.
  const [recent, setRecent] = useState<string | null>(null);
  // Where a narrow header, which the split draws, takes the detail's menu.
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null);
  const launchId = useRef<string | null>(null);
  const terminals = list.data?.executions ?? [];
  const id = selected ?? terminals[0]?.id;
  if (selected == null && terminals[0]) setSelected(terminals[0].id);
  const position = terminals.findIndex((item) => item.id === id);
  const source = recent == null && position >= 0 ? terminals[position] : undefined;
  const controller = useShellController(sessionId, source, false);
  const entry =
    recent == null ? undefined : history.data?.history.entries.find((item) => item.id === recent);
  const heading = entry
    ? historyHeading(entry)
    : source
      ? executionHeading(source, terminalTitle(source, position), controller)
      : undefined;

  const openLive = (item: ExecutionStatus) => {
    setRecent(null);
    setSelected(item.id);
    showSidePanelList(false);
  };
  const openRecent = (item: ExecutionHistoryEntry) => {
    setRecent(item.id);
    showSidePanelList(false);
  };
  const launch = () => {
    launchId.current ??= crypto.randomUUID();
    open.mutate(launchId.current, {
      onSuccess: (result) => {
        setRecent(null);
        setSelected(result.terminal_id);
        launchId.current = null;
        showSidePanelList(false);
      },
    });
  };

  const launchLabel = open.isPending
    ? "Opening shell…"
    : open.isError
      ? "Retry opening same shell"
      : isMobile || isTablet
        ? "New Shell"
        : "New shell";
  const toolbar = isMobile ? (
    <StickyButton
      variant={ButtonVariant.Secondary}
      content={ButtonContent.IconLeft}
      className="mr-1"
      disabled={open.isPending}
      onClick={launch}
    >
      <Icon iconName={IconName.Add} />
      {launchLabel}
    </StickyButton>
  ) : isTablet ? (
    <div className="flex flex-1 min-w-0 items-center gap-[10px] pl-0.5">
      <span className="flex-1 min-w-0 truncate header-sm text-basic-primary">Terminals</span>
      <Button
        size={ButtonSize.Medium}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.IconLeft}
        disabled={open.isPending}
        onClick={launch}
      >
        <Icon iconName={IconName.Add} />
        {launchLabel}
      </Button>
    </div>
  ) : (
    <div className="flex flex-col justify-center gap-1 h-12 p-2 shrink-0 border-b border-muted">
      <TabButton size={TabButtonSize.Small} disabled={open.isPending} onClick={launch}>
        <Icon iconName={IconName.Add} />
        <span className="text-left flex-grow">{launchLabel}</span>
      </TabButton>
    </div>
  );

  const rowSize = isMobile ? TerminalTabButtonSize.Large : TerminalTabButtonSize.Small;
  const rows = (
    // The split insets a desktop column itself; narrower lists still owe the design's.
    <div
      className={cn(
        "flex flex-col gap-1 [&>*]:shrink-0",
        isTablet && "pt-2 pb-4",
        isMobile && "pt-2",
      )}
    >
      {list.isError ? (
        <TerminalNotice
          action={<NoticeAction onClick={() => void list.refetch()}>Refresh</NoticeAction>}
        >
          Shell list unavailable.
        </TerminalNotice>
      ) : null}
      {open.isError ? (
        <TerminalNotice>
          {open.error.message} Opening was not confirmed; retry uses the same launch identity.
        </TerminalNotice>
      ) : null}
      {list.isPending ? <PanelListNote>Loading terminals…</PanelListNote> : null}
      {list.isSuccess && terminals.length === 0 ? (
        <PanelListNote>No terminals are open.</PanelListNote>
      ) : null}
      {terminals.map((item, index) => {
        const open = recent == null && item.id === id;
        return (
          <TerminalRow
            key={item.id}
            sessionId={sessionId}
            source={item}
            label={terminalTitle(item, index)}
            active={open}
            // Narrower layouts draw the list in place of the open terminal.
            beside={open && !isMobile && !isTablet}
            size={rowSize}
            onOpen={() => openLive(item)}
          />
        );
      })}
      <RecentExecutions
        history={history.data?.history}
        pending={history.isPending}
        failed={history.isError}
        openId={recent}
        size={rowSize}
        onOpen={openRecent}
        onRefresh={() => void history.refetch()}
      />
    </div>
  );

  let detail: ReactNode;
  if (recent != null) {
    detail = entry ? (
      <HistoryDetail key={entry.id} sessionId={sessionId} entry={entry} menuSlot={menuSlot} />
    ) : (
      <PanelEmpty>
        {history.isPending
          ? "Loading recent activity…"
          : "Selected activity is no longer in bounded history."}
      </PanelEmpty>
    );
  } else if (source && heading) {
    detail = (
      <ExecutionDetail
        key={`${source.id}:live`}
        sessionId={sessionId}
        source={source}
        heading={heading}
        menuSlot={menuSlot}
        onReviewSelection={onReviewSelection}
      />
    );
  } else if (id) {
    detail = <PanelEmpty>Selected execution unavailable.</PanelEmpty>;
  } else if (list.isPending) {
    detail = <PanelEmpty>Loading executions…</PanelEmpty>;
  } else {
    detail = (
      <PanelEmpty title="No terminal open">
        Open a shell to start typing. Terminal output stays separate from the conversation.
      </PanelEmpty>
    );
  }

  // The phone header insets its trailing control further than the split's.
  const slot = <span ref={setMenuSlot} className={isMobile ? "mr-3 flex shrink-0" : "contents"} />;
  return (
    <section aria-label="Session terminal" className="flex flex-col flex-1 min-h-0">
      <PanelSplit
        listTitle="Terminals"
        listToolbar={toolbar}
        title={heading?.title}
        titleAction={
          isTablet && heading ? (
            // The split spaces its header for a trailing control; the tag sits closer.
            <span className="-ml-0.5 flex shrink-0 items-center gap-2">
              <TerminalTag heading={heading} hint />
            </span>
          ) : null
        }
        actions={
          isMobile ? (
            <>
              {heading?.agent ? (
                <Badge
                  text="Agent"
                  color={BadgeColor.Blue}
                  background={false}
                  className="mr-2 shrink-0"
                />
              ) : null}
              {slot}
            </>
          ) : isTablet ? (
            slot
          ) : null
        }
        list={rows}
      >
        {detail}
      </PanelSplit>
    </section>
  );
}

function TerminalRow({
  sessionId,
  source,
  label,
  active,
  beside,
  size,
  onOpen,
}: {
  sessionId: string;
  source: ExecutionStatus;
  label: string;
  active: boolean;
  /** Open beside the list, whose detail already polls the shell's controller. */
  beside: boolean;
  size: TerminalTabButtonSize;
  onOpen: () => void;
}) {
  const stop = useStopExecution(sessionId, source.id);
  const controller = useShellController(sessionId, source, !beside);
  return (
    <>
      <TerminalTabButton
        label={label}
        agent={agentTagged(source, controller)}
        description={terminalState(source)}
        size={size}
        active={active}
        onClick={onOpen}
        remove={
          source.stop
            ? {
                label: `${source.origin === "human" ? "Close" : "Stop"} ${label}`,
                disabled: stop.isPending,
                onClick: () => stop.mutate(),
              }
            : undefined
        }
      />
      {stop.isError ? (
        <TerminalNotice>
          {stop.error.message} Stop was not confirmed; check its status.
        </TerminalNotice>
      ) : null}
    </>
  );
}
