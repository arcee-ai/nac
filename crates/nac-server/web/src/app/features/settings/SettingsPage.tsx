import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { Icon, IconName } from "@/app/atoms";
import { ConfigurationsSettings } from "@/app/components/modals/ConfigurationsModal";
import { McpServersSettings } from "@/app/components/modals/MCPServersModal/McpServersModal";
import { SshConfigsSettings } from "@/app/components/modals/SshConfigsModal";
import { ShortcutList } from "@/app/features/command-palette/ShortcutList";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { ManagedHostSettings } from "@/app/features/managed/presentation/ManagedHostSettings";
import { useManagedHostStatus } from "@/app/features/managed/queries";
import { ProductContextPanel } from "@/app/features/product-context/ProductContextPanel";
import { useMediaQuery } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { isSettingsSection, routes, type SettingsSection } from "@/app/lib/routes";
import {
  matchSections,
  SETTINGS_GROUPS,
  SETTINGS_SECTION_META,
  sectionMeta,
  type SectionMatch,
} from "./sections";
import { AboutSection } from "./sections/AboutSection";
import { AccountsSection } from "./sections/AccountsSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { GeneralSection } from "./sections/GeneralSection";
import { useSettingsReturn } from "./settingsReturn";
import { useSettingsEscape } from "./useSettingsEscape";

function SectionBody({ section }: { section: SettingsSection }) {
  const { search } = useLocation();
  switch (section) {
    case "general":
      return <GeneralSection />;
    case "appearance":
      return <AppearanceSection />;
    case "accounts":
      return <AccountsSection />;
    case "models":
      return <ConfigurationsSettings />;
    case "mcp":
      return <McpServersSettings />;
    case "capabilities":
      return <ProductContextPanel sessionId={new URLSearchParams(search).get("session")} />;
    case "ssh":
      return <SshConfigsSettings />;
    case "managed":
      return <ManagedHostSettings />;
    case "shortcuts":
      return <ShortcutList />;
    case "about":
      return <AboutSection />;
  }
}

/** The search field over sections and their rows. */
function SettingsSearch({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 rounded-pill border border-tertiary bg-elevation-level-1 px-3 text-basic-tertiary transition-colors duration-150 ease-out focus-within:border-secondary max-md:h-11",
        className,
      )}
    >
      <Icon iconName={IconName.Search} size={14} className="shrink-0" />
      <input
        type="search"
        aria-label="Search settings"
        placeholder="Search settings"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
        className="type-body-chrome min-w-0 flex-1 bg-transparent text-basic-primary outline-none placeholder:text-basic-muted max-md:text-base [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

