import { useEffect, useRef, useState } from "react";

import {
  Icon,
  IconName,
  Input,
  InputLeading,
  InputSize,
  Loader,
  LoaderSize,
  LoaderVariant,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useBranches, useSwitchBranch } from "@/app/services/queries";
import { useRunning } from "@/app/store/runtimeStore";

/** Why the picker will not act right now, or null when it is free to. */
function blockedReason(running: boolean, dirty: boolean, create: boolean): string | null {
  if (running) return "A run is in flight; wait for it to finish.";
  // A new branch carries uncommitted work along, so only leaving is a problem.
  if (dirty && !create) {
    return "Uncommitted changes: commit or stash them before switching.";
  }
  return null;
}

function Row({
  label,
  icon,
  disabled,
  title,
  onClick,
}: {
  label: React.ReactNode;
  icon: IconName;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-2 w-full p-1 rounded-[4px] text-left btn-ghost",
        disabled && "opacity-40 cursor-not-allowed",
      )}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <Icon iconName={icon} size={16} className="shrink-0" />
      <span className="flex-1 min-w-0 truncate label-micro text-btn-secondary">
        {label}
      </span>
    </button>
  );
}

/**
 * The branch chip in the box footer, opening a list of local branches with an
 * escape hatch for making a new one. Switching is refused while an agent could
 * be working in the checkout; the server enforces the same rules, because
 * another session may share this directory.
 */
export function BranchPicker({
  sessionId,
  branch,
}: {
  sessionId: string;
  branch: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const running = useRunning();
  const { data, isLoading, error } = useBranches(sessionId, open);
  const switchBranch = useSwitchBranch(sessionId);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    switchBranch.reset();
  };

  const needle = query.trim();
  const branches = (data?.branches ?? []).filter((item) =>
    item.name.toLowerCase().includes(needle.toLowerCase()),
  );
  const exists = (data?.branches ?? []).some((item) => item.name === needle);
  const dirty = data?.dirty ?? false;

  const act = (name: string, create: boolean) => {
    switchBranch.mutate({ name, create }, { onSuccess: close });
  };

  const failure = error
    ? errorMessage(error)
    : switchBranch.error
      ? errorMessage(switchBranch.error)
      : null;

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        className="flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost"
        aria-expanded={open}
        aria-label={`Branch: ${branch}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon iconName={IconName.Scheme} size={16} className="shrink-0" />
        <span className="label-micro text-btn-secondary truncate">{branch}</span>
      </button>

      {open ? (
        // The chip sits in the footer, so the panel has to grow upwards.
        <div className="absolute bottom-full left-0 z-30 mb-1 w-[300px] flex flex-col gap-1 p-2 rounded-[8px] border border-secondary bg-elevation-level-2 shadow-xl fade">
          <Input
            autoFocus
            inputSize={InputSize.Small}
            leading={InputLeading.Icon}
            leadingIconName={IconName.Search}
            placeholder="Find or create a branch"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {isLoading ? (
            <div className="flex items-center gap-2 p-1 label-micro text-basic-muted">
              <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />
              Reading branches…
            </div>
          ) : null}

          {!isLoading && !error ? (
            <div className="flex flex-col gap-1 max-h-[240px] overflow-auto [&>*]:shrink-0">
              {branches.map((item) => {
                const reason = item.is_current
                  ? null
                  : blockedReason(running, dirty, false);
                return (
                  <Row
                    key={item.name}
                    label={item.name}
                    icon={item.is_current ? IconName.Check : IconName.Scheme}
                    disabled={item.is_current || Boolean(reason)}
                    title={reason ?? undefined}
                    onClick={() => act(item.name, false)}
                  />
                );
              })}
              {branches.length === 0 && !needle ? (
                <div className="p-1 label-micro text-basic-muted">
                  No local branches.
                </div>
              ) : null}
            </div>
          ) : null}

          {needle && !exists && !error ? (
            <Row
              label={
                <>
                  Create <span className="text-basic-primary">{needle}</span>
                </>
              }
              icon={IconName.Add}
              disabled={Boolean(blockedReason(running, dirty, true))}
              title={blockedReason(running, dirty, true) ?? undefined}
              onClick={() => act(needle, true)}
            />
          ) : null}

          {switchBranch.isPending ? (
            <div className="flex items-center gap-2 p-1 label-micro text-basic-muted">
              <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />
              Working…
            </div>
          ) : null}

          {failure ? (
            <div className="p-1 label-micro text-error-primary">{failure}</div>
          ) : null}

          {!failure && dirty && !running ? (
            <div className="p-1 label-micro text-basic-muted">
              Uncommitted changes: you can branch off them, but not switch away.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
