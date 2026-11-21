import { useState } from "react";
import { Button, ButtonVariant, Logo, Modal, ModalSize } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { useTheme } from "@/app/providers/ThemeProvider";
import { AvatarsSection } from "@/app/components/pages/design-preview/AvatarsSection";
import { BadgesSection } from "@/app/components/pages/design-preview/BadgesSection";
import { ButtonsSection } from "@/app/components/pages/design-preview/ButtonsSection";
import { ChoicesSection } from "@/app/components/pages/design-preview/ChoicesSection";
import { CodeBlockSection } from "@/app/components/pages/design-preview/CodeBlockSection";
import { DatesSection } from "@/app/components/pages/design-preview/DatesSection";
import { FilesAtomsSection } from "@/app/components/pages/design-preview/FilesAtomsSection";
import { InputsSection } from "@/app/components/pages/design-preview/InputsSection";
import { InsightsAtomsSection } from "@/app/components/pages/design-preview/InsightsAtomsSection";
import { ModelLoaderSection } from "@/app/components/pages/design-preview/ModelLoaderSection";
import { NoticesSection } from "@/app/components/pages/design-preview/NoticesSection";
import { NumericInputsSection } from "@/app/components/pages/design-preview/NumericInputsSection";
import { OverlaysSection } from "@/app/components/pages/design-preview/OverlaysSection";
import { PaletteSection } from "@/app/components/pages/design-preview/PaletteSection";
import { QualificationSection } from "@/app/components/pages/design-preview/QualificationSection";
import { ReasoningSection } from "@/app/components/pages/design-preview/ReasoningSection";
import { SessionAvatarsSection } from "@/app/components/pages/design-preview/SessionAvatarsSection";
import { SessionIdentitySection } from "@/app/components/pages/design-preview/SessionIdentitySection";
import { ShapeSection } from "@/app/components/pages/design-preview/ShapeSection";
import { ShowcaseGroup } from "@/app/components/pages/design-preview/Showcase";
import { StatusSection } from "@/app/components/pages/design-preview/StatusSection";
import { SubagentCardSection } from "@/app/components/pages/design-preview/SubagentCardSection";
import { ToolsBadgeSection } from "@/app/components/pages/design-preview/ToolsBadgeSection";
import { TypographySection } from "@/app/components/pages/design-preview/TypographySection";

const GROUPS = [
  { id: "foundations", title: "Foundations" },
  { id: "controls", title: "Controls" },
  { id: "feedback", title: "Status and feedback" },
  { id: "overlays", title: "Floating layers" },
  { id: "conversation", title: "Conversation" },
  { id: "navigation", title: "Sessions and navigation" },
  { id: "workspace", title: "Workspace" },
] as const;

const THEME_OPTIONS = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

/**
 * The app theme, switched in place so every portalled layer follows. The
 * provider may be partial (some fixtures stub it), so this reads defensively
 * and hides itself when it cannot switch.
 */
