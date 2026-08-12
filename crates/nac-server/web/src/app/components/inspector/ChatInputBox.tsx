import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  KeyboardShortcut,
  Loader,
  LoaderSize,
  StickyButton,
  Popover,
  PopoverPlacement,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { SshBadge } from "@/app/components/SshBadge";
import {
  resolveCatalogModel,
  type ResolvedCatalogModel,
} from "@/app/lib/catalog";
import { cn } from "@/app/lib/cn";
import {
  displayPromptFromMessageText,
  ENV_SSH,
  formatClock,
  formatCostMicros,
  formatTokensCompact,
  runMetrics,
  sessionEnvLabel,
} from "@/app/lib/format";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { useNow } from "@/app/hooks/useNow";
import { usePromptHistoryPreview } from "@/app/hooks/usePromptHistoryPreview";
import { perfRender } from "@/app/lib/perfDebug";
import { humanErrorText } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  useCompactSession,
  useModelCatalog,
  useSshConnect,
  useSubmitRun,
  useSlashCommands,
} from "@/app/services/queries";
import { consumePromptRequests } from "@/app/store/composerStore";
import {
  pushLocalEvent,
  useRunUsage,
  useRunning,
} from "@/app/store/runtimeStore";
import {
  markSshConnected,
  markSshDisconnected,
  sshTargetFromSummary,
  useSshConnectionStatus,
} from "@/app/store/sshConnectionStore";
import type {
  SlashCommandDefinition,
  ManagedSessionSummary,
  SessionSnapshotResponse,
} from "@/app/types/api";

const PLACEHOLDER = "Ask anything…";

/** Says the key is there, on a session that has prompts to walk back through. */
const HISTORY_PLACEHOLDER = "Ask anything, or press ↑ for an earlier prompt";

/** One line of the field, which is also its collapsed height. */
const ROW_PX = { mobile: 40, wide: 48 };

/** How far the field grows before it starts scrolling instead. */
const MAX_HEIGHT_PX = { mobile: 128, wide: 200 };

interface SlashCommandQuery {
  leadingWhitespace: string;
  prefix: string;
}

function slashCommandQuery(value: string): SlashCommandQuery | null {
  const match = /^(\s*)\/(\S*)$/u.exec(value);
  if (!match || match[0] !== value) return null;
  const prefix = match[2];
  if (prefix.includes("/") || prefix.includes("\\")) return null;
  return { leadingWhitespace: match[1], prefix };
}

function submittedSlashCommand(
  value: string,
  definitions: SlashCommandDefinition[],
): SlashCommandDefinition | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  const nameEnd = body.search(/\s/u);
  const name = nameEnd === -1 ? body : body.slice(0, nameEnd);
  const argumentsText = nameEnd === -1 ? "" : body.slice(nameEnd).trim();
  return (
    definitions.find(
      (definition) =>
        definition.name === name &&
        (definition.accepts_arguments || !argumentsText),
    ) ?? null
  );
}

/**
 * TopBar's HeaderSurface upside down. The phone composer floats over the
 * transcript rather than sitting in a card, so the ground fades in beneath it
 * and takes the scrolling messages with it.
 */
const GROUND_FADE_UP = {
  backgroundImage:
    "linear-gradient(to top, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))",
};

interface ChatInputBoxProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
}

function StatBadge({
  iconName,
  prefix,
  value,
  iconSize = 14,
  className,
  title,
  showIcon = true,
  labelClassName = "label-micro",
}: {
  iconName?: IconName;
  prefix?: string;
  value: string;
  iconSize?: 14 | 16;
  className?: string;
  title: string;
  showIcon?: boolean;
  labelClassName?: string;
}) {
  return (
    <Tooltip title={title} position={TooltipPosition.TopCenter}>
      <div
        className={cn(
          "flex items-center gap-[2px] py-1 whitespace-nowrap",
          className,
        )}
      >
        {prefix ? (
          <span className={labelClassName}>{prefix}</span>
        ) : showIcon && iconName ? (
          <Icon iconName={iconName} size={iconSize} />
        ) : null}
        <span className={labelClassName}>{value}</span>
      </div>
    </Tooltip>
  );
}