/** Grouped section list: the desktop nav column, and the phone's first screen. */
function SectionList({
  matches,
  current,
  query,
  touch,
  onPick,
}: {
  matches: SectionMatch[];
  current: SettingsSection | null;
  query: string;
  touch: boolean;
  onPick?: () => void;
}) {
  const { search } = useLocation();
  if (matches.length === 0) {
    return (
      <p role="status" className="type-body-chrome px-3 py-2 text-basic-tertiary">
        No settings match “{query.trim()}”.
      </p>
    );
  }
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-5">
      {SETTINGS_GROUPS.map((group) => {
        const items = matches.filter((match) => match.meta.group === group.name);
        if (items.length === 0) return null;
        return (
          <div key={group.name} className="flex flex-col gap-1">
            {group.label ? (
              <div className="type-meta-strong px-3 pb-0.5 text-basic-tertiary">{group.label}</div>
            ) : null}
            <ul
              className={cn(
                "flex flex-col",
                touch &&
                  "divide-y divide-[var(--f-line-soft)] overflow-hidden rounded-card border border-tertiary bg-elevation-level-1",
              )}
            >
              {items.map(({ meta, rows }) => {
                const active = current === meta.id;
                // Capabilities keeps describing the session it was opened from.
                const to =
                  meta.id === "capabilities" && current === "capabilities"
                    ? `${routes.settings(meta.id)}${search}`
                    : routes.settings(meta.id);
                return (
                  <li key={meta.id}>
                    <Link
                      to={to}
                      replace={!touch}
                      onClick={onPick}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2.5 text-left outline-none transition-colors duration-150 ease-out",
                        touch
                          ? "min-h-12 px-4 py-2.5 active:bg-[var(--f-wash-2)]"
                          : "min-h-8 rounded-md px-3 py-1.5 hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-2)]",
                        active
                          ? "bg-[var(--f-wash-2)] text-basic-primary"
                          : "text-basic-secondary hover:text-basic-primary",
                      )}
                    >
                      <Icon
                        iconName={meta.icon}
                        size={touch ? 18 : 16}
                        className={cn(
                          "shrink-0",
                          active ? "text-basic-primary" : "text-basic-tertiary",
                        )}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          className={cn(
                            touch ? "type-body-chrome text-md" : "type-label",
                            "truncate",
                          )}
                        >
                          {meta.label}
                        </span>
                        {rows.length ? (
                          <span className="type-meta truncate text-basic-tertiary">
                            {rows.slice(0, 3).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      {touch ? (
                        <Icon
                          iconName={IconName.Right}
                          size={16}
                          className="shrink-0 text-basic-muted"
                        />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SectionHeading({ section }: { section: SettingsSection }) {
  const meta = sectionMeta(section);
  return (
    <header className="flex flex-col gap-1.5">
      <h2 className="type-title text-basic-primary">{meta.label}</h2>
      <p className="type-body-chrome max-w-[64ch] text-basic-secondary text-pretty">
        {meta.description}
      </p>
    </header>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="type-label inline-flex h-8 items-center gap-1 rounded-pill pl-1.5 pr-3 text-basic-secondary outline-none transition-colors duration-150 ease-out hover:bg-[var(--f-wash-2)] hover:text-basic-primary focus-visible:bg-[var(--f-wash-2)] max-md:h-11 max-md:min-w-11"
    >
      <Icon iconName={IconName.Left} size={16} />
      {label}
    </button>
  );
}

function useSectionMatches(query: string) {
  const managed = useManagedHost();
  const available = useMemo(
    () => SETTINGS_SECTION_META.filter((meta) => meta.id !== "managed" || managed.isManaged),
    [managed.isManaged],
  );
  return useMemo(() => matchSections(available, query), [available, query]);
}

/**
 * Settings, as a full-page takeover outside the app shell: ← Back leaves for
 * wherever the user came from (Home when they arrived here directly). Desktop
 * shows the grouped nav beside the section; a phone pushes from the section
 * list (`/settings`) to a section page and back.
 */
export function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  // Below 1024px the nav column would squeeze the list-and-form managers, so
  // a tablet uses the phone's push navigation too.
  const isMobile = useMediaQuery("(max-width: 1023.98px)");
  const managed = useManagedHost();
  const managedStatus = useManagedHostStatus();
  const leave = useSettingsReturn();
  useSettingsEscape(leave);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const matches = useSectionMatches(query);

  const valid = isSettingsSection(section) ? section : null;
  if (section !== undefined && !valid) {
    return <Navigate to={isMobile ? "/settings" : routes.settings()} replace />;
  }
  // Managed host settings exist only on a managed host; a direct link waits
  // for the host's answer before deciding.
  if (valid === "managed" && !managed.isManaged) {
    return managedStatus.isPending ? (
      <p role="status" className="type-body-chrome p-8 text-basic-tertiary">
        Checking managed host…
      </p>
    ) : (
      <Navigate to={routes.settings()} replace />
    );
  }

  if (isMobile) {
    return valid ? (
      <MobileSectionPage section={valid} onBack={() => navigate("/settings", { replace: true })} />
    ) : (
      <MobileSectionList query={query} setQuery={setQuery} matches={matches} onBack={leave} />
    );
  }

  if (!valid) return <Navigate to={routes.settings()} replace />;
  const wide = sectionMeta(valid).wide;
  return (
    <div className="flex h-full min-h-0 bg-elevation-ground text-basic-primary">
      <aside className="flex w-[264px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-muted bg-elevation-level-0-5 px-3 pb-6 pt-[52px]">
        <div className="flex flex-col gap-3 px-1">
          <div>
            <BackButton onClick={leave} label="Back" />
          </div>
          <h1 className="type-heading px-2 text-basic-primary">Settings</h1>
          <SettingsSearch value={query} onChange={setQuery} />
        </div>
        <SectionList matches={matches} current={valid} query={query} touch={false} />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto" aria-label={sectionMeta(valid).label}>
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-8 px-8 pb-16 pt-[52px] max-lg:px-6",
            wide ? "max-w-[960px]" : "max-w-[720px]",
          )}
        >
          <SectionHeading section={valid} />
          <SectionBody section={valid} />
        </div>
      </main>
    </div>
  );
}

function MobileBar({
  title,
  onBack,
  backLabel,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <header className="sticky top-0 z-20 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-elevation-ground/90 px-2 pb-1 pt-[max(4px,env(safe-area-inset-top))] backdrop-blur-md md:px-4 md:pt-[52px]">
      <div className="justify-self-start">
        <BackButton onClick={onBack} label={backLabel} />
      </div>
      {title ? <h1 className="type-strong truncate text-basic-primary">{title}</h1> : <span />}
      <div />
    </header>
  );
}

function MobileFrame({ children, bar }: { children: ReactNode; bar: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  // A pushed page starts at its top, like a new screen.
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 });
  }, [pathname]);
  return (
    <div
      ref={scroller}
      className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain bg-elevation-ground text-basic-primary"
    >
      {bar}
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-2 md:px-6">
        {children}
      </div>
    </div>
  );
}

function MobileSectionList({
  query,
  setQuery,
  matches,
  onBack,
}: {
  query: string;
  setQuery: (value: string) => void;
  matches: SectionMatch[];
  onBack: () => void;
}) {
  return (
    <MobileFrame bar={<MobileBar title="" onBack={onBack} backLabel="Back" />}>
      <h2 className="type-display px-1">Settings</h2>
      <SettingsSearch value={query} onChange={setQuery} />
      <SectionList matches={matches} current={null} query={query} touch />
    </MobileFrame>
  );
}

function MobileSectionPage({ section, onBack }: { section: SettingsSection; onBack: () => void }) {
  const meta = sectionMeta(section);
  return (
    <MobileFrame bar={<MobileBar title={meta.label} onBack={onBack} backLabel="Settings" />}>
      <main aria-label={meta.label} className="flex min-w-0 flex-col gap-6">
        <p className="type-body-chrome px-1 text-basic-secondary text-pretty">{meta.description}</p>
        <SectionBody section={section} />
      </main>
    </MobileFrame>
  );
}
