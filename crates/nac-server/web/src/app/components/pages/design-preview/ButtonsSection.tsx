import { BoxSurface, Button, ButtonContent, ButtonVariant, Icon, IconName } from "@/app/atoms";

export function ButtonsSection() {
  return (
    <BoxSurface title="Buttons">
      <div className="p-4 flex flex-wrap items-center gap-3">
        <Button variant={ButtonVariant.Primary}>Primary</Button>
        <Button variant={ButtonVariant.Secondary}>Secondary</Button>
        <Button variant={ButtonVariant.Tertiary}>Tertiary</Button>
        <Button variant={ButtonVariant.Ghost}>Ghost</Button>
        <Button variant={ButtonVariant.GhostDestructive}>Destructive</Button>
        <Button variant={ButtonVariant.Primary} loading>
          Loading
        </Button>
        <Button variant={ButtonVariant.Secondary} disabled>
          Disabled
        </Button>
        <Button variant={ButtonVariant.Secondary} content={ButtonContent.IconLeft}>
          <Icon iconName={IconName.Add} />
          With icon
        </Button>
      </div>
    </BoxSurface>
  );
}
