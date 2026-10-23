import {
  BoxSurface,
  ChatSessionButton,
  ChatSessionTab,
  ForkSessionItem,
  ProjectButton,
  ProjectButtonVariant,
} from "@/app/atoms";
import { SAMPLE_IDS } from "@/app/components/pages/design-preview/samples";

export function SessionIdentitySection() {
  return (
    <BoxSurface title="Project navigation">
      <div className="p-4 flex flex-col gap-6">
        <div className="flex items-start gap-2">
          <ChatSessionTab title="Fix the parser" active />
          <ChatSessionTab title="Rewrite the store layer" />
          <ChatSessionTab title="Investigating" running />
          <ChatSessionTab title="Fork: Fix the parser" forkedFromTitle="Fix the parser" />
          <ChatSessionTab title="Fork running" forkedFromTitle="Fix the parser" running />
        </div>
        <div className="flex flex-col gap-1 max-w-[320px]">
          <ChatSessionButton title="Fix the parser" active />
          <ChatSessionButton title="Rewrite the store layer" />
          <ChatSessionButton title="Investigating" running />
          <ChatSessionButton title="Fork: Fix the parser" forkedFromTitle="Fix the parser" />
          <ChatSessionButton title="Fork running" forkedFromTitle="Fix the parser" running />
        </div>
        <div className="flex flex-col gap-2 max-w-[320px]">
          <ForkSessionItem sessionId="14231vsd7897-aaaa" title="Fork: Session title" />
          <ForkSessionItem sessionId="14231vsd7897-aaaa" title="Fork: Session title" deleted />
        </div>
        <div className="flex flex-col gap-1 max-w-[320px]">
          <ProjectButton entityId={SAMPLE_IDS[3]} name="arcee-ai/nac" trailing="4" active />
          <ProjectButton entityId={SAMPLE_IDS[4]} name="arcee-ai/telos" trailing="1" running />
          <ProjectButton
            entityId={SAMPLE_IDS[5]}
            name="Unassigned session"
            variant={ProjectButtonVariant.Orphan}
          />
        </div>
      </div>
    </BoxSurface>
  );
}
