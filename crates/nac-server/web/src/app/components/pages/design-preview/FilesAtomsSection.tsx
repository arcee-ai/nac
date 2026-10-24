import { Fragment, useState } from "react";
import {
  BoxSurface,
  CodeChangesBadge,
  CodeChangesBadgeSize,
  FileButton,
  FileButtonSize,
  FileButtonsList,
  type FileButtonsListFile,
} from "@/app/atoms";

const SIZES = [
  { size: FileButtonSize.Large, badge: CodeChangesBadgeSize.Large, title: "Large" },
  { size: FileButtonSize.Medium, badge: CodeChangesBadgeSize.Medium, title: "Medium" },
  { size: FileButtonSize.Small, badge: CodeChangesBadgeSize.Small, title: "Small" },
];

const SAMPLE_PATH = "src/app/components/index.tsx";
const LONG_PATH = "src/app/components/calendar/RecurringEventsTimeZonePicker.tsx";

const BUTTON_STATES: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  additions?: number;
  deletions?: number;
}[] = [
  { title: "Default", additions: 279, deletions: 84 },
  { title: "Active", active: true, additions: 279, deletions: 84 },
  { title: "Disabled", disabled: true, additions: 279, deletions: 84 },
  { title: "Active, disabled", active: true, disabled: true, additions: 279, deletions: 84 },
  { title: "Without counts" },
];

const BADGE_SAMPLES = [
  { title: "Both", additions: 279, deletions: 84 },
  { title: "Additions only", additions: 12 },
  { title: "Deletions only", deletions: 1 },
];

const LIST_FILES: FileButtonsListFile[] = [
  { path: "src/app/components/index.tsx", additions: 279, deletions: 84 },
  { path: "src/app/lib/parser.ts", additions: 42, deletions: 17 },
  { path: "src/app/lib/lexer.ts", additions: 8, deletions: 3 },
  { path: "src/app/theme/tokens.css", additions: 16, deletions: 16 },
  { path: "docs/getting-started.md", additions: 31, deletions: 0 },
  { path: "crates/demo-core/src/lib.rs", additions: 120, deletions: 45 },
  { path: "crates/demo-core/Cargo.toml", additions: 2, deletions: 1 },
  { path: "package.json", additions: 3, deletions: 2 },
  { path: "scripts/release.sh", additions: 14, deletions: 9 },
  { path: "src/app/hooks/useCalendar.ts", additions: 66, deletions: 12 },
  { path: "src/app/components/CalendarView.tsx", additions: 98, deletions: 40 },
  { path: "src/app/components/EventCard.tsx", additions: 25, deletions: 7 },
  { path: "tests/parser.test.ts", additions: 54, deletions: 0 },
  { path: ".github/workflows/ci.yml", additions: 6, deletions: 4 },
  { path: "Dockerfile", additions: 1, deletions: 1 },
  { path: "src/app/styles/calendar.scss", additions: 19, deletions: 22 },
  { path: LONG_PATH, additions: 1204, deletions: 377 },
];

/** The Insights detail column's ground, where these buttons sit. */
const GROUND = "bg-elevation-ground p-2";

const noop = () => {};

function ButtonStatesPreview() {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-micro text-basic-muted">File button</span>
      <div className="grid w-fit grid-cols-[auto_repeat(3,auto)] items-center gap-x-4 gap-y-2">
        <span />
        {SIZES.map(({ size, title }) => (
          <span key={size} className="label-micro text-basic-muted">
            {title}
          </span>
        ))}
        {BUTTON_STATES.map((state) => (
          <Fragment key={state.title}>
            <span className="label-micro text-basic-tertiary">{state.title}</span>
            {SIZES.map(({ size }) => (
              <div key={size} className={GROUND}>
                <FileButton
                  path={SAMPLE_PATH}
                  size={size}
                  active={state.active}
                  disabled={state.disabled}
                  additions={state.additions}
                  deletions={state.deletions}
                  onClick={noop}
                />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function TruncationPreview() {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-micro text-basic-muted">A long name in 200px</span>
      <div className="flex flex-wrap items-start gap-4">
        {SIZES.map(({ size }) => (
          <div key={size} className={`w-[200px] ${GROUND}`}>
            <FileButton
              path={LONG_PATH}
              size={size}
              additions={1204}
              deletions={377}
              onClick={noop}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function BadgePreview() {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-micro text-basic-muted">Code changes badge</span>
      <div className="grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2">
        <span />
        {BADGE_SAMPLES.map(({ title }) => (
          <span key={title} className="label-micro text-basic-muted">
            {title}
          </span>
        ))}
        {SIZES.map(({ badge, title }) => (
          <Fragment key={badge}>
            <span className="label-micro text-basic-tertiary">{title}</span>
            {BADGE_SAMPLES.map((sample) => (
              <CodeChangesBadge
                key={sample.title}
                size={badge}
                additions={sample.additions}
                deletions={sample.deletions}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Opening a file highlights it, the way Files highlights the file it shows. */
function OpenableList({
  files,
  size,
  caption,
}: {
  files: FileButtonsListFile[];
  size: FileButtonSize;
  caption: string;
}) {
  const [open, setOpen] = useState(files[1]?.path ?? null);
  return (
    <div className="flex w-[280px] flex-col gap-2">
      <span className="label-micro text-basic-muted">{caption}</span>
      <div className={GROUND}>
        <FileButtonsList
          aria-label="Changed files"
          size={size}
          files={files.map((file) => ({ ...file, active: file.path === open }))}
          onOpen={setOpen}
        />
      </div>
      <span className="label-micro text-basic-tertiary">Open file: {open ?? "none"}</span>
    </div>
  );
}

function ListsPreview() {
  return (
    <div className="flex flex-wrap items-start gap-6">
      {SIZES.map(({ size, title }) => (
        <OpenableList
          key={size}
          size={size}
          files={LIST_FILES.slice(0, 5)}
          caption={`List, 5 files, ${title}`}
        />
      ))}
      <OpenableList
        size={FileButtonSize.Small}
        files={LIST_FILES}
        caption="List, 17 files, Small"
      />
    </div>
  );
}

export function FilesAtomsSection() {
  return (
    <BoxSurface title="Files">
      <div className="p-4 flex flex-col gap-6">
        <ButtonStatesPreview />
        <TruncationPreview />
        <BadgePreview />
        <ListsPreview />
      </div>
    </BoxSurface>
  );
}
