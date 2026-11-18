import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { Icon, IconName, Loader, LoaderSize, Tooltip } from "@/app/atoms";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { TaskLaunchModal } from "@/app/features/task-launches/TaskLaunchModal";
import { useTaskLaunchSource } from "@/app/features/task-launches/useTaskLaunch";
import { useMediaQuery } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

import { Chip } from "./Chip";
import { IsolatedToggle, ProjectPicker } from "./ComposerPickers";
import { modelChipLabel, type ModelOverride } from "./modelChoice";
import { ModelOverrideModal } from "./ModelOverrideModal";
import { useStartSession } from "./useStartSession";

const MAX_TITLE = 120;

/** A task title from the prompt's first line, for the isolated-task form. */
function titleFrom(prompt: string): string {
  const line = prompt.trim().split("\n")[0]?.trim() ?? "";
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}

/** The project a fresh composer points at: the one most recently worked in. */
function recentProjectId(
  projects: readonly ProjectRecord[],
  sessions: readonly ManagedSessionSummary[],
): string | null {
  const known = new Set(projects.map((project) => project.project_id));
  let best: { id: string; at: string } | null = null;
  for (const entry of sessions) {
    const id = entry.summary.project_id;
    if (!id || !known.has(id) || entry.lineage) continue;
    if (!best || entry.summary.updated_at > best.at) best = { id, at: entry.summary.updated_at };
  }
  return best?.id ?? projects[0]?.project_id ?? null;
}

/**
 * Home's hero composer — the app's one new-session flow. Chips pick the
 * project, model and (on a Git source) an
 * isolated checkout; sending creates the session with the prompt as its
 * first message and opens it.
 */
