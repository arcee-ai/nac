import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Icon, IconName, Loader, LoaderSize, Tooltip } from "@/app/atoms";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { TaskLaunchModal } from "@/app/features/task-launches/TaskLaunchModal";
import { useTaskLaunchSource } from "@/app/features/task-launches/useTaskLaunch";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useMediaQuery } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { resolveCatalogModel, type CatalogPick } from "@/app/lib/catalog";
import { standardEffort } from "@/app/components/modals/options";
import { speedForCatalogRoute, supportsSpeed } from "@/app/lib/serviceTier";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useModelCatalog, useSandboxAvailability } from "@/app/services/queries";
import type {
  ManagedSessionSummary,
  ProjectRecord,
  ReasoningEffort,
  SessionBehavior,
} from "@/app/types/api";

import { defaultBehavior } from "./behaviors";
import { Chip } from "./Chip";
import { ModelPicker } from "./ComposerModelPickers";
import { BehaviorPicker, ProjectPicker } from "./ComposerPickers";
import { WorkspaceSettings } from "./WorkspaceSettings";
import {
  modelChipLabel,
  sessionRoute,
  useConfiguredLaunchModel,
  useInheritedModel,
  withEffort,
  withSpeed,
  type ModelOverride,
} from "./modelChoice";
import { ModelOverrideModal } from "./ModelOverrideModal";
import { catalogOverride, useSuggestedModel } from "./suggestedModel";
import { useStartSession } from "./useStartSession";
import type { SandboxOptions } from "./workspaceSandbox";

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
 * Home's hero composer — the app's one new-session flow. The strip under it picks
 * the project, grouped by where it runs (this computer or an SSH host); its "⋯" button holds the isolated-checkout choice and ref,
 * out of the way of a plain session. The composer's chips pick the behavior and
 * model. Sending creates the session with the prompt as its first message.
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
  const policy = useUiPolicy();
  const managed = useManagedHost();
  const projectActions = useProjectActions();
  const location = useLocation();
  const navigate = useNavigate();
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

  const explicitProject = chosen ?? requested;
  const project =
    projects.find((entry) => entry.project_id === (explicitProject ?? fallback)) ?? null;
  const requestedMissing = explicitProject != null && project == null;
  const projectId = project?.project_id ?? null;

  const draft = useNativeRuntime().stores.homeDraftStore;
  const prompt = draft.usePrompt();
  const draftProjectId = draft.useProjectId();
  const setPrompt = (text: string) => draft.update(text, projectId);
  // The draft was written for another project and New session pointed it here.
  const movedFrom =
    prompt.trim() && project && draftProjectId && draftProjectId !== project.project_id
      ? (projects.find((entry) => entry.project_id === draftProjectId)?.name ?? null)
      : undefined;
  const [behavior, setBehavior] = useState<SessionBehavior>(() => defaultBehavior(policy));
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
  const [isolatedProjectId, setIsolatedProjectId] = useState<string | null>(null);
  const [sandboxFor, setSandboxFor] = useState<{
    projectId: string | null;
    options: SandboxOptions;
  } | null>(null);
  const [isolatedTask, setIsolatedTask] = useState<{
    projectId: string;
    prompt: string;
    model: ModelOverride | null;
    revision: number;
    gitRef: string;
    defaultRef: string | null;
  } | null>(null);
  // A ref belongs to the project it was typed for.
  const [refFor, setRefFor] = useState<{ projectId: string | null; ref: string } | null>(null);
  const gitRef = refFor?.projectId === projectId ? refFor.ref : "";
  const effectiveBehavior = policy.orchestrationEnabled ? behavior : "direct";

  const model = useInheritedModel(projectId);
  const noInherited = Boolean(projectId) && !model.pending && !model.inherited && !model.error;
  const configured = useConfiguredLaunchModel(project, noInherited);
  const suggestion = useSuggestedModel(
    noInherited && !configured.model && !configured.pending && !configured.error,
  );
  // Nothing picked and nothing inherited: start on the suggested model rather
  // than leaving the server without one.
  const chosenModel = override ?? (model.inherited ? null : suggestion.override);
  const route = sessionRoute(chosenModel, model.inherited);
  const catalog = useModelCatalog(Boolean(route));
  const speedCapability = speedForCatalogRoute(catalog.data, route);
  const supported = route
    ? resolveCatalogModel(catalog.data, route.backend, route.model).supportedEfforts
    : [];
  // A level picked for one model carries over to the next one that accepts it.
  const [effortChoice, setEffortChoice] = useState<string | null>(null);
  const effortAllowed = (effort: string) => supported.includes(effort as ReasoningEffort);
  const effort = !route
    ? ""
    : effortChoice !== null && effortAllowed(effortChoice)
      ? effortChoice
      : route.effort || (standardEffort(supported) ?? "");
  const sessionModel =
    route && effort !== route.effort
      ? withEffort(chosenModel, model.inherited, effort)
      : chosenModel;
  const modelPending = model.pending || configured.pending || suggestion.pending;
  const chooseModel = (pick: CatalogPick, clearIncompatibleSpeed: boolean) => {
    if (!catalog.data || (route?.backend === pick.backend && route.model === pick.model)) return;
    const targetSpeed = speedForCatalogRoute(catalog.data, pick);
    const incompatible = Boolean(route?.speed) && !targetSpeed.explicitTiersAllowed;
    if (incompatible && !clearIncompatibleSpeed)
      return {
        error: "This model does not accept the selected speed.",
        confirmSpeedClear: true,
      };
    const next = catalogOverride(catalog.data, pick);
    if (route?.speed === undefined) {
      setOverride(next);
    } else {
      const speed = incompatible
        ? null
        : route.speed && !supportsSpeed(targetSpeed.tiers, route.speed)
          ? "standard"
          : route.speed;
      setOverride(withSpeed(next, null, speed));
      if (incompatible) return { notice: "Speed preference cleared for this model." };
      if (speed !== route.speed) return { notice: "Speed changed to Standard for this model." };
    }
  };
  const needsProvider = !override && !model.inherited && suggestion.noProviders;
  const modelError =
    !override && !model.inherited ? (model.error ?? configured.error ?? suggestion.error) : null;
  const source = useTaskLaunchSource(projectId, effectiveBehavior === "direct");
  const isolationAvailable = effectiveBehavior === "direct" && source.data?.eligible === true;
  const useIsolation = projectId != null && isolatedProjectId === projectId;
  const sandboxAllowed = Boolean(project && !project.ssh_host && managed.isUnmanaged);
  const sandbox = sandboxFor?.projectId === projectId ? sandboxFor.options : null;
  const sandboxCheck = useSandboxAvailability(sandboxAllowed && sandbox != null);
  const sandboxReady =
    sandboxAllowed &&
    !sandboxCheck.isError &&
    !sandboxCheck.isFetching &&
    sandboxCheck.data?.status === "ready";
  const starter = useStartSession();

  // "New session" from anywhere (sidebar, ⌘⇧O, a project's +) lands here.
  const focusToken = (location.state as { focusComposer?: number } | null)?.focusComposer;
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field || (!requested && focusToken === undefined)) return;
    field.scrollIntoView?.({ block: "center" });
    field.focus({ preventScroll: true });
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
  const canSend =
    Boolean(projectId) &&
    prompt.trim().length > 0 &&
    !busy &&
    !starter.needsReview &&
    !needsProvider &&
    !modelError &&
    (!useIsolation || isolationAvailable) &&
    (!sandbox || sandboxReady) &&
    (!modelPending || override != null);

  const sendLabel = useIsolation
    ? "Set up isolated task"
    : sandbox
      ? "Start sandbox session"
      : "Start session";

  const send = async () => {
    if (!canSend || !projectId) return;
    const revision = draft.get().revision;
    if (useIsolation) {
      setIsolatedTask({
        projectId,
        prompt: prompt.trim(),
        model: sessionModel,
        revision,
        gitRef,
        defaultRef: source.data?.default_ref ?? null,
      });
      return;
    }
    const text = prompt;
    const started = await starter.start({
      projectId,
      behavior: effectiveBehavior,
      prompt: text,
      model: sessionModel,
      ...(sandbox ? { sandbox } : {}),
    });
    if (started) {
      draft.acknowledge(revision);
    }
  };

  const addProject = managed.isManaged ? managed.addRepository : projectActions.create;
  const chooseProject = (id: string) => {
    setChosen(id);
    if (prompt) draft.update(prompt, id);
    if (requested) {
      const next = new URLSearchParams(params);
      next.delete("project");
      setParams(next, { replace: true });
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="rounded-[calc(var(--radius-composer)+4px)] bg-[var(--f-wash-1)] p-1 pb-0">
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
              project
                ? `Describe a task for ${project.name}…`
                : requestedMissing
                  ? "That project is no longer available. Choose a project."
                  : "Add a project to start a session"
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
              {policy.orchestrationEnabled ? (
                <BehaviorPicker value={behavior} onChange={setBehavior} disabled={busy} />
              ) : null}
              {project && needsProvider ? (
                <Chip
                  icon={IconName.Key}
                  menu={false}
                  disabled={busy}
                  onClick={() => navigate(routes.settings("accounts"))}
                >
                  Connect a provider
                </Chip>
              ) : null}
            </div>
            {project && !needsProvider ? (
              <ModelPicker
                fallbackLabel={modelChipLabel(chosenModel, model.inherited) ?? configured.model}
                pending={modelPending}
                value={route}
                effort={effort}
                supportedEfforts={supported}
                speed={{
                  ...speedCapability,
                  value: route?.speed ?? null,
                  onChange: (speed) => setOverride(withSpeed(sessionModel, model.inherited, speed)),
                }}
                disabled={busy}
                onPick={chooseModel}
                onEffort={setEffortChoice}
                onAdvanced={policy.orchestrationEnabled ? () => setModelOpen(true) : undefined}
              />
            ) : null}
            <Tooltip title={sendLabel} sticky>
              <button
                type="button"
                aria-label={sendLabel}
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
        <div
          role="group"
          aria-label="Workspace"
          className="flex min-w-0 items-center gap-1 py-1 pr-1 pl-2 max-md:pl-1"
        >
          <ProjectPicker
            projects={projects}
            value={project}
            disabled={busy}
            addLabel={managed.isManaged ? "Add repository…" : "Add project…"}
            onAddProject={addProject}
            onChange={chooseProject}
          />
          {project ? (
            <span className="shrink-0">
              <WorkspaceSettings
                key={projectId}
                isolated={useIsolation}
                available={isolationAvailable}
                onIsolatedChange={(isolated) => {
                  if (isolated && sandbox) setSandboxFor(null);
                  setIsolatedProjectId(isolated ? projectId : null);
                }}
                gitRef={gitRef}
                defaultRef={source.data?.default_ref ?? null}
                onRefChange={(ref) => setRefFor({ projectId, ref })}
                sandbox={
                  sandboxAllowed || sandbox
                    ? {
                        allowed: sandboxAllowed,
                        options: sandbox,
                        availability: sandboxCheck.data,
                        checking: sandboxCheck.isFetching || sandboxCheck.isPending,
                        checkFailed: sandboxCheck.isError,
                        onChange: (options) => {
                          // A disappearing auto-selected project must not move a
                          // selected sandbox launch onto another project's Local backend.
                          if (options) setChosen(project.project_id);
                          if (options && useIsolation) setIsolatedProjectId(null);
                          setSandboxFor(options ? { projectId, options } : null);
                          starter.clearError();
                        },
                        onRetry: () => void sandboxCheck.refetch(),
                      }
                    : undefined
                }
                disabled={busy}
              />
            </span>
          ) : null}
        </div>
      </div>
      <div className="px-5 md:min-h-5" aria-live="polite">
        {starter.sandboxProgress ? (
          <p role="status" className="type-meta text-basic-secondary">
            {starter.sandboxProgress}
          </p>
        ) : project && needsProvider ? (
          <p className="type-meta text-basic-tertiary">
            Connect a model provider in Settings to start a session.
          </p>
        ) : modelError ? (
          <p role="alert" className="type-meta text-error-primary">
            Could not load the launch model. Choose a model before starting a session.
          </p>
        ) : starter.error ? (
          <p role="alert" className="type-meta text-error-primary">
            {starter.error}
            {starter.needsReview
              ? " Reload Home to review what was created before trying again."
              : ""}
          </p>
        ) : project && movedFrom !== undefined ? (
          <p className="type-meta text-basic-tertiary">
            Your draft will start in{" "}
            <span className="type-meta-strong text-basic-primary">{project.name}</span>
            {movedFrom ? `, not ${movedFrom}` : ""}.
          </p>
        ) : null}
      </div>

      <ModelOverrideModal
        open={modelOpen && policy.orchestrationEnabled}
        behavior={effectiveBehavior}
        inherited={model.inherited}
        inheritancePending={model.pending}
        inheritanceError={model.error}
        current={sessionModel}
        overridden={override != null}
        onApply={(next) => {
          setOverride(next);
          setEffortChoice(null);
          setModelOpen(false);
        }}
        onReset={() => setOverride(null)}
        onClose={() => setModelOpen(false)}
      />
      {isolatedTask && isolatedTask.projectId === projectId ? (
        <TaskLaunchModal
          projectId={isolatedTask.projectId}
          defaultRef={isolatedTask.defaultRef}
          initialGitRef={isolatedTask.gitRef}
          initialPrompt={isolatedTask.prompt}
          initialTitle={titleFrom(isolatedTask.prompt)}
          onClose={() => setIsolatedTask(null)}
          onLaunchAccepted={() => draft.acknowledge(isolatedTask.revision)}
          onExistingCheckout={(text) => {
            setIsolatedTask(null);
            void starter
              .start({
                projectId: isolatedTask.projectId,
                behavior: "direct",
                prompt: text,
                model: isolatedTask.model,
              })
              .then((started) => {
                if (started) {
                  draft.acknowledge(isolatedTask.revision);
                }
              });
          }}
        />
      ) : null}
    </div>
  );
}