function ThemeSwitch() {
  const context = useTheme() as Partial<ReturnType<typeof useTheme>> | undefined;
  const setTheme = context?.setTheme;
  if (!setTheme) return null;
  const current = context?.theme ?? "system";
  return (
    <div
      role="radiogroup"
      aria-label="Preview theme"
      className="inline-flex items-center gap-0.5 rounded-pill bg-elevation-sublevel-variant-B p-0.5"
    >
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={current === option.id}
          onClick={() => setTheme(option.id)}
          className={cn(
            "type-label h-7 rounded-pill px-3 transition-colors duration-150 ease-out motion-reduce:transition-none",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-border-focus-outline)]",
            current === option.id
              ? "bg-elevation-level-1 text-basic-primary shadow-md"
              : "text-basic-tertiary hover:text-basic-primary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** In-page contents. Buttons rather than hash links: the app routes on the hash. */
function Contents({ className }: { className?: string }) {
  return (
    <nav aria-label="Showcase contents" className={className}>
      <ul className="flex flex-col gap-0.5">
        {GROUPS.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              className="type-body-chrome flex h-8 w-full items-center rounded-md px-2.5 text-left text-basic-tertiary transition-colors duration-150 ease-out hover:bg-elevation-sublevel-variant-B hover:text-basic-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus-outline)]"
              onClick={() =>
                document
                  .getElementById(group.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {group.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The Focus design system, reachable at `#/design`: tokens, the shared atoms
 * and the product atoms, live, in whichever
 * theme the switch picks.
 */
export default function DesignPreviewPage() {
  return (
    <div className="h-full overflow-y-auto bg-elevation-ground text-basic-primary">
      <header className="sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-muted bg-elevation-ground/90 px-5 backdrop-blur-md">
        <Logo height={16} />
        <span className="type-strong min-w-0 truncate text-basic-tertiary">design system</span>
        <div className="flex-1" />
        <ThemeSwitch />
      </header>

      <div className="mx-auto flex w-full max-w-[1240px] gap-10 px-4 py-8 md:px-8 md:py-12">
        <Contents className="sticky top-[84px] hidden h-fit w-[184px] shrink-0 xl:block" />
        <main className="flex min-w-0 flex-1 flex-col gap-14">
          <div className="flex flex-col gap-3">
            <h1 className="type-display text-basic-primary">Focus</h1>
            <p className="type-body max-w-[62ch] text-basic-secondary">
              Quiet, airy, confident. Warm-neutral paper with ink on it; colour only when it means
              something. Hairlines at rest, soft shadows on floating layers, pills for every
              control, and one status ladder everywhere.
            </p>
          </div>

          <ShowcaseGroup
            id="foundations"
            title="Foundations"
            description="The palette in both themes, the one type scale, the radius scale, elevation and motion."
          >
            <PaletteSection />
            <TypographySection />
            <ShapeSection />
          </ShowcaseGroup>

          <ShowcaseGroup
            id="controls"
            title="Controls"
            description="Buttons, fields, choices and chips. Hover, press and keyboard focus are live."
          >
            <ButtonsSection />
            <InputsAndModalPreview />
            <ChoicesSection />
            <BadgesSection />
            <NumericInputsSection />
            <DatesSection />
          </ShowcaseGroup>

          <ShowcaseGroup
            id="feedback"
            title="Status and feedback"
            description="Needs approval, needs an answer, failed, working, waiting, done, idle — and the notices that explain them."
          >
            <StatusSection />
            <NoticesSection />
            <ModelLoaderSection />
          </ShowcaseGroup>

          <ShowcaseGroup
            id="overlays"
            title="Floating layers"
            description="Popovers, tooltips, toasts, drawers and sheets share one layer stack: Escape closes the top one and focus returns where it came from."
          >
            <OverlaysSection />
          </ShowcaseGroup>

          <ShowcaseGroup
            id="conversation"
            title="Conversation"
            description="A centred 15px column: plain-prose answers, folded reasoning and tools, subagent cards."
          >
            <ReasoningSection />
            <QualificationSection />
            <ToolsBadgeSection />
            <SubagentCardSection />
            <CodeBlockSection />
          </ShowcaseGroup>

          <ShowcaseGroup
            id="navigation"
            title="Sessions and navigation"
            description="Session rows, tabs, avatars and identity in the sidebar and the header."
          >
            <SessionIdentitySection />
            <SessionAvatarsSection />
            <AvatarsSection />
          </ShowcaseGroup>

          <ShowcaseGroup
            id="workspace"
            title="Workspace"
            description="Files, diffs and insights inside the drawers."
          >
            <FilesAtomsSection />
            <InsightsAtomsSection />
          </ShowcaseGroup>
        </main>
      </div>
    </div>
  );
}

/** Modal interaction belongs to its example, leaving the other showcase sections settled. */
function InputsAndModalPreview() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <InputsSection onOpenModal={() => setModalOpen(true)} />
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete session"
        size={ModalSize.Small}
        footer={
          <>
            <Button variant={ButtonVariant.Secondary} onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={ButtonVariant.SecondaryDestructive}
              onClick={() => setModalOpen(false)}
            >
              Delete
            </Button>
          </>
        }
      >
        <p>
          “Fix the flaky parser test” and its transcript, subagents and schedules will be deleted.
          This cannot be undone.
        </p>
        <p className="type-meta mt-2 text-basic-tertiary">
          The shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom.
        </p>
      </Modal>
    </>
  );
}