export function HomeComposer({
  projects,
  sessions,
  compact = false,
}: {
  projects: readonly ProjectRecord[];
  sessions: readonly ManagedSessionSummary[];
  /** Phones: no hero heading spacing. */
  compact?: boolean;
}) {
  const managed = useManagedHost();
  const projectActions = useProjectActions();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const coarse = useMediaQuery("(pointer: coarse)");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const requested = params.get("project");
  const [chosen, setChosen] = useState<string | null>(null);
  // A new `?project=` (another "New session in …") wins over an earlier pick.
  const [seenRequest, setSeenRequest] = useState(requested);
  if (seenRequest !== requested) {
    setSeenRequest(requested);
    if (requested) setChosen(null);
  }
  const fallback = useMemo(() => recentProjectId(projects, sessions), [projects, sessions]);
  const candidate = chosen ?? requested ?? fallback;
  const project =
    projects.find((entry) => entry.project_id === candidate) ??
    projects.find((entry) => entry.project_id === fallback) ??
    null;
  const projectId = project?.project_id ?? null;

  const draft = useNativeRuntime().stores.homeDraftStore;
  const prompt = draft.usePrompt();
  const setPrompt = draft.update;
  // An override belongs to the project it was chosen for; another project
  // inherits its own model.
  const [overrideFor, setOverrideFor] = useState<{
    projectId: string | null;
    value: ModelOverride;
  } | null>(null);
  const override = overrideFor?.projectId === projectId ? overrideFor.value : null;
  const setOverride = (value: ModelOverride | null) =>
    setOverrideFor(value ? { projectId, value } : null);
  const [modelOpen, setModelOpen] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [isolatedTask, setIsolatedTask] = useState<{ prompt: string } | null>(null);

  const source = useTaskLaunchSource(projectId, true);
  const isolationAvailable = source.data?.eligible === true;
  const useIsolation = isolated && isolationAvailable;
  const starter = useStartSession();

  // "New session" from anywhere (sidebar, ⌘⇧O, a project's +) lands here.
  const focusToken = (location.state as { focusComposer?: number } | null)?.focusComposer;
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field || (!requested && focusToken === undefined)) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [requested, focusToken]);

  // Grow with the text, up to a cap; then scroll inside.
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 320)}px`;
  }, [prompt]);

  const busy = starter.busy;
  const canSend = Boolean(projectId) && prompt.trim().length > 0 && !busy && !starter.needsReview;

  const send = async () => {
    if (!canSend || !projectId) return;
    if (!override) {
      setModelOpen(true);
      return;
    }
    if (useIsolation) {
      setIsolatedTask({ prompt: prompt.trim() });
      return;
    }
    const text = prompt;
    const revision = draft.get().revision;
    const started = await starter.start({
      projectId,
      prompt: text,
      model: override,
    });
    if (started) {
      draft.acknowledge(revision);
    }
  };

  const addProject = managed.isManaged ? managed.addRepository : projectActions.create;
  const modelLabel = modelChipLabel(override);

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        className={cn(
          "rounded-composer border border-tertiary bg-elevation-level-1",
          "transition-[border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none",
          "focus-within:border-secondary focus-within:shadow-sm",
        )}
      >
        <label htmlFor="home-composer" className="sr-only">
          What should we work on?
        </label>
        <textarea
          id="home-composer"
          ref={textarea}
          rows={compact ? 2 : 3}
          value={prompt}
          disabled={busy}
          placeholder={
            project ? `Describe a task for ${project.name}…` : "Add a project to start a session"
          }
          onChange={(event) => {
            setPrompt(event.target.value);
            if (starter.error) starter.clearError();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            // Touch keyboards keep Enter for new lines; the Send button sends.
            if (coarse && !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            void send();
          }}
          className={cn(
            "block w-full resize-none bg-transparent px-5 pt-4 pb-1 text-basic-primary outline-none",
            "type-body placeholder:text-basic-muted max-md:text-base",
            "disabled:opacity-60",
          )}
        />
        <div className="flex items-end gap-2 px-3 pt-1 pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 max-md:-ml-1 max-md:flex-nowrap max-md:overflow-x-auto max-md:[&>*]:shrink-0 max-md:[scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,black_85%,transparent)] max-md:pr-6">
            <ProjectPicker
              projects={projects}
              value={project}
              disabled={busy}
              addLabel={managed.isManaged ? "Add repository…" : "Add project…"}
              onAddProject={addProject}
              onChange={(id) => {
                setChosen(id);
                if (requested) {
                  const next = new URLSearchParams(params);
                  next.delete("project");
                  setParams(next, { replace: true });
                }
              }}
            />
            {project ? (
              <Chip
                icon={IconName.Ai}
                disabled={busy}
                aria-label={modelLabel ? `Model: ${modelLabel}` : "Choose a model"}
                aria-haspopup="dialog"
                pressed={override != null || undefined}
                onClick={() => setModelOpen(true)}
              >
                {modelLabel ?? "Choose a model"}
              </Chip>
            ) : null}
            {isolationAvailable ? (
              <IsolatedToggle value={isolated} onChange={setIsolated} disabled={busy} />
            ) : null}
          </div>
          <Tooltip title={useIsolation ? "Set up isolated task" : "Start session"} sticky>
            <button
              type="button"
              aria-label={useIsolation ? "Set up isolated task" : "Start session"}
              disabled={!canSend}
              onClick={() => void send()}
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-pill max-md:size-11",
                "bg-[var(--f-ink)] text-[var(--f-on-ink)] outline-none",
                "transition-[opacity,background-color] duration-150 ease-out",
                "hover:bg-[var(--f-ink-hover)] focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] focus-visible:ring-offset-2",
                "disabled:cursor-default disabled:bg-[var(--f-ink-disabled)] disabled:opacity-60",
              )}
            >
              {busy ? (
                <Loader size={LoaderSize.XSmall} />
              ) : (
                <Icon iconName={IconName.ArrowTop} size={16} />
              )}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="px-5 md:min-h-5" aria-live="polite">
        {starter.error ? (
          <p role="alert" className="type-meta text-error-primary">
            {starter.error}
            {starter.needsReview
              ? " Reload Home to review what was created before trying again."
              : ""}
          </p>
        ) : null}
      </div>

      <ModelOverrideModal
        open={modelOpen}
        current={override}
        onApply={(next) => {
          setOverride(next);
          setModelOpen(false);
        }}
        onReset={() => setOverride(null)}
        onClose={() => setModelOpen(false)}
      />
      {isolatedTask && projectId && override ? (
        <TaskLaunchModal
          projectId={projectId}
          model={override.selection}
          defaultRef={source.data?.default_ref ?? null}
          initialPrompt={isolatedTask.prompt}
          initialTitle={titleFrom(isolatedTask.prompt)}
          onClose={() => setIsolatedTask(null)}
          onExistingCheckout={() => {
            const text = isolatedTask.prompt;
            const revision = draft.get().revision;
            setIsolatedTask(null);
            void starter.start({ projectId, prompt: text, model: override }).then((started) => {
              if (started) {
                draft.acknowledge(revision);
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}
