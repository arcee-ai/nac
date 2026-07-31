import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Logo,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { useStoreInfo } from "@/app/services/queries";

const REPO_URL = "https://github.com/arcee-ai/nac";
const DOCS_URL = "https://github.com/arcee-ai/nac#readme";

// Figma "HeaderSurface": the same ground-to-transparent gradient stacked twice,
// spanning the bar plus a 28px overhang that fades the content scrolling below.
const GROUND_FADE =
  "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))";
const SURFACE_STYLE = { backgroundImage: `${GROUND_FADE}, ${GROUND_FADE}` };

export function TopBar() {
  const { data: storeInfo } = useStoreInfo();
  const storePath = storeInfo?.store_path ?? "store path pending";

  return (
    <header className="fixed inset-x-0 top-0 z-10 flex items-center gap-4 h-[52px] px-4 py-2 shrink-0">
      <div
        className="absolute inset-x-0 top-0 -bottom-4 pointer-events-none"
        style={SURFACE_STYLE}
      />
      <div className="relative flex items-center gap-8 min-w-0">
        <Logo height={28} className="text-basic-primary shrink-0" />
        <Breadcrumbs />
      </div>
      <div className="relative flex items-center gap-3 ml-auto shrink-0">
        <Tooltip title={storePath} position={TooltipPosition.BottomRight}>
          <div className="code code-small text-basic-muted truncate max-w-[320px] hidden md:block">
            {storePath}
          </div>
        </Tooltip>
        <ThemeToggle size={ButtonSize.Medium} />
        <Tooltip title="Source on GitHub" position={TooltipPosition.BottomRight}>
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.Icon}
            onClick={() => window.open(REPO_URL, "_blank", "noopener")}
            aria-label="Source on GitHub"
          >
            <Icon iconName={IconName.Github} />
          </Button>
        </Tooltip>
        <Button
          variant={ButtonVariant.Secondary}
          size={ButtonSize.Medium}
          content={ButtonContent.IconRight}
          onClick={() => window.open(DOCS_URL, "_blank", "noopener")}
        >
          Docs
          <Icon iconName={IconName.External} />
        </Button>
      </div>
    </header>
  );
}