/**
 * Context reading against the catalog's window: "6.8K / 200K" for a model the
 * catalog knows, and the same with an "est." marker and no percentage when the
 * window is only the provider's default — the figure itself is a guess then.
 */
function contextGauge(
  used: number | null,
  resolved: ResolvedCatalogModel,
): { value: string; title: string } {
  const tokens = formatTokensCompact(used);
  const window = resolved.contextWindow;
  if (!window || used == null) {
    return { value: tokens, title: "Orchestrator context" };
  }
  const limit = formatTokensCompact(window);
  if (resolved.estimated) {
    return {
      value: `${tokens} / ${limit} est.`,
      title: `Orchestrator context against ${resolved.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate`,
    };
  }
  return {
    value: `${tokens} / ${limit}`,
    title: `Orchestrator context — ${Math.round((used / window) * 100)}% of the model's context window`,
  };
}

/**
 * Message field plus the run status bar that replaced the old metrics grid:
 * model, environment, cumulative token usage and the run timer.
 */
export function ChatInputBox({
  sessionId,
  snapshot,
  entry,
}: ChatInputBoxProps) {
  perfRender("ChatInputBox");
  const [value, setValue] = useState("");
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  // Everything narrower than the desktop column drops what will not fit there:
  // the model name, the per-direction token columns and the timer's glyph.
  const narrow = isMobile || isTablet;
  // A phone keeps the message on one truncated line until the field is focused,
  // then grows the pill over the transcript.
  const [focused, setFocused] = useState(false);
  const [dismissedSuggestionValue, setDismissedSuggestionValue] = useState<
    string | null
  >(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  // The pointer's row is held apart from the keyboard's so that leaving the list
  // takes the highlight with it instead of stranding it on the last row crossed.
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(
    null,
  );
  const collapsed = isMobile && !focused;
  const rowPx = isMobile ? ROW_PX.mobile : ROW_PX.wide;
  const maxHeightPx = isMobile ? MAX_HEIGHT_PX.mobile : MAX_HEIGHT_PX.wide;
  const running = useRunning();
  const toast = useToast();
  const actions = useSessionActions();
  const submitRun = useSubmitRun();
  const compactSession = useCompactSession();
  const {
    data: commandDefinitions,
    isError: commandsFailed,
    refetch: refetchCommands,
  } = useSlashCommands();
  const ref = useRef<HTMLTextAreaElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const submitInFlight = useRef(false);
  const listboxId = useId();

  // The snapshot only accounts for a run once it ends, so while one is going
  // the stream's own tally is what keeps these counters moving.
  const runUsage = useRunUsage();
  const metrics = runMetrics(snapshot, entry, running ? runUsage : null);
  const backend = entry?.summary.backend ?? snapshot?.metadata.backend ?? null;
  const catalog = useModelCatalog();
  const context = contextGauge(
    metrics.usage?.total_tokens ?? null,
    resolveCatalogModel(
      catalog.data,
      snapshot?.metadata?.backend,
      metrics.model,
    ),
  );
  const now = useNow(1000, running);
  const elapsedMs = metrics.startedAt
    ? now - metrics.startedAt
    : metrics.lastResponseMs;

  const sshTarget = sshTargetFromSummary(entry?.summary);
  const sshStatus = useSshConnectionStatus(sshTarget);
  const connectSsh = useSshConnect();
  const isSsh = sessionEnvLabel(entry?.summary) === ENV_SSH;

  const busy = submitRun.isPending || compactSession.isPending || running;
  const canSend = Boolean(value.trim()) && !busy;

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = `${rowPx}px`;
    el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`;
  }, [rowPx, maxHeightPx]);

  // Prompts already sent, newest first, in the short form the bubbles show —
  // a `/plan` or `/run` message goes back to the instruction it was written as
  // rather than to the wrapper the orchestrator reads.
  const sentPrompts = useMemo(() => {
    const prompts: string[] = [];
    for (const message of snapshot?.messages ?? []) {
      if (message.role !== "user") continue;
      prompts.push(displayPromptFromMessageText(message.content));
    }
    return prompts.reverse();
  }, [snapshot?.messages]);

  const history = usePromptHistoryPreview({
    prompts: sentPrompts,
    value,
    // A phone has no key to walk with, and its placeholder is already standing
    // in for the collapsed line.
    enabled: !isMobile,
    setValue,
    textareaRef: ref,
    afterCommit: resize,
  });
  const resetHistory = history.reset;
  const previewHelpId = useId();

  // The walk belongs to the session whose prompts it is walking.
  useEffect(() => resetHistory(), [sessionId, resetHistory]);

  const commandQuery = useMemo(() => slashCommandQuery(value), [value]);
  const filteredCommands = useMemo(() => {
    if (!commandQuery || !commandDefinitions) return [];
    const prefix = commandQuery.prefix.toLocaleLowerCase();
    return commandDefinitions.filter((definition) =>
      definition.name.toLocaleLowerCase().startsWith(prefix),
    );
  }, [commandDefinitions, commandQuery]);
  const suggestionsOpen =
    focused && commandQuery !== null && dismissedSuggestionValue !== value;
  // A narrower query can leave the keyboard's highlight past the last row.
  const keyboardSuggestion = Math.min(
    activeSuggestion,
    Math.max(filteredCommands.length - 1, 0),
  );
  // What Tab and Enter would take, which is whatever is lit: the pointer
  // outranks the keyboard while it is in the list.
  const suggestionIndex =
    hoveredSuggestion !== null && hoveredSuggestion < filteredCommands.length
      ? hoveredSuggestion
      : keyboardSuggestion;
  const activeOptionId =
    suggestionsOpen && filteredCommands[suggestionIndex]
      ? `${listboxId}-option-${suggestionIndex}`
      : undefined;

  // Only the keyboard's row: scrolling a row the pointer is already on would
  // move the list out from under it.
  useEffect(() => {
    if (!suggestionsOpen) return;
    optionRefs.current[keyboardSuggestion]?.scrollIntoView({
      block: "nearest",
    });
  }, [keyboardSuggestion, suggestionsOpen, filteredCommands]);

  // A list that closes under a resting pointer sends no leave event, and a
  // stale row would light on the way back in.
  const dismissSuggestions = useCallback(() => {
    setDismissedSuggestionValue(value);
    setHoveredSuggestion(null);
  }, [value]);

  const completeCommand = useCallback(
    (definition: SlashCommandDefinition) => {
      if (!commandQuery) return;
      const completed = `${commandQuery.leadingWhitespace}/${definition.name}${
        definition.accepts_arguments ? " " : ""
      }`;
      setValue(completed);
      setDismissedSuggestionValue(completed);
      setHoveredSuggestion(null);
      requestAnimationFrame(() => {
        const textarea = ref.current;
        if (!textarea) return;
        resize();
        textarea.focus();
        textarea.setSelectionRange(completed.length, completed.length);
      });
    },
    [commandQuery, resize],
  );

  // A collapsed field is one line whatever it holds, which is a height it
  // cannot work out for itself; leaving the collapse restores the content's.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (collapsed) {
      el.style.height = `${ROW_PX.mobile}px`;
      el.style.overflow = "hidden";
    } else {
      el.style.overflow = "";
      resize();
    }
  }, [collapsed, resize]);

  /** Tapping the collapsed line means "carry on typing", so the caret goes last. */
  const focusEnd = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // iOS Safari honours the properties but not setSelectionRange here, and
    // only once the field has actually taken the focus.
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const end = ref.current.value.length;
      ref.current.selectionStart = end;
      ref.current.selectionEnd = end;
      ref.current.scrollTop = ref.current.scrollHeight;
    });
  }, []);

  const reconnectSsh = useCallback(async () => {
    if (!sshTarget || connectSsh.isPending) return;
    try {
      await connectSsh.mutateAsync(sshTarget);
      markSshConnected(sshTarget);
    } catch (error) {
      markSshDisconnected(sshTarget);
      toast.error(`SSH reconnect failed: ${errorMessage(error)}`);
    }
  }, [sshTarget, connectSsh, toast]);

  /**
   * Sends `text`, or whatever the field holds when called without one. A
   * starter prompt arrives as an argument and leaves the field alone, so an
   * unsent draft survives being overtaken by one.
   */
  const submit = useCallback(
    async (text: string = value) => {
      const prompt = text.trim();
      if (!prompt || busy || submitInFlight.current) return;
      const fromField = text === value;
      const clearField = () => {
        if (!fromField) return;
        setValue("");
        resetHistory();
        if (ref.current) ref.current.style.height = `${rowPx}px`;
      };
      submitInFlight.current = true;

      try {
        let definitions = commandDefinitions;
        if (text.trimStart().startsWith("/") && definitions === undefined) {
          const result = await refetchCommands();
          definitions = result.data;
          if (definitions === undefined) {
            toast.error("Unable to load slash commands");
            return;
          }
        }

        const command = definitions
          ? submittedSlashCommand(text, definitions)
          : null;
        if (command?.command === "compact") {
          try {
            await compactSession.mutateAsync(sessionId);
            pushLocalEvent("compaction", "▶ compacting context…");
            clearField();
          } catch (error) {
            pushLocalEvent(
              "error",
              `compact failed: ${errorMessage(error)}`,
              true,
            );
            toast.error(`Failed to compact: ${humanErrorText(error, backend)}`);
          }
          return;
        }
        if (command) {
          toast.error(`Unsupported slash command: /${command.name}`);
          return;
        }
        try {
          await submitRun.mutateAsync({ id: sessionId, prompt });
          pushLocalEvent("run", `▶ submitted: ${prompt.slice(0, 80)}`);
          clearField();
        } catch (error) {
          pushLocalEvent(
            "error",
            `submit failed: ${errorMessage(error)}`,
            true,
          );
          toast.error(`Failed to send: ${humanErrorText(error, backend)}`);
        }
      } finally {
        submitInFlight.current = false;
      }
    },
    [
      value,
      backend,
      busy,
      commandDefinitions,
      refetchCommands,
      sessionId,
      submitRun,
      compactSession,
      toast,
      rowPx,
      resetHistory,
    ],
  );

  // A starter prompt goes out on its own; it is already a whole instruction,
  // and the field is where it would otherwise have to be confirmed.
  useEffect(
    () => consumePromptRequests((prompt) => void submit(prompt)),
    [submit],
  );

  const stop = useCallback(async () => {
    const summary = entry?.summary;
    if (summary) await actions.stopRun(summary);
  }, [actions, entry]);

  const settingsButton = (
    <Tooltip title="Session settings" position={TooltipPosition.TopLeft}>
      <Button
        // A phone gets the design's 40px circle around a 24px glyph; the status
        // bar it sits in elsewhere has room for the 24px square only.
        className={isMobile ? "btn-round" : undefined}
        size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label="Session settings"
        onClick={() => actions.settings(sessionId)}
      >
        <Icon iconName={IconName.Gear} size={isMobile ? undefined : 16} />
      </Button>
    </Tooltip>
  );

  const sendIcon = <Icon iconName={running ? IconName.Stop : IconName.Plane} />;
  const sendLabel = running ? "Stop run" : "Send";
  const sendType = running ? "button" : "submit";
  const sendDisabled = !running && !canSend;
  const onSend = running ? () => void stop() : undefined;

  const sendButton = isMobile ? (
    <StickyButton
      className="shrink-0"
      variant={ButtonVariant.Primary}
      content={ButtonContent.Icon}
      type={sendType}
      disabled={sendDisabled}
      aria-label={sendLabel}
      onClick={onSend}
    >
      {sendIcon}
    </StickyButton>
  ) : (
    <Button
      className="absolute bottom-0 right-0"
      size={ButtonSize.Large}
      variant={ButtonVariant.Primary}
      content={ButtonContent.Icon}
      type={sendType}
      disabled={sendDisabled}
      aria-label={sendLabel}
      onClick={onSend}
    >
      {sendIcon}
    </Button>
  );

  const field = (
    <div
      className={cn(
        "relative flex items-end",
        isMobile
          ? cn(
              "flex-1 min-w-0 rounded-[20px] bg-elevation-level-3 shadow-2xl overflow-hidden",
              // The reserved lane is the settings glyph's, so an expanded pill
              // — which hides that glyph — takes the width back.
              collapsed && "pr-[40px]",
            )
          : "rounded-[4px] bg-input shadow-concave pr-[48px]",
      )}
    >
      <div className="relative flex-1 min-w-0">
        <span
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {suggestionsOpen
            ? commandDefinitions === undefined
              ? commandsFailed
                ? "Slash commands unavailable"
                : "Loading slash commands"
              : filteredCommands.length
                ? `${filteredCommands.length} slash ${
                    filteredCommands.length === 1 ? "command" : "commands"
                  } available`
                : "No matching commands"
            : ""}
        </span>
        <textarea
          ref={ref}
          className={cn(
            "block w-full bg-transparent resize-none border-none outline-none text-medium  text-input placeholder:text-input-placeholder",
            isMobile ? "px-4 py-2" : "p-3",
            // The line below stands in for it while it is a single row, because
            // a textarea cannot ellipsize its own overflow.
            collapsed && "opacity-0 pointer-events-none",
          )}
          rows={1}
          role="combobox"
          aria-label="Message"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={suggestionsOpen}
          aria-controls={suggestionsOpen ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-describedby={history.active ? previewHelpId : undefined}
          // A preview stands where the placeholder would, rather than in the
          // field, so an earlier prompt can be read before it is taken. The row
          // below draws it, hence the blank here.
          placeholder={
            history.active
              ? ""
              : history.hasHistory && value === ""
                ? HISTORY_PLACEHOLDER
                : PLACEHOLDER
          }
          spellCheck={false}
          value={value}
          style={{ minHeight: `${rowPx}px`, maxHeight: `${maxHeightPx}px` }}
          onChange={(e) => {
            if (e.target.value !== value) setDismissedSuggestionValue(null);
            setActiveSuggestion(0);
            // A pointer resting over the list sends nothing while the rows
            // change underneath it, so its position no longer means the row it
            // meant.
            setHoveredSuggestion(null);
            history.onValueChange(e.target.value);
            setValue(e.target.value);
            resize();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setHoveredSuggestion(null);
            resetHistory();
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (suggestionsOpen && !e.shiftKey) {
              if (e.key === "Escape") {
                e.preventDefault();
                dismissSuggestions();
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!filteredCommands.length) return;
                // From the lit row, so the keyboard carries on from where the
                // pointer left the highlight rather than jumping back to its
                // own last position.
                setActiveSuggestion(
                  e.key === "ArrowDown"
                    ? Math.min(
                        suggestionIndex + 1,
                        filteredCommands.length - 1,
                      )
                    : Math.max(suggestionIndex - 1, 0),
                );
                setHoveredSuggestion(null);
                return;
              }
              if (e.key === "Tab" && filteredCommands[suggestionIndex]) {
                e.preventDefault();
                completeCommand(filteredCommands[suggestionIndex]);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const selected = filteredCommands[suggestionIndex];
                if (selected) completeCommand(selected);
                return;
              }
            }
            if (history.onKeyDown(e)) return;
            if (e.key !== "Enter") return;
            // Shift+Enter inserts a newline; a bare Enter (or Cmd/Ctrl+Enter) sends.
            if (e.shiftKey) return;
            e.preventDefault();
            void submit();
          }}
        />
        {history.active ? (
          <>
            <span id={previewHelpId} className="sr-only">
              Press Tab to take this prompt, Escape to leave it, or start typing
              to dismiss it
            </span>
            {/* The preview is drawn here rather than left to the native
                placeholder, which cannot be measured — this way the key that
                takes it sits against the end of the text however long it is. */}
            <div className="pointer-events-none absolute inset-0 flex items-center gap-2 px-3">
              <span className="min-w-0 truncate text-medium text-input-placeholder">
                {history.previewText}
              </span>
              <KeyboardShortcut keys={["tab"]} spelled className="shrink-0" />
            </div>
          </>
        ) : null}
        {collapsed ? (
          <div
            className="absolute inset-0 flex items-center px-4 cursor-text"
            onClick={focusEnd}
          >
            <span
              className={cn(
                "w-full truncate text-medium",
                value ? "text-input" : "text-input-placeholder",
              )}
            >
              {value || PLACEHOLDER}
            </span>
          </div>
        ) : null}
      </div>
      {/* On a phone the settings glyph rides inside the pill until the field
          takes over the width, and Send always sits outside it. */}
      {!isMobile ? (
        sendButton
      ) : collapsed ? (
        <div className="absolute top-0 right-0">{settingsButton}</div>
      ) : null}
    </div>
  );

  const suggestions = (
    <div id={listboxId} role="listbox" aria-label="Slash commands">
      {commandDefinitions === undefined ? (
        <div className="px-3 py-2 text-small text-basic-secondary">
          {commandsFailed ? "Slash commands unavailable" : "Loading commands…"}
        </div>
      ) : filteredCommands.length ? (
        filteredCommands.map((definition, index) => (
          <button
            key={definition.command}
            id={`${listboxId}-option-${index}`}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="option"
            aria-selected={index === suggestionIndex}
            tabIndex={-1}
            className={cn(
              "flex min-h-10 w-full items-center gap-3 rounded-[4px] px-3 py-2 text-left",
              index === suggestionIndex
                ? "btn-ghost-highlighted"
                : "btn-ghost",
            )}
            onPointerDown={(event) => event.preventDefault()}
            // Move rather than enter: a list that opens under a still pointer
            // keeps the highlight the keyboard put on the first row.
            onPointerMove={() => setHoveredSuggestion(index)}
            onPointerLeave={() =>
              setHoveredSuggestion((current) =>
                current === index ? null : current,
              )
            }
            onClick={() => completeCommand(definition)}
          >
            <span className="code code-small shrink-0 text-basic-primary">
              /{definition.name}
            </span>
            <span className="min-w-0 text-small text-basic-secondary">
              {definition.description}
            </span>
          </button>
        ))
      ) : (
        <div className="px-3 py-2 text-small text-basic-secondary">
          No matching commands
        </div>
      )}
    </div>
  );

  const fieldWithSuggestions = (
    <Popover
      open={suggestionsOpen}
      onClose={dismissSuggestions}
      content={suggestions}
      placement={PopoverPlacement.TopRight}
      sticky
      closeOnEscape={false}
      sheetOnMobile={false}
      className={isMobile ? "flex-1 min-w-0" : "w-full"}
      size="w-[min(400px,calc(100vw-16px))]"
      panelClassName="max-h-[min(40vh,320px)] overflow-y-auto"
    >
      {field}
    </Popover>
  );

  return (
    <form
      className={cn(
        "flex flex-col",
        isMobile
          ? "gap-3 px-4 pt-8 pb-8"
          : isTablet
            ? "gap-3 px-2 pt-2 pb-4 rounded-[12px] bg-elevation-level-1 shadow-2xl"
            : "gap-4 p-4 rounded-[8px] bg-elevation-level-1 shadow-2xl",
      )}
      style={isMobile ? GROUND_FADE_UP : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const selected = suggestionsOpen
          ? filteredCommands[activeSuggestion]
          : undefined;
        if (selected) {
          completeCommand(selected);
          return;
        }
        void submit();
      }}
    >
      {isMobile ? (
        <div className="flex items-end gap-2">
          {fieldWithSuggestions}
          {sendButton}
        </div>
      ) : (
        fieldWithSuggestions
      )}

      {/* The status line wraps rather than letting its `shrink-0` chips run
          into each other once the chat column is narrow. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-[10px]",
          // The glyph inside the pill already carries the row's left margin.
          isMobile && "pl-2",
        )}
      >
        <div className="flex flex-1 min-w-0 flex-wrap items-center gap-y-1 gap-x-4">
          {/* A phone's settings glyph lives in the pill instead. */}
          {isMobile ? null : settingsButton}

          {/* The model name is the first thing a narrow column gives up; the
              same switch lives in the session settings the gear opens. */}
          {narrow ? null : (
            <ModelPicker
              sessionId={sessionId}
              metadata={snapshot?.metadata ?? null}
              label={metrics.model}
              disabled={busy}
            />
          )}

          {isSsh ? (
            <SshBadge
              state={sshStatus === "connected" ? "connected" : "reconnect"}
              onReconnect={() => void reconnectSsh()}
            />
          ) : (
            <span className="text-[10px] leading-[12px] font-medium uppercase text-basic-tertiary shrink-0">
              {metrics.env}
            </span>
          )}

          {metrics.usage ? (
            <div className="flex items-center gap-[2px] min-w-0">
              {/* The backend reports the live context window here, not a sum
                  of the columns beside it. */}
              <StatBadge
                iconName={IconName.Timelaps}
                value={context.value}
                className="text-info-primary"
                title={context.title}
                labelClassName="tag-label"
              />
              {/* The per-direction columns go with the model name, leaving the
                  narrow row the reading that matters. */}
              {narrow ? null : (
                <>
                  <StatBadge
                    iconName={IconName.ArrowTop}
                    value={formatTokensCompact(metrics.usage.input_tokens)}
                    className="text-info-secondary opacity-75"
                    title="Input tokens"
                    labelClassName="tag-label"
                  />
                  {metrics.usage.cache_read_tokens > 0 ? (
                    <StatBadge
                      prefix="C"
                      value={formatTokensCompact(
                        metrics.usage.cache_read_tokens,
                      )}
                      className="text-info-secondary opacity-75"
                      title="Cache read tokens"
                      labelClassName="tag-label"
                    />
                  ) : null}
                  <StatBadge
                    iconName={IconName.ArrowDown}
                    value={formatTokensCompact(metrics.usage.output_tokens)}
                    className="text-info-secondary opacity-75"
                    title="Output tokens"
                    labelClassName="tag-label"
                  />
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-[10px] shrink-0">
          {/* Priced from the model catalog, so a model the catalog has no
              rates for shows "--" rather than a misleading zero. */}
          {metrics.usage ? (
            <StatBadge
              iconName={IconName.Price}
              iconSize={16}
              value={formatCostMicros(metrics.usage.cost?.total)}
              className="text-basic-primary"
              title="Session cost"
              showIcon={false}
            />
          ) : null}

          <Tooltip
            title={running ? "Run elapsed" : "Last response time"}
            position={TooltipPosition.TopRight}
          >
            <div
              className={cn(
                "flex items-center gap-1 p-1 shrink-0 label-micro",
                running ? "text-basic-primary" : "text-basic-tertiary",
              )}
            >
              {/* The narrow row reads as the bare clock, with the Stop
                  affordance beside the field carrying the run's state. */}
              {narrow ? null : running ? (
                <Loader size={LoaderSize.Small} />
              ) : (
                <Icon iconName={IconName.History} size={16} />
              )}
              <span className="block w-[40px] text-center">
                {formatClock(elapsedMs)}
              </span>
            </div>
          </Tooltip>
        </div>
      </div>
    </form>
  );
}
