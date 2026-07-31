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
  Input,
  InputLeading,
  InputSize,
  Loader,
  LoaderSize,
  Logo,
  Modal,
  Select,
  SessionAvatar,
  Switch,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { useTheme } from "@/app/providers/ThemeProvider";

const SAMPLE_IDS = [
  "9f2c1ab4",
  "3de77c01",
  "b81004ff",
  "22aa93de",
  "7c0518ba",
  "e4419d27",
];

const MODELS = [
  { id: "sonnet", label: "Claude Sonnet", icon: IconName.Brain },
  { id: "opus", label: "Claude Opus", icon: IconName.Brain },
  { id: "gpt", label: "GPT", icon: IconName.Ai },
];

/**
 * Design-system preview, reachable at `#/design`. It stays after the app shell
 * lands as a fast way to eyeball the token port.
 */
export default function DesignPreviewPage() {
  const { theme, resolved, toggleTheme } = useTheme();
  const [model, setModel] = useState("sonnet");
  const [enabled, setEnabled] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="min-h-full bg-elevation-ground text-basic-primary">
      <header className="flex items-center gap-4 h-14 px-6 border-b border-secondary">
        <Logo height={18} />
        <span className="text-basic-muted label-small">design system</span>
        <div className="flex-1" />
        <span className="text-micro text-basic-muted">
          {theme} / {resolved}
        </span>
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Tertiary}
          content={ButtonContent.Icon}
          onClick={toggleTheme}
        >
          <Icon
            iconName={
              resolved === "dark" ? IconName.Moon : IconName.Sun
            }
          />
        </Button>
      </header>

      <main className="p-6 flex flex-col gap-6 max-w-[1100px]">
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
            <Button
              variant={ButtonVariant.Secondary}
              content={ButtonContent.IconLeft}
            >
              <Icon iconName={IconName.Add} />
              With icon
            </Button>
          </div>
        </BoxSurface>

        <BoxSurface title="Badges, loader, switch, tooltip">
          <div className="p-4 flex flex-wrap items-center gap-4">
            <Badge text="Running" color={BadgeColor.Green} />
            <Badge text="Queued" color={BadgeColor.Blue} />
            <Badge text="Failed" color={BadgeColor.Red} />
            <Badge text="Idle" color={BadgeColor.Gray} />
            <Loader size={LoaderSize.Small} />
            <Switch checked={enabled} onChange={setEnabled} />
            <Tooltip
              title="Pin session"
              description="Keeps the card at the top of the board."
              position={TooltipPosition.BottomCenter}
            >
              <Icon iconName={IconName.Pin} />
            </Tooltip>
            <Icon iconName={IconName.Unpin} />
          </div>
        </BoxSurface>

        <BoxSurface title="Inputs">
          <div className="p-4 flex flex-wrap items-end gap-4">
            <Input
              label="Working directory"
              inputSize={InputSize.Medium}
              placeholder="/Users/me/project"
              className="w-[320px]"
            />
            <Input
              label="Search"
              inputSize={InputSize.Medium}
              leading={InputLeading.Icon}
              leadingIconName={IconName.Search}
              placeholder="Filter sessions"
              hintText="Matches name and cwd"
              className="w-[280px]"
            />
            <Select
              items={MODELS}
              value={model}
              onValueChange={setModel}
              placeholder="Pick a model"
            />
            <Button
              variant={ButtonVariant.Secondary}
              onClick={() => setModalOpen(true)}
            >
              Open modal
            </Button>
          </div>
        </BoxSurface>

        <BoxSurface title="Session avatars">
          <div className="p-4 flex flex-wrap items-center gap-4">
            {SAMPLE_IDS.map((id) => (
              <div key={id} className="flex items-center gap-2">
                <SessionAvatar id={id} size={40} />
                <span className="code code-small text-basic-muted">{id}</span>
              </div>
            ))}
          </div>
        </BoxSurface>

        <BoxSurface title="Typography">
          <div className="p-4 flex flex-col gap-2">
            <div className="title">Title</div>
            <div className="header-medium">Header medium</div>
            <div className="label-small text-basic-secondary">Label small</div>
            <div className="paragraph-medium text-basic-secondary">
              Paragraph medium on the secondary text token.
            </div>
            <div className="code code-small text-basic-muted">
              code-small / IBM Plex Mono
            </div>
          </div>
        </BoxSurface>
      </main>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete session"
        footer={
          <>
            <Button
              variant={ButtonVariant.Secondary}
              onClick={() => setModalOpen(false)}
            >
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
        This is the shared modal shell: overlay click, Escape and a Tab focus
        trap all come from the atom.
      </Modal>
    </div>
  );
}
