import { useState } from "react";
import { Button, ButtonVariant, Logo, Modal } from "@/app/atoms";
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
import { PopoverSection } from "@/app/components/pages/design-preview/PopoverSection";
import { ReasoningSection } from "@/app/components/pages/design-preview/ReasoningSection";
import { SessionAvatarsSection } from "@/app/components/pages/design-preview/SessionAvatarsSection";
import { SessionIdentitySection } from "@/app/components/pages/design-preview/SessionIdentitySection";
import { SubagentCardSection } from "@/app/components/pages/design-preview/SubagentCardSection";
import { ToolsBadgeSection } from "@/app/components/pages/design-preview/ToolsBadgeSection";
import { TypographySection } from "@/app/components/pages/design-preview/TypographySection";

/**
 * Design-system preview, reachable at `#/design`. It stays after the app shell
 * lands as a fast way to eyeball the token port.
 */
export default function DesignPreviewPage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto bg-elevation-ground text-basic-primary">
      <header className="flex items-center gap-4 h-14 px-6 border-b border-secondary">
        <Logo height={18} />
        <span className="text-basic-muted label-small">design system</span>
      </header>

      <main className="p-6 flex flex-col gap-6 max-w-[1100px]">
        <ReasoningSection />
        <ButtonsSection />
        <BadgesSection />
        <InputsSection onOpenModal={() => setModalOpen(true)} />
        <PopoverSection />
        <ChoicesSection />
        <NoticesSection />
        <SessionAvatarsSection />
        <SessionIdentitySection />
        <ModelLoaderSection />
        <ToolsBadgeSection />
        <InsightsAtomsSection />
        <FilesAtomsSection />
        <SubagentCardSection />
        <AvatarsSection />
        <NumericInputsSection />
        <DatesSection />
        <CodeBlockSection />
        <TypographySection />
      </main>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete session"
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
        This is the shared modal shell: overlay click, Escape and a Tab focus trap all come from the
        atom.
      </Modal>
    </div>
  );
}
