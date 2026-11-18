import { ComposerAttention } from "@/app/features/attention/ComposerAttention";
import { TerminalSelectionAttachment } from "@/app/features/terminal-selection/TerminalSelectionAttachment";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { shellInput } from "@/app/features/human-shell/input";
import { useShellPresentation } from "@/app/features/human-shell/presentationLifetime";
import { useSubmitShellCommand } from "@/app/features/human-shell/queries";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  KeyboardShortcut,
  Popover,
  PopoverPlacement,
} from "@/app/atoms";
import { ComposerCard, ComposerFrame } from "@/app/components/inspector/composer/ComposerFrame";
import {
  ComposerFooter,
  type SubmitMode,
} from "@/app/components/inspector/composer/ComposerFooter";
import type { ComposerToken } from "@/app/components/inspector/composer/ComposerMenu";
import { useCoarsePointer } from "@/app/components/inspector/composer/useCoarsePointer";
import { deliverPrompt, runCommand } from "@/app/features/direct-session/commandWorkflow";
import { isGoalContinuationEnvelope } from "@/app/features/goals/continuation";
import { withPromptRecovery } from "@/app/features/direct-session/promptRecovery";
import { PromptRecoveryMessage } from "./PromptRecoveryMessage";
import { GoalComposer } from "@/app/components/inspector/GoalComposer";
import { SubagentSessionComposer } from "@/app/components/inspector/SubagentComposer";
import { cn } from "@/app/lib/cn";
import {
  displayPromptFromMessageText,
  ENV_SSH,
  runMetrics,
  sessionEnvLabel,
  tokenUsage,
} from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { usePromptHistoryPreview } from "@/app/hooks/usePromptHistoryPreview";
import { perfRender } from "@/app/lib/perfDebug";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import {
  skillReferenceQuery,
  skillReferenceSegments,
  type SkillReferenceSegment,
} from "@/app/lib/skillReferences";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  useCompactSession,
  useCancelInboxItem,
  useClearGoal,
  useCreateGoal,
  useCreateInboxItem,
  useSessionGoal,
  useSessionInbox,
  useSshConnect,
  useSessionSkills,
  useSubmitRun,
  useSlashCommands,
  useUpdateGoal,
  useUpdateInboxItem,
} from "@/app/services/queries";

import type {
  SkillCatalogEntry,
  SlashCommandDefinition,
  InboxDelivery,
  ManagedSessionSummary,
  SessionSnapshotResponse,
} from "@/app/types/api";

const PLACEHOLDER = "Send a message";

/** One line of the field, which is also its collapsed height. */
const ROW_PX = { mobile: 40, wide: 48 };

/** How far the field grows before it starts scrolling instead. */
const MAX_HEIGHT_PX = 180;

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
      (definition) => definition.name === name && (definition.accepts_arguments || !argumentsText),
    ) ?? null
  );
}

interface TextSelection {
  start: number;
  end: number;
}

type SuggestionOption =
  | {
      kind: "slash";
      key: string;
      name: string;
      description: string;
      definition: SlashCommandDefinition;
    }
  | {
      kind: "skill";
      key: string;
      name: string;
      description: string;
      definition: SkillCatalogEntry;
    };

function suggestionIdentity(
  kind: SuggestionOption["kind"],
  value: string,
  start: number,
  end: number,
): string {
  return `${kind}:${start}:${end}:${value}`;
}

const SKILL_EMPHASIS_STYLE = {
  WebkitTextStroke: "0.45px currentColor",
};

/** The message text, its skill mirror and the collapsed line share one face. */
const FIELD_TEXT = "text-[15px] leading-6 [@media(pointer:coarse)]:text-[16px]";

