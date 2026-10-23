import { BoxSurface, ChatSessionOrphanAvatar, SessionAvatar } from "@/app/atoms";
import { SAMPLE_IDS } from "@/app/components/pages/design-preview/samples";

export function SessionAvatarsSection() {
  return (
    <BoxSurface title="Session avatars">
      <div className="p-4 flex flex-wrap items-center gap-4">
        {SAMPLE_IDS.map((id) => (
          <div key={id} className="flex items-center gap-2">
            <SessionAvatar id={id} size={40} />
            <span className="code code-small text-basic-muted">{id}</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <ChatSessionOrphanAvatar />
          <span className="code code-small text-basic-muted">unassigned</span>
        </div>
      </div>
    </BoxSurface>
  );
}
