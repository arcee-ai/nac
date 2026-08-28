import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  Icon,
  IconName,
  Input,
  InputSize,
  Loader,
  LoaderSize,
  LoaderVariant,
  Popover,
  PopoverPlacement,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

interface ManagedBranchPickerProps {
  branches: string[];
  value: string;
  onValueChange: (branch: string) => void;
  isLoading: boolean;
  error: string | null;
}

function branchOrder(left: string, right: string): number {
  return left.toLowerCase().localeCompare(right.toLowerCase()) || left.localeCompare(right);
}

export function ManagedBranchPicker({
  branches,
  value,
  onValueChange,
  isLoading,
  error,
}: ManagedBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeBranch, setActiveBranch] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const isMobile = useIsMobile();

  const visibleBranches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const ordered = [...branches].sort(branchOrder);
    return needle ? ordered.filter((branch) => branch.toLowerCase().includes(needle)) : ordered;
  }, [branches, query]);
  const activeIndex = activeBranch === null ? -1 : visibleBranches.indexOf(activeBranch);

  const close = (restoreFocus = true) => {
    setOpen(false);
    setQuery("");
    setActiveBranch(null);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const openPicker = () => {
    if (open) {
      close();
      return;
    }
    const ordered = [...branches].sort(branchOrder);
    setActiveBranch(value || ordered[0] || null);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document
      .getElementById(`${listboxId}-option-${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, listboxId, open]);

  const choose = (branch: string) => {
    onValueChange(branch);
    close();
  };

  const move = (offset: number) => {
    if (visibleBranches.length === 0) return;
    const current = activeBranch === null ? -1 : visibleBranches.indexOf(activeBranch);
    const next =
      current < 0
        ? offset > 0
          ? 0
          : visibleBranches.length - 1
        : (current + offset + visibleBranches.length) % visibleBranches.length;
    setActiveBranch(visibleBranches[next] ?? null);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveBranch(visibleBranches[0] ?? null);
        break;
      case "End":
        event.preventDefault();
        setActiveBranch(visibleBranches.at(-1) ?? null);
        break;
      case "Enter": {
        const active = activeIndex >= 0 ? visibleBranches[activeIndex] : null;
        if (!active) break;
        event.preventDefault();
        choose(active);
        break;
      }
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const status = isLoading ? (
    <div role="status" className="flex items-center gap-2 p-3 text-small text-basic-tertiary">
      <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />
      Loading branches…
    </div>
  ) : error ? (
    <p role="alert" className="p-3 text-small text-error-primary">
      {error}
    </p>
  ) : branches.length === 0 ? (
    <p role="status" className="p-3 text-small text-basic-tertiary">
      No branches found.
    </p>
  ) : visibleBranches.length === 0 ? (
    <p role="status" className="p-3 text-small text-basic-tertiary">
      No branches match &quot;{query.trim()}&quot;.
    </p>
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1 text-small text-basic-secondary">
      <span>Branch</span>
      <Popover
        open={open}
        onClose={() => close()}
        placement={PopoverPlacement.BottomLeft}
        sticky
        className="w-full"
        size="w-[min(420px,calc(100vw-32px))]"
        panelClassName="max-w-[calc(100vw-32px)]"
        sheetClassName="px-4"
        content={
          <div className="flex h-[min(420px,70dvh)] min-h-[220px] flex-col gap-2 p-2 md:p-0">
            <Input
              ref={inputRef}
              inputSize={isMobile ? InputSize.Large : InputSize.Medium}
              label="Find branch"
              aria-label="Find branch"
              placeholder="Search loaded branches"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={
                activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
              }
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                const needle = nextQuery.trim().toLowerCase();
                const nextBranches = [...branches]
                  .sort(branchOrder)
                  .filter((branch) => !needle || branch.toLowerCase().includes(needle));
                setQuery(nextQuery);
                setActiveBranch(nextBranches[0] ?? null);
              }}
              onKeyDown={onInputKeyDown}
            />
            <div
              id={listboxId}
              role="listbox"
              aria-label="Branches"
              className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded border border-basic p-1"
            >
              {status}
              {!isLoading && !error
                ? visibleBranches.map((branch, index) => (
                    <TabButton
                      key={branch}
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={branch === value}
                      tabIndex={-1}
                      size={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
                      active={branch === activeBranch}
                      className="shrink-0"
                      onMouseEnter={() => setActiveBranch(branch)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(branch)}
                    >
                      <span className="min-w-0 flex-1 truncate text-left" title={branch}>
                        {branch}
                      </span>
                      {branch === value ? (
                        <Icon iconName={IconName.Check} className="shrink-0" />
                      ) : null}
                    </TabButton>
                  ))
                : null}
            </div>
          </div>
        }
      >
        <button
          ref={triggerRef}
          type="button"
          className="btn btn-medium btn-secondary btn-icon-right w-full max-w-full overflow-hidden"
          aria-label={`Branch: ${value || "Select a branch"}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          onClick={openPicker}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
            event.preventDefault();
            if (!open) openPicker();
          }}
        >
          <span className="min-w-0 flex-1 truncate text-left" title={value}>
            {value || "Select a branch"}
          </span>
          <Icon
            iconName={IconName.Down}
            className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : "rotate-0"}`}
          />
        </button>
      </Popover>
    </div>
  );
}