function highlightedSkillText(segments: SkillReferenceSegment[]) {
  return segments.map((segment, index) =>
    segment.skillName ? (
      <strong
        key={`${segment.skillName}-${index}`}
        className="rounded-xs bg-[var(--f-wash-3)] [font-weight:inherit] text-basic-primary"
        style={SKILL_EMPHASIS_STYLE}
      >
        {segment.text}
      </strong>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}

interface ChatInputBoxProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
}

/**
 * The floating composer: the attention card stacked above it, the message
 * field, and one row of controls under it — `+`, model, permission mode and
 * Send in its context ring.
 */
export function ChatInputBox({ sessionId, snapshot, entry }: ChatInputBoxProps) {
  const runtime = useNativeRuntime();
  const shellPresentation = useShellPresentation(runtime, sessionId);
  const { useSshConnectionStatus, sshTargetFromSummary, markSshDisconnected, markSshConnected } =
    useNativeRuntime().stores.sshConnectionStore;

  const {
    useSessionSpend,
    useRunning,
    useStreamStatus,
    useRunUsage,
    useCancelArmed,
    pushLocalEvent,
    liftSessionSpend,
    captureRuntimeActivation,
  } = useNativeRuntime().stores.runtimeStore;

  const { consumePromptRequests, consumeDraftRequests, shellIntents } =
    useNativeRuntime().stores.composerStore;

  perfRender("ChatInputBox");
  const drafts = runtime.stores.promptDraftStore;
  const draft = drafts.useDraft(sessionId);
  const { text: value } = draft;
  const retentionLimited = drafts.useRetentionLimited();
  const submissionPending = drafts.useSubmitting(sessionId);
  const recoveries = [...drafts.useUnreviewed(sessionId), ...drafts.useRecoveries(sessionId)];
  const setValue = useCallback(
    (text: string) => {
      drafts.update(sessionId, text);
    },
    [drafts, sessionId],
  );
  const isMobile = useIsMobile();
  // A touch screen's Enter is a newline, as on a phone. Undefined outside a
  // browser, which reads as a fine pointer.
  const coarsePointer = useCoarsePointer() === true;
  const navigate = useNavigate();
  const [focused, setFocused] = useState(false);
  const [permissionSheet, setPermissionSheet] = useState<{
    open: boolean;
    focusKey: string | null;
  }>({ open: false, focusKey: null });
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  // The pointer's row is held apart from the keyboard's so that leaving the list
  // takes the highlight with it instead of stranding it on the last row crossed.
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(null);
  const rowPx = isMobile ? ROW_PX.mobile : ROW_PX.wide;
  // A message the field is not editing rests on one truncated line.
  const collapsed = !focused && value !== "";
  const running = useRunning(sessionId);
  const streamStatus = useStreamStatus();
  const stopping = useCancelArmed(sessionId);
  const toast = useToast();
  const actions = useSessionActions();
  const submitRun = useSubmitRun();
  const submitShell = useSubmitShellCommand(sessionId);
  const compactSession = useCompactSession();
  const createInboxItem = useCreateInboxItem();
  const updateInboxItem = useUpdateInboxItem();
  const cancelInboxItem = useCancelInboxItem();
  const behavior = entry?.summary.behavior ?? snapshot?.metadata.behavior ?? null;
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const lineage = entry?.lineage ?? snapshot?.lineage ?? null;
  const readOnly = lineage != null;
  const ownershipKnown = entry !== null || snapshot !== null;
  const inboxQuery = useSessionInbox(sessionId, direct && !readOnly);
  // Read while rendering, or its one-second poll re-renders the whole box each
  // time a fetch starts or ends rather than only when the goal changes.
  const { data: storedGoal, refetch: refetchGoal } = useSessionGoal(sessionId, direct && !readOnly);
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const clearGoal = useClearGoal();
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalSessionId, setGoalSessionId] = useState(sessionId);
  if (goalSessionId !== sessionId) {
    setGoalSessionId(sessionId);
    setGoalEditing(false);
  }
  // The editor replaces the field, which may never fire its blur.
  const openGoalEditor = useCallback(() => {
    setFocused(false);
    setGoalEditing(true);
  }, []);
  const {
    data: commandDefinitions,
    isError: commandsFailed,
    refetch: refetchCommands,
  } = useSlashCommands(sessionId);
  const { data: skillDefinitions, isError: skillsFailed } = useSessionSkills(sessionId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const completionCaretRef = useRef<number | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  // The snapshot only accounts for a run once it ends, so while one is going
  // (or Stopping, before persist lands) the stream's own tally keeps the
  // session spend from dropping back to the previous turn. After Stop the
  // snapshot can briefly be zeros — sessionSpend is the floor that never
  // drops while this tab is open.
  const runUsage = useRunUsage();
  const sessionSpend = useSessionSpend();
  useEffect(() => {
    liftSessionSpend(tokenUsage(snapshot));
  }, [liftSessionSpend, snapshot]);
  const metrics = runMetrics(snapshot, entry, running || stopping ? runUsage : null, sessionSpend);
  const backend = entry?.summary.backend ?? snapshot?.metadata.backend ?? null;
  const persistedUsage = tokenUsage(snapshot);
  // A fork inherits context but not spend, so the gauge must not depend on
  // billed usage being present.
  const contextTokens = metrics.usage?.total_tokens || persistedUsage?.total_tokens || null;

  const sshTarget = sshTargetFromSummary(entry?.summary);
  const sshStatus = useSshConnectionStatus(sshTarget);
  const connectSsh = useSshConnect();
  const isSsh = sessionEnvLabel(entry?.summary) === ENV_SSH;

  const runningDirect = running && direct && !readOnly;
  const runningInteractive = runningDirect;
  const mutationPending =
    submissionPending ||
    submitRun.isPending ||
    submitShell.isPending ||
    compactSession.isPending ||
    createInboxItem.isPending ||
    updateInboxItem.isPending ||
    cancelInboxItem.isPending ||
    createGoal.isPending ||
    updateGoal.isPending ||
    clearGoal.isPending;
  const busy = mutationPending || stopping || (running && !runningInteractive);
  const canSend = Boolean(value.trim()) && !busy;
  const pendingItems = (inboxQuery.data ?? []).filter((item) => item.status === "pending");
  // Only submitted input is editable here. Delegated results are consumed by
  // delivery and the server refuses to change them, so only a count is shown.
  const pendingInbox = pendingItems.filter((item) => item.origin === "input");
  const pendingDelegatedResults = pendingItems.length - pendingInbox.length;
  const changeInboxDelivery = async (
    itemId: number,
    expectedVersion: number,
    delivery: InboxDelivery,
  ) => {
    try {
      await updateInboxItem.mutateAsync({ sessionId, itemId, expectedVersion, delivery });
    } catch (error) {
      toast.error(`Unable to change pending message: ${errorMessage(toRunError(error))}`);
    }
  };
  const cancelPendingInbox = async (itemId: number, expectedVersion: number) => {
    try {
      await cancelInboxItem.mutateAsync({ sessionId, itemId, expectedVersion });
    } catch (error) {
      toast.error(`Unable to cancel pending message: ${errorMessage(toRunError(error))}`);
    }
  };

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = `${rowPx}px`;
    if (collapsed) return;
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [collapsed, rowPx]);

  // Tapping the collapsed line carries on writing, so the caret goes last.
  const focusEnd = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // iOS Safari honours the properties but not setSelectionRange here, and
    // only once the field has actually taken the focus.
    requestAnimationFrame(() => {
      const textarea = ref.current;
      if (!textarea) return;
      const end = textarea.value.length;
      textarea.selectionStart = end;
      textarea.selectionEnd = end;
      setSelection({ start: end, end });
      textarea.scrollTop = textarea.scrollHeight;
    });
  }, []);

  useLayoutEffect(() => {
    const caret = completionCaretRef.current;
    const textarea = ref.current;
    if (caret === null || !textarea) return;
    completionCaretRef.current = null;
    resize();
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  }, [resize, value]);

  // Prompts already sent, newest first, in the short form the bubbles show —
  // a `/plan` or `/run` message goes back to the instruction it was written as
  // rather than to the wrapper the orchestrator reads.
  const sentPrompts = useMemo(() => {
    const prompts: string[] = [];
    for (const message of snapshot?.messages ?? []) {
      // A goal continuation is NAC's control message, not something typed.
      if (message.role !== "user" || isGoalContinuationEnvelope(message.content)) continue;
      prompts.push(displayPromptFromMessageText(message.content));
    }
    return prompts.reverse();
  }, [snapshot?.messages]);

  const history = usePromptHistoryPreview({
    prompts: sentPrompts,
    value,
    // A phone has no key to walk with.
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
    return commandDefinitions.filter(
      (definition) =>
        (definition.name !== "goal" || direct) &&
        definition.name.toLocaleLowerCase().startsWith(prefix),
    );
  }, [commandDefinitions, commandQuery, direct]);
  const skillQuery = useMemo(
    () => skillReferenceQuery(value, selection.start, selection.end, skillDefinitions ?? []),
    [selection, skillDefinitions, value],
  );
  const pendingSkillQuery = useMemo(() => {
    if (
      commandQuery !== null ||
      skillDefinitions !== undefined ||
      selection.start === 0 ||
      selection.start !== selection.end
    ) {
      return null;
    }
    const marker = value.lastIndexOf("$", selection.start - 1);
    if (marker === -1) return null;
    return {
      start: marker,
      end: selection.end,
    };
  }, [commandQuery, selection, skillDefinitions, value]);
  const suggestionKind = commandQuery ? "slash" : skillQuery || pendingSkillQuery ? "skill" : null;
  const options = useMemo<SuggestionOption[]>(() => {
    if (suggestionKind === "slash") {
      return filteredCommands.map((definition) => ({
        kind: "slash",
        key: definition.command,
        name: `/${definition.name}`,
        description: definition.description,
        definition,
      }));
    }
    if (suggestionKind === "skill" && skillQuery) {
      return skillQuery.entries.map((definition) => ({
        kind: "skill",
        key: definition.name,
        name: `$${definition.name}`,
        description: definition.description,
        definition,
      }));
    }
    return [];
  }, [filteredCommands, skillQuery, suggestionKind]);
  const currentSuggestionIdentity =
    suggestionKind === "slash"
      ? suggestionIdentity("slash", value, 0, value.length)
      : suggestionKind === "skill"
        ? suggestionIdentity(
            "skill",
            value,
            skillQuery?.start ?? pendingSkillQuery?.start ?? selection.start,
            skillQuery?.end ?? pendingSkillQuery?.end ?? selection.end,
          )
        : null;
  const suggestionsOpen =
    focused && suggestionKind !== null && currentSuggestionIdentity !== dismissedSuggestion;
  // A narrower query can leave the keyboard's highlight past the last row.
  const keyboardSuggestion = Math.min(activeSuggestion, Math.max(options.length - 1, 0));
  // What Tab and Enter would take, which is whatever is lit: the pointer
  // outranks the keyboard while it is in the list.
  const suggestionIndex =
    hoveredSuggestion !== null && hoveredSuggestion < options.length
      ? hoveredSuggestion
      : keyboardSuggestion;
  const selectedSuggestion = suggestionsOpen ? options[suggestionIndex] : undefined;
  const activeOptionId = selectedSuggestion ? `${listboxId}-option-${suggestionIndex}` : undefined;
  const preserveSuggestionFocus = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (selectedSuggestion) event.preventDefault();
    },
    [selectedSuggestion],
  );

  // Only the keyboard's row: scrolling a row the pointer is already on would
  // move the list out from under it.
  useEffect(() => {
    if (!suggestionsOpen) return;
    optionRefs.current[keyboardSuggestion]?.scrollIntoView({
      block: "nearest",
    });
  }, [keyboardSuggestion, suggestionsOpen, options]);

  // A list that closes under a resting pointer sends no leave event, and a
  // stale row would light on the way back in.
  const dismissSuggestions = useCallback(() => {
    setDismissedSuggestion(currentSuggestionIdentity);
    setHoveredSuggestion(null);
  }, [currentSuggestionIdentity]);

  const completeSuggestion = useCallback(
    (option: SuggestionOption) => {
      let completed: string;
      let caret: number;
      let dismissed: string;
      if (option.kind === "slash") {
        if (!commandQuery) return;
        completed = `${commandQuery.leadingWhitespace}/${option.definition.name}${
          option.definition.accepts_arguments ? " " : ""
        }`;
        caret = completed.length;
        dismissed = suggestionIdentity("slash", completed, 0, completed.length);
      } else {
        if (!skillQuery) return;
        const reference = `$${option.definition.name}`;
        completed = `${value.slice(0, skillQuery.start)}${reference}${value.slice(skillQuery.end)}`;
        caret = skillQuery.start + reference.length;
        dismissed = suggestionIdentity("skill", completed, skillQuery.start, caret);
      }
      if (completed === value) {
        completionCaretRef.current = null;
        resize();
        ref.current?.focus();
        ref.current?.setSelectionRange(caret, caret);
      } else {
        completionCaretRef.current = caret;
        setValue(completed);
      }
      setSelection({ start: caret, end: caret });
      setDismissedSuggestion(dismissed);
      setHoveredSuggestion(null);
    },
    [commandQuery, resize, setValue, skillQuery, value],
  );

  const skillSegments = useMemo(
    () => skillReferenceSegments(value, skillDefinitions ?? []),
    [skillDefinitions, value],
  );
  const mirrorActive =
    !history.active && skillSegments.some((segment) => segment.skillName !== null);
  // The collapsed line draws the highlights itself.
  const mirrorShown = mirrorActive && !collapsed;

  // Before the mirror sync below, which reads the scroll the new height leaves.
  useLayoutEffect(() => resize(), [resize, value]);

  useLayoutEffect(() => {
    const textarea = ref.current;
    const mirror = mirrorRef.current;
    if (!mirrorShown || !textarea || !mirror) return;
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }, [mirrorShown, value]);

  const reconnectSsh = useCallback(async () => {
    if (!sshTarget || connectSsh.isPending) return;
    try {
      await connectSsh.mutateAsync(sshTarget);
      markSshConnected(sshTarget);
    } catch (error) {
      markSshDisconnected(sshTarget);
      toast.error(`SSH reconnect failed: ${errorMessage(toRunError(error))}`);
    }
  }, [sshTarget, connectSsh, markSshConnected, markSshDisconnected, toast]);

  const runGoalCommand = useCallback(
    async (text: string) => {
      if (!direct) throw new Error("Durable goals are available only in direct chats");
      const current = captureRuntimeActivation(sessionId);
      let goal = storedGoal;
      if (goal === undefined) {
        const result = await refetchGoal();
        if (!current()) return false;
        if (result.error) throw result.error;
        goal = result.data;
      }

      const argument = text.trim().slice("/goal".length).trim();
      if (argument === "" || argument === "edit") {
        openGoalEditor();
        return;
      }
      if (argument === "clear") {
        if (!goal) throw new Error("There is no durable goal to clear");
        await clearGoal.mutateAsync({
          sessionId,
          goalId: goal.goal_id,
          expectedVersion: goal.version,
        });
        return;
      }
      if (argument === "pause" || argument === "resume") {
        if (!goal) throw new Error(`There is no durable goal to ${argument}`);
        await updateGoal.mutateAsync({
          sessionId,
          goalId: goal.goal_id,
          payload: {
            expected_version: goal.version,
            status: argument === "pause" ? "paused" : "active",
          },
        });
        return;
      }
      if (goal && goal.status !== "complete") {
        throw new Error(
          "An unfinished durable goal already exists; use /goal edit or /goal clear first",
        );
      }
      await createGoal.mutateAsync({ sessionId, payload: { objective: argument } });
    },
    [
      captureRuntimeActivation,
      clearGoal,
      createGoal,
      direct,
      openGoalEditor,
      storedGoal,
      refetchGoal,
      sessionId,
      updateGoal,
    ],
  );

  /**
   * Sends `text`, or whatever the field holds when called without one. A
   * starter prompt arrives as an argument and leaves the field alone, so an
   * unsent draft survives being overtaken by one.
   */
  const submit = useCallback(
    async (requestedText?: string, requestedDelivery?: InboxDelivery, firstPrompt = false) => {
      const text = requestedText ?? value;
      const input = firstPrompt ? { kind: "prompt" as const, prompt: text } : shellInput(text);
      const prompt = firstPrompt
        ? text
        : input.kind === "prompt"
          ? input.prompt.trim()
          : text.trim();
      if (!prompt || busy) return;
      const fromField =
        firstPrompt || requestedText === undefined || requestedDelivery !== undefined;
      const submittedDraft = drafts.get(sessionId);
      const current = captureRuntimeActivation(sessionId);
      const clearField = () => {
        if (!fromField || !drafts.acknowledge(sessionId, submittedDraft)) return;
        if (!current()) return;
        setSelection({ start: 0, end: 0 });
        resetHistory();
        if (ref.current) ref.current.style.height = `${rowPx}px`;
      };
      const finishSubmission = drafts.claimSubmission(sessionId);
      if (!finishSubmission) return;

      try {
        if (input.kind === "command") {
          const lease = shellPresentation.current;
          const shellCurrent = () => current() && !!lease?.current();
          const retrying =
            shellIntents.get(sessionId)?.phase === "uncertain" &&
            shellIntents.get(sessionId)?.request.command === input.command;
          if (
            !direct ||
            readOnly ||
            (!retrying &&
              (running ||
                (snapshot?.shell_commands ?? []).some(
                  (command) => command.state === "accepted" || command.state === "started",
                )))
          ) {
            toast.error("Shell commands require an idle direct-primary chat");
            return;
          }
          if (!input.command.trim()) {
            toast.error("Enter a command after !");
            return;
          }
          try {
            await submitShell.mutateAsync(input.command);
            clearField();
          } catch (error) {
            if (shellCurrent()) toast.error(`Command outcome: ${errorMessage(toRunError(error))}`);
          }
          return;
        }
        let definitions = commandDefinitions;
        if (!firstPrompt && text.trimStart().startsWith("/") && definitions === undefined) {
          const result = await refetchCommands();
          if (!current()) return;
          definitions = result.data;
          if (definitions === undefined) {
            toast.error("Unable to load slash commands");
            return;
          }
        }

        const command =
          !firstPrompt && definitions ? submittedSlashCommand(text, definitions) : null;
        if (command?.command === "compact") {
          try {
            await compactSession.mutateAsync(sessionId);
            clearField();
            if (!current()) return;
            pushLocalEvent("compaction", "▶ compacting context…");
          } catch (error) {
            if (!current()) return;
            pushLocalEvent("error", `compact failed: ${errorMessage(toRunError(error))}`, true);
            toast.error(`Failed to compact: ${humanErrorText(toRunError(error), backend)}`);
          }
          return;
        }
        if (command?.command === "goal") {
          try {
            const result = await runGoalCommand(prompt);
            if (result !== false) clearField();
          } catch (error) {
            if (!current()) return;
            toast.error(`Goal command failed: ${humanErrorText(toRunError(error))}`);
          }
          return;
        }
        if (command && command.command !== "mcp_prompt") {
          toast.error(`Unsupported slash command: /${command.name}`);
          return;
        }
        try {
          const result = await withPromptRecovery(
            drafts,
            sessionId,
            fromField ? submittedDraft : undefined,
            () =>
              runCommand(
                deliverPrompt({
                  mode: runningDirect ? "direct-running" : "idle",
                  delivery: requestedDelivery,
                  inbox: (delivery) => createInboxItem.mutateAsync({ sessionId, delivery, prompt }),
                  submit: () => submitRun.mutateAsync({ id: sessionId, prompt }),
                }),
              ),
          );
          clearField();
          if (!current()) return;
          if (result === "submitted") pushLocalEvent("run", `▶ submitted: ${prompt.slice(0, 80)}`);
          else if (runningDirect || requestedDelivery) {
            pushLocalEvent("steering", `▶ ${requestedDelivery ?? "steer"}: ${prompt.slice(0, 80)}`);
          }
        } catch (error) {
          if (!current()) return;
          pushLocalEvent("error", `submit failed: ${errorMessage(toRunError(error))}`, true);
          toast.error(`Failed to send: ${humanErrorText(toRunError(error), backend)}`);
        }
      } finally {
        finishSubmission();
      }
    },
    [
      value,
      drafts,
      busy,
      captureRuntimeActivation,
      sessionId,
      resetHistory,
      rowPx,
      commandDefinitions,
      refetchCommands,
      submitShell,
      shellIntents,
      shellPresentation,
      direct,
      readOnly,
      running,
      snapshot?.shell_commands,
      toast,
      compactSession,
      pushLocalEvent,
      backend,
      runGoalCommand,
      runningDirect,
      createInboxItem,
      submitRun,
    ],
  );

  // Home's create-and-send intent belongs to this exact draft and may run only
  // after the real session stream establishes an interactive approval owner.
  const { useFirstPrompt, takeFirstPrompt, cancelFirstPrompt } = runtime.stores.composerStore;
  const firstPrompt = useFirstPrompt(sessionId);
  const firstPromptActivation = useRef<{ sessionId: string; token: object } | null>(null);
  useEffect(() => {
    const token = {};
    firstPromptActivation.current = { sessionId, token };
    return () =>
      queueMicrotask(() => {
        if (
          firstPromptActivation.current?.sessionId !== sessionId ||
          firstPromptActivation.current.token === token
        )
          cancelFirstPrompt(sessionId);
      });
  }, [sessionId, cancelFirstPrompt]);
  useEffect(() => {
    if (!firstPrompt || streamStatus !== "live" || !ownershipKnown || busy) return;
    if (runtime.stores.runtimeStore.getRuntimeState().sessionId !== sessionId) return;
    if (!takeFirstPrompt(sessionId, firstPrompt)) return;
    if (drafts.get(sessionId) === firstPrompt) void submit(undefined, undefined, true);
  }, [
    firstPrompt,
    streamStatus,
    ownershipKnown,
    busy,
    sessionId,
    takeFirstPrompt,
    drafts,
    submit,
    runtime,
  ]);

  // A starter prompt goes out on its own; it is already a whole instruction,
  // and the field is where it would otherwise have to be confirmed.
  useEffect(
    () => consumePromptRequests((prompt) => void submit(prompt)),
    [consumePromptRequests, submit],
  );
  useEffect(() => {
    let focusFrame: number | undefined;
    const unsubscribe = consumeDraftRequests(sessionId, (text) => {
      setValue(text);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => ref.current?.focus());
    });
    return () => {
      unsubscribe();
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    };
  }, [sessionId, consumeDraftRequests, setValue]);

  const stop = useCallback(async () => {
    await actions.stopRun(sessionId);
  }, [actions, sessionId]);

  // One compaction path for the slash command's sibling under the context ring.
  const compactContext = useCallback(async () => {
    if (compactSession.isPending) return;
    const current = captureRuntimeActivation(sessionId);
    try {
      await compactSession.mutateAsync(sessionId);
      if (!current()) return;
      pushLocalEvent("compaction", "▶ compacting context…");
    } catch (error) {
      if (!current()) return;
      pushLocalEvent("error", `compact failed: ${errorMessage(toRunError(error))}`, true);
      toast.error(`Failed to compact: ${humanErrorText(toRunError(error), backend)}`);
    }
  }, [backend, captureRuntimeActivation, compactSession, pushLocalEvent, sessionId, toast]);

  /**
   * Starts a `/`, `$` or `!` in the field from the `+` menu, so the field's
   * own suggestions take it from there. `/` and `!` stand for the whole
   * message and only start an empty one; `$` goes in at the caret.
   */
  const insertToken = useCallback(
    (token: ComposerToken) => {
      const textarea = ref.current;
      let next: string;
      let caret: number;
      if (token === "$") {
        const at = textarea?.selectionEnd ?? value.length;
        const before = value.slice(0, at);
        const pad = before && !/\s$/u.test(before) ? " " : "";
        next = `${before}${pad}$${value.slice(at)}`;
        caret = at + pad.length + 1;
      } else {
        if (value.trim()) return;
        next = token;
        caret = 1;
      }
      setDismissedSuggestion(null);
      setActiveSuggestion(0);
      setHoveredSuggestion(null);
      setSelection({ start: caret, end: caret });
      if (next === value) {
        textarea?.focus();
        textarea?.setSelectionRange(caret, caret);
        return;
      }
      completionCaretRef.current = caret;
      setValue(next);
    },
    [setValue, value],
  );

  const filled = Boolean(value.trim());
  // An empty field during a run is the stop control. Text turns it back into
  // send, which says what it will do: Send, or Steer while a run is going.
  const submitMode: SubmitMode = stopping
    ? "stopping"
    : running && !filled
      ? "stop"
      : runningInteractive
        ? "steer"
        : "send";

  // The text, its skill mirror and the lines drawn over it share one inset.
  const textInset = isMobile ? "py-2 px-2.5" : "py-3 px-3";

  const suggestionStatus = suggestionsOpen
    ? suggestionKind === "slash"
      ? commandDefinitions === undefined
        ? commandsFailed
          ? "Slash commands unavailable"
          : "Loading slash commands"
        : options.length
          ? `${options.length} slash ${options.length === 1 ? "command" : "commands"} available`
          : "No matching commands"
      : skillDefinitions === undefined
        ? skillsFailed
          ? "Skills unavailable"
          : "Loading skills"
        : `${options.length} ${options.length === 1 ? "skill" : "skills"} available`
    : "";

  const field = (
    <div className="flex min-w-0 items-end">
      <div className="relative flex-1 min-w-0">
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {suggestionStatus}
        </span>
        {mirrorShown ? (
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-input [scrollbar-gutter:stable]",
              FIELD_TEXT,
              textInset,
            )}
          >
            {highlightedSkillText(skillSegments)}
            {value.endsWith("\n") ? " " : null}
          </div>
        ) : null}
        <textarea
          ref={ref}
          data-nac-retained-draft=""
          className={cn(
            "relative block w-full bg-transparent resize-none border-none outline-none text-input placeholder:text-input-placeholder placeholder:whitespace-nowrap focus:placeholder:text-transparent [scrollbar-gutter:stable]",
            FIELD_TEXT,
            textInset,
            collapsed && "pointer-events-none overflow-hidden opacity-0",
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
          enterKeyHint={isMobile || coarsePointer ? "enter" : undefined}
          // A preview stands where the placeholder would, rather than in the
          // field, so an earlier prompt can be read before it is taken. The row
          // below draws it, hence the blank here.
          placeholder={history.active ? "" : PLACEHOLDER}
          spellCheck={false}
          value={value}
          style={{
            minHeight: `${rowPx}px`,
            maxHeight: `${MAX_HEIGHT_PX}px`,
            color: mirrorActive ? "transparent" : undefined,
            caretColor: mirrorActive ? "var(--color-text-input)" : undefined,
          }}
          onChange={(event) => {
            if (event.target.value !== value) setDismissedSuggestion(null);
            setActiveSuggestion(0);
            // A pointer resting over the list sends nothing while the rows
            // change underneath it, so its position no longer means the row it
            // meant.
            setHoveredSuggestion(null);
            history.onValueChange(event.target.value);
            setValue(event.target.value);
            setSelection({
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            });
            resize();
          }}
          onSelect={(event) => {
            const next = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
            if (next.start !== selection.start || next.end !== selection.end) {
              setActiveSuggestion(0);
              setHoveredSuggestion(null);
              setSelection(next);
            }
          }}
          onScroll={(event) => {
            if (!mirrorRef.current) return;
            mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
            mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          onFocus={(event) => {
            setFocused(true);
            setSelection({
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            });
          }}
          onBlur={() => {
            setFocused(false);
            setHoveredSuggestion(null);
            resetHistory();
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            // A touch keyboard has no Shift+Enter affordance. Leave Enter
            // native there, including while suggestions are open; hardware
            // keyboards can still explicitly send with Cmd/Ctrl+Enter.
            if (
              event.key === "Enter" &&
              (isMobile || coarsePointer) &&
              !event.metaKey &&
              !event.ctrlKey
            ) {
              return;
            }
            if (suggestionsOpen && !event.shiftKey) {
              if (event.key === "Escape") {
                event.preventDefault();
                dismissSuggestions();
                return;
              }
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
                event.preventDefault();
                // From the lit row, so the keyboard carries on from where the
                // pointer left the highlight rather than jumping back to its
                // own last position.
                setActiveSuggestion(
                  event.key === "ArrowDown"
                    ? Math.min(suggestionIndex + 1, options.length - 1)
                    : Math.max(suggestionIndex - 1, 0),
                );
                setHoveredSuggestion(null);
                return;
              }
              if (event.key === "Tab" && selectedSuggestion) {
                event.preventDefault();
                completeSuggestion(selectedSuggestion);
                return;
              }
              if (event.key === "Enter" && (selectedSuggestion || suggestionKind === "slash")) {
                event.preventDefault();
                if (selectedSuggestion) completeSuggestion(selectedSuggestion);
                return;
              }
            }
            if (history.onKeyDown(event)) return;
            if (event.key !== "Enter") return;
            // Shift+Enter inserts a newline; a bare Enter (or Cmd/Ctrl+Enter) sends.
            if (event.shiftKey) return;
            event.preventDefault();
            void submit();
          }}
        />
        {history.active ? (
          <>
            <span id={previewHelpId} className="sr-only">
              Press Tab to take this prompt, Escape to leave it, or start typing to dismiss it
            </span>
            {/* The preview is drawn here rather than left to the native
                placeholder, which cannot be measured — this way the key that
                takes it sits against the end of the text however long it is. */}
            <div
              className={cn(
                "pointer-events-none absolute inset-0 flex items-center gap-2",
                textInset,
              )}
            >
              <span className={cn("min-w-0 truncate text-input-placeholder", FIELD_TEXT)}>
                {history.previewText}
              </span>
              <KeyboardShortcut keys={["tab"]} spelled className="shrink-0" />
            </div>
          </>
        ) : null}
        {collapsed ? (
          <div
            aria-hidden="true"
            className={cn("absolute inset-0 flex cursor-text items-center", textInset)}
            onClick={focusEnd}
          >
            <span className={cn("w-full truncate text-input", FIELD_TEXT)}>
              {highlightedSkillText(skillSegments)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );

  const suggestions = (
    <div
      id={listboxId}
      role="listbox"
      aria-label={suggestionKind === "skill" ? "Skills" : "Slash commands"}
    >
      {suggestionKind === "slash" && commandDefinitions === undefined ? (
        <div className="type-body-chrome px-3 py-2 text-basic-secondary">
          {commandsFailed ? "Slash commands unavailable" : "Loading commands…"}
        </div>
      ) : suggestionKind === "skill" && skillDefinitions === undefined ? (
        <div className="type-body-chrome px-3 py-2 text-basic-secondary">
          {skillsFailed ? "Skills unavailable" : "Loading skills…"}
        </div>
      ) : options.length ? (
        options.map((option, index) => (
          <button
            key={`${option.kind}-${option.key}`}
            id={`${listboxId}-option-${index}`}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="option"
            aria-selected={index === suggestionIndex}
            tabIndex={-1}
            className={cn(
              "flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left",
              index === suggestionIndex ? "btn-ghost-highlighted" : "btn-ghost",
            )}
            onPointerDown={(event) => event.preventDefault()}
            // Move rather than enter: a list that opens under a still pointer
            // keeps the highlight the keyboard put on the first row.
            onPointerMove={() => setHoveredSuggestion(index)}
            onPointerLeave={() =>
              setHoveredSuggestion((current) => (current === index ? null : current))
            }
            onClick={() => completeSuggestion(option)}
          >
            <span className="code shrink-0 text-[12.5px] text-basic-primary">{option.name}</span>
            <span
              className={cn(
                "type-body-chrome min-w-0 flex-1 text-basic-secondary",
                option.kind === "skill" && "truncate",
              )}
            >
              {option.description}
            </span>
          </button>
        ))
      ) : (
        <div className="type-body-chrome px-3 py-2 text-basic-secondary">No matching commands</div>
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
      className="min-w-0 flex-1"
      size="w-[min(440px,calc(100vw-16px))]"
      panelClassName="max-h-[min(40vh,320px)] overflow-y-auto"
    >
      {field}
    </Popover>
  );

  if (!ownershipKnown) {
    return (
      <ComposerFrame compact={isMobile} onSubmit={(event) => event.preventDefault()}>
        <div
          className={cn(
            "type-body-chrome flex items-center gap-3 rounded-composer border border-tertiary bg-elevation-level-1 text-basic-secondary shadow-lg",
            isMobile ? "min-h-12 px-4 py-1" : "min-h-14 px-5 py-2",
          )}
        >
          <span className="flex-1">Loading session controls…</span>
          {running && (
            <Button
              type="button"
              size={ButtonSize.Small}
              variant={ButtonVariant.GhostDestructive}
              content={ButtonContent.Text}
              aria-label="Stop run"
              onClick={() => void stop()}
            >
              Stop
            </Button>
          )}
        </div>
      </ComposerFrame>
    );
  }

  if (readOnly && lineage) {
    // A child agent's own requests ask here too; a managed orchestrator has
    // no direct permission broker.
    const childAgent = lineage.kind !== "managed-orchestrator";
    return (
      <>
        {childAgent ? (
          <div
            className={cn(
              "pointer-events-none flex flex-col items-center [&>*]:pointer-events-auto [&>*]:w-full [&>*]:max-w-[720px]",
              isMobile ? "px-2" : "px-4",
            )}
          >
            <ComposerAttention
              sessionId={sessionId}
              permissions
              questions={false}
              requesterLabel={`child agent “${lineage.description || "Subagent"}”`}
              includeChildren={false}
              parentSessionId={
                lineage.kind === "traditional-child" ? lineage.parent_session_id : undefined
              }
              poll={running}
            />
          </div>
        ) : null}
        <SubagentSessionComposer
          parentSessionId={lineage.parent_session_id}
          sessionId={sessionId}
          description={lineage.description}
          behavior={behavior}
        />
      </>
    );
  }

  // A phone has no room for the goal editor in the card, so it gets a dialog.
  const inlineGoal = goalEditing && direct && !isMobile;

  return (
    <ComposerFrame
      compact={isMobile}
      onSubmit={(event) => {
        event.preventDefault();
        if (inlineGoal) return;
        if (selectedSuggestion) {
          completeSuggestion(selectedSuggestion);
          return;
        }
        void submit();
      }}
    >
      <ComposerAttention
        sessionId={sessionId}
        permissions={direct}
        questions={behavior === "direct"}
        hidden={permissionSheet.open}
        onReviewAll={(focusKey) => setPermissionSheet({ open: true, focusKey })}
        onDenied={focusEnd}
      />
      <ComposerCard
        compact={isMobile}
        surface={inlineGoal ? "goal" : focused ? "focus" : undefined}
      >
        {retentionLimited ? (
          <p role="status" className="type-meta px-2 pt-1 text-basic-secondary">
            Text recovery storage is full or unavailable. You can keep typing and sending; new edits
            may not restore. Review or dismiss older text to free space.
          </p>
        ) : null}
        {recoveries.length ? (
          <div
            role="region"
            aria-label="Message delivery"
            className="relative flex max-h-48 flex-col gap-1.5 overflow-y-auto"
          >
            {recoveries.map((recovery) => (
              <PromptRecoveryMessage
                key={recovery.id}
                recovery={recovery}
                hasDraft={!!value}
                onRestore={() => drafts.restoreRecovery(sessionId, recovery)}
                onDismiss={() => drafts.dismissRecovery(sessionId, recovery)}
              />
            ))}
          </div>
        ) : null}

        {pendingInbox.length ? (
          <div
            role="group"
            aria-label="Pending messages"
            className="relative flex max-h-40 flex-col gap-0.5 overflow-y-auto"
          >
            {pendingInbox.map((item) => (
              <div
                key={item.id}
                className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[var(--f-wash-1)] py-1 pr-1 pl-3"
              >
                <span className="type-meta-strong shrink-0 text-basic-secondary">
                  {item.delivery === "steer" ? "Steer" : "Queued"}
                </span>
                {item.terminal_selection ? (
                  <TerminalSelectionAttachment
                    evidence={item.terminal_selection}
                    canonicalText={item.prompt}
                    sessionId={sessionId}
                  />
                ) : (
                  <span className="type-body-chrome min-w-0 flex-1 truncate text-basic-primary">
                    {item.prompt}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center">
                  <Button
                    type="button"
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Ghost}
                    disabled={mutationPending}
                    onClick={() =>
                      void changeInboxDelivery(
                        item.id,
                        item.version,
                        item.delivery === "steer" ? "queue" : "steer",
                      )
                    }
                  >
                    Change to {item.delivery === "steer" ? "queue" : "steer"}
                  </Button>
                  <Button
                    type="button"
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Ghost}
                    disabled={mutationPending}
                    onClick={() => void cancelPendingInbox(item.id, item.version)}
                  >
                    Cancel
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {/* Delegated results are consumed by delivery and cannot be edited, so
            only their count shows beside the editable pending input. */}
        {pendingDelegatedResults ? (
          <div
            role="status"
            aria-label="Pending subagent results"
            className="type-meta relative px-3 text-basic-tertiary"
          >
            {pendingDelegatedResults === 1
              ? "1 subagent result pending"
              : `${pendingDelegatedResults} subagent results pending`}
          </div>
        ) : null}

        <div className="relative flex flex-col">
          {direct ? (
            <GoalComposer
              key={sessionId}
              sessionId={sessionId}
              open={goalEditing}
              mobile={isMobile}
              onClose={() => setGoalEditing(false)}
            />
          ) : null}
          {!inlineGoal ? fieldWithSuggestions : null}
        </div>

        {!inlineGoal ? (
          <ComposerFooter
            sessionId={sessionId}
            behavior={behavior}
            compact={isMobile}
            menu={{
              direct,
              fieldEmpty: !value.trim(),
              disabled: false,
              onInsert: insertToken,
              onGoal: openGoalEditor,
              onAttachSelection: direct
                ? () => navigate(routes.session(sessionId, "terminal"))
                : null,
            }}
            metadata={snapshot?.metadata ?? null}
            modelLabel={metrics.model}
            modelDisabled={busy}
            ssh={
              isSsh
                ? { connected: sshStatus === "connected", onReconnect: () => void reconnectSsh() }
                : null
            }
            permissionSheet={{
              open: permissionSheet.open,
              focusKey: permissionSheet.focusKey,
              onOpenChange: (open) =>
                setPermissionSheet((current) => ({
                  open,
                  focusKey: open ? current.focusKey : null,
                })),
            }}
            onSettings={null}
            contextTokens={contextTokens}
            onCompact={() => void compactContext()}
            compacting={compactSession.isPending}
            submit={{
              mode: submitMode,
              canSend,
              onQueue: runningDirect ? () => void submit(value, "queue") : null,
              onStop: () => void stop(),
              onPointerDown: preserveSuggestionFocus,
            }}
          />
        ) : null}
      </ComposerCard>
    </ComposerFrame>
  );
}
