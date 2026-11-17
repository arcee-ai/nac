import { useState } from "react";
import {
  Badge,
  BadgeColor,
  BoxSurface,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  StatusDot,
  Switch,
  SwitchSize,
} from "@/app/atoms";
import { Specimen } from "@/app/components/pages/design-preview/Showcase";

/** Header pills: they render only when they have something to say. */
function HeaderPills() {
  return (
    <>
      <Button
        variant={ButtonVariant.Secondary}
        size={ButtonSize.Small}
        aria-label="Changes, 12 added, 3 removed"
      >
        <span className="tabular text-success-primary">+12</span>
        <span className="tabular text-error-primary">−3</span>
      </Button>
      <Button
        variant={ButtonVariant.Secondary}
        size={ButtonSize.Small}
        content={ButtonContent.IconLeft}
        aria-label="3 agents, 1 running"
      >
        <StatusDot status="working" />3 agents
      </Button>
      <Button
        variant={ButtonVariant.Secondary}
        size={ButtonSize.Small}
        content={ButtonContent.IconLeft}
      >
        <Icon iconName={IconName.Flag} />
        Goal
      </Button>
      <Button
        variant={ButtonVariant.SecondaryHighlighted}
        size={ButtonSize.Small}
        content={ButtonContent.IconRight}
      >
        Agent
        <Icon iconName={IconName.Down} />
      </Button>
    </>
  );
}

export function BadgesSection() {
  const [enabled, setEnabled] = useState(true);
  const [large, setLarge] = useState(false);

  return (
    <BoxSurface title="Badges, chips and switches">
      <Specimen label="Badges" hint="11px, sentence case, a soft wash.">
        <Badge text="Running" color={BadgeColor.Neutral} />
        <Badge text="Needs approval" color={BadgeColor.Yellow} />
        <Badge text="Failed" color={BadgeColor.Red} />
        <Badge text="Merged" color={BadgeColor.Green} />
        <Badge text="Docs" color={BadgeColor.Blue} />
        <Badge text="Idle" color={BadgeColor.Gray} />
        <Badge text="No wash" color={BadgeColor.Red} background={false} />
      </Specimen>
      <Specimen label="Chips" hint="24px pills: header pills, composer chips.">
        <HeaderPills />
      </Specimen>
      <Specimen label="Switch" hint="Ink track when on, in either theme.">
        <Switch checked={enabled} onChange={setEnabled} aria-label="Notifications" />
        <Switch
          checked={large}
          onChange={setLarge}
          size={SwitchSize.Large}
          aria-label="Large switch"
        />
        <Switch checked disabled aria-label="On, disabled" />
        <Switch checked={false} disabled aria-label="Off, disabled" />
      </Specimen>
    </BoxSurface>
  );
}
