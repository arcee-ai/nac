import { useState } from "react";
import { Avatar, AvatarSize, BoxSurface, EditableHeader, EditableHeaderSize } from "@/app/atoms";

export function AvatarsSection() {
  const [title, setTitle] = useState("Port the ArceeFM atoms");

  return (
    <BoxSurface title="Avatars and editable header">
      <div className="p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name="Aleksy" size={AvatarSize.Small} />
          <Avatar name="NAC Orchestrator" />
          <Avatar name="Opus" size={AvatarSize.Large} />
          <Avatar name="🛠" glyph size={AvatarSize.Large} />
          <Avatar name="Anthropic" size={AvatarSize.XLarge} color="var(--color-bg-info-primary)" />
        </div>
        <EditableHeader
          value={title}
          onCommit={setTitle}
          size={EditableHeaderSize.Medium}
          className="max-w-[360px]"
        />
      </div>
    </BoxSurface>
  );
}
