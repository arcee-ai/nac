import { BoxSurface } from "@/app/atoms";

export function TypographySection() {
  return (
    <BoxSurface title="Typography">
      <div className="p-4 flex flex-col gap-2">
        <div className="title">Title</div>
        <div className="header-medium">Header medium</div>
        <div className="label-small text-basic-secondary">Label small</div>
        <div className="paragraph-medium text-basic-secondary">
          Paragraph medium on the secondary text token.
        </div>
        <div className="code code-small text-basic-muted">code-small / IBM Plex Mono</div>
      </div>
    </BoxSurface>
  );
}
