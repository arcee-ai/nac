import { useState } from "react";
import {
  Avatar,
  AvatarSize,
  Badge,
  BadgeColor,
  BoxSurface,
  Button,
  ButtonContent,
  ButtonVariant,
  ChatLoader,
  Checkbox,
  CircularLoader,
  CodeBlock,
  CopyButton,
  DatePicker,
  DateSelector,
  type DateStringRange,
  EditableHeader,
  EditableHeaderSize,
  Icon,
  IconName,
  Input,
  InputLeading,
  InputSize,
  KeyboardShortcut,
  Loader,
  LoaderSize,
  Logo,
  ChatSessionMessage,
  ChatSessionMessageVariant,
  MessageBox,
  MessageBoxVariant,
  Modal,
  NumberInput,
  Pagination,
  Popover,
  PopoverPlacement,
  ProgressLoader,
  Radio,
  RangeInput,
  Select,
  SessionAvatar,
  ShimmerLoader,
  Switch,
  TagsSelector,
  TextArea,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";

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

const SAMPLE_CODE = `pub enum AgentEvent {
    RunStarted { thread_name: Option<String> },
    AssistantMessage {
        thread_name: Option<String>,
        content: String,
        usage: Option<TokenUsage>,
    },
    RunFinished { thread_name: Option<String> },
}`;

/**
 * Design-system preview, reachable at `#/design`. It stays after the app shell
 * lands as a fast way to eyeball the token port.
 */
export default function DesignPreviewPage() {
  const [model, setModel] = useState("sonnet");
  const [enabled, setEnabled] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [choice, setChoice] = useState("first");
  const [title, setTitle] = useState("Port the ArceeFM atoms");
  const [parallel, setParallel] = useState(4);
  const [temperature, setTemperature] = useState(0.7);
  const [environments, setEnvironments] = useState<string[]>(["local"]);
  const [page, setPage] = useState(1);
  const [day, setDay] = useState<string | null>(null);
  const [dayRange, setDayRange] = useState<DateStringRange>({
    from: null,
    to: null,
  });

  return (
    <div className="min-h-full bg-elevation-ground text-basic-primary">
      <header className="flex items-center gap-4 h-14 px-6 border-b border-secondary">
        <Logo height={18} />
        <span className="text-basic-muted label-small">design system</span>
      </header>

      <main className="p-6 flex flex-col gap-6 max-w-[1100px]">
        <BoxSurface title="Buttons">
          <div className="p-4 flex flex-wrap items-center gap-3">
            <Button variant={ButtonVariant.Primary}>Primary</Button>
            <Button variant={ButtonVariant.Secondary}>Secondary</Button>
            <Button variant={ButtonVariant.Tertiary}>Tertiary</Button>
            <Button variant={ButtonVariant.Ghost}>Ghost</Button>
            <Button variant={ButtonVariant.GhostDestructive}>
              Destructive
            </Button>
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
              sticky
              showTooltipOnMobile
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

        <BoxSurface title="Popover, copy, shortcuts">
          <div className="p-4 flex flex-wrap items-center gap-4">
            <Popover
              open={popoverOpen}
              onClose={() => setPopoverOpen(false)}
              placement={PopoverPlacement.BottomRight}
              // The surrounding box clips its overflow, so the panel is portalled.
              sticky
              content={
                <>
                  <div className="label-small text-basic-primary px-2 py-1">
                    Anchored panel
                  </div>
                  <div className="text-micro text-basic-muted px-2 pb-1">
                    Closes on Escape or a click outside. On a phone it becomes a
                    bottom sheet instead.
                  </div>
                </>
              }
            >
              <Button
                variant={ButtonVariant.Secondary}
                onClick={() => setPopoverOpen((current) => !current)}
              >
                Open popover
              </Button>
            </Popover>
            <CopyButton value="nac" />
            <KeyboardShortcut keys={["cmd", "shift", "k"]} />
          </div>
        </BoxSurface>

        <BoxSurface title="Choices and multi-line input">
          <div className="p-4 flex flex-wrap items-start gap-6">
            <div className="flex flex-col gap-2">
              <Checkbox checked={checked} onChange={setChecked}>
                Skip permission prompts
              </Checkbox>
              <Checkbox checked={false} onChange={() => {}} disabled>
                Disabled
              </Checkbox>
            </div>
            <div className="flex flex-col gap-2">
              <Radio
                name="preview-choice"
                checked={choice === "first"}
                onChange={() => setChoice("first")}
              >
                Working tree
              </Radio>
              <Radio
                name="preview-choice"
                checked={choice === "second"}
                onChange={() => setChoice("second")}
              >
                Latest snapshot
              </Radio>
            </div>
            <TextArea
              label="System prompt"
              rows={3}
              placeholder="Extra instructions for the agent"
              className="w-[320px]"
            />
          </div>
        </BoxSurface>

        <BoxSurface title="Notices and loaders">
          <div className="p-4 flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <MessageBox
                variant={MessageBoxVariant.Info}
                title="Read-only snapshot"
                className="w-[280px]"
              >
                Pick the working tree to edit files again.
              </MessageBox>
              <MessageBox
                variant={MessageBoxVariant.Error}
                title="Run failed"
                className="w-[280px]"
              >
                The provider rejected the request.
              </MessageBox>
              <MessageBox
                variant={MessageBoxVariant.Success}
                title="Branch switched"
                className="w-[280px]"
              />
            </div>
            <div className="flex flex-col gap-2 w-[398px]">
              <ChatSessionMessage
                variant={ChatSessionMessageVariant.Danger}
                title="Message Title"
                action={{ label: "Message CTA", onClick: () => {} }}
              >
                Message description
              </ChatSessionMessage>
              <ChatSessionMessage
                variant={ChatSessionMessageVariant.Error}
                title="Message Title"
                action={{ label: "Message CTA", onClick: () => {} }}
              >
                Message description
              </ChatSessionMessage>
              <ChatSessionMessage
                variant={ChatSessionMessageVariant.Success}
                title="Message Title"
                action={{ label: "Message CTA", onClick: () => {} }}
              >
                Message description
              </ChatSessionMessage>
              <ChatSessionMessage
                variant={ChatSessionMessageVariant.Info}
                title="Message Title"
                action={{ label: "Message CTA", onClick: () => {} }}
              >
                Message description
              </ChatSessionMessage>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <CircularLoader size={LoaderSize.Medium} />
              <ShimmerLoader rows={3} className="w-[200px]" />
              <ProgressLoader active className="w-[200px]" />
            </div>
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

        <BoxSurface title="Avatars and editable header">
          <div className="p-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name="Aleksy" size={AvatarSize.Small} />
              <Avatar name="Nac Orchestrator" />
              <Avatar name="Opus" size={AvatarSize.Large} />
              <Avatar name="🛠" glyph size={AvatarSize.Large} />
              <Avatar
                name="Anthropic"
                size={AvatarSize.XLarge}
                color="var(--color-bg-info-primary)"
              />
            </div>
            <EditableHeader
              value={title}
              onCommit={setTitle}
              size={EditableHeaderSize.Medium}
              className="max-w-[360px]"
            />
          </div>
        </BoxSurface>

        <BoxSurface title="Numeric inputs, tags and pagination">
          <div className="p-4 flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-8">
              <NumberInput
                value={parallel}
                onChange={setParallel}
                min={1}
                max={16}
                aria-label="Parallel threads"
              />
              <div className="flex items-center gap-4 w-[320px]">
                <RangeInput
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={setTemperature}
                  label="Temperature"
                />
                <span className="code code-small text-basic-muted w-8 shrink-0">
                  {temperature.toFixed(1)}
                </span>
              </div>
            </div>
            <TagsSelector
              tags={["local", "docker", "remote", "sandbox"]}
              selected={environments}
              onChange={setEnvironments}
            />
            <Pagination
              page={page}
              pageSize={10}
              totalItems={84}
              itemLabel="sessions"
              onPageChange={setPage}
              className="border-t border-muted"
            />
          </div>
        </BoxSurface>

        <BoxSurface title="Dates">
          <div className="p-4 flex flex-wrap items-start gap-6">
            <DateSelector
              label="Created after"
              value={day}
              onChange={setDay}
              className="w-[240px]"
            />
            <DateSelector
              label="Window"
              range={dayRange}
              onRangeChange={setDayRange}
              hintText="Two clicks pick the ends."
              className="w-[280px]"
            />
            <DatePicker
              selected={day ? new Date(`${day}T00:00:00`) : undefined}
              onSelect={(date) =>
                setDay(
                  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
                )
              }
              className="rounded-[8px] border border-muted bg-elevation-level-2"
            />
          </div>
        </BoxSurface>

        <BoxSurface title="Code block and chat loader">
          <div className="p-4 flex flex-col gap-4">
            <CodeBlock
              code={SAMPLE_CODE}
              language="rust"
              title="events.rs"
              lineNumbers
              expandable
              maxHeight="220px"
            />
            <ChatLoader />
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
