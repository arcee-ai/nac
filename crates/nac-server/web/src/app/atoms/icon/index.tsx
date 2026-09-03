import React, { useId } from "react";
import { iconPaths } from "./icon-paths";

// Enums
export enum IconName {
  Checklist = "checklist",
  Features = "features",
  Publish = "publish",
  Toolbox = "toolbox",
  Play = "play",
  Pause = "pause",
  Add = "add",
  Chat = "chat",
  AddChat = "addChat",
  Home = "home",
  Coursor = "coursor",
  Hand = "hand",
  Order = "order",
  ZoomIn = "zoomIn",
  ZoomOut = "zoomOut",
  TurnLeft = "turnLeft",
  TurnRight = "turnRight",
  History = "history",
  Env = "env",
  AddNote = "addNote",
  Controls = "controls",
  ArrowLeft = "arrowLeft",
  Down = "down",
  Left = "left",
  ArrowRight = "arrowRight",
  Right = "right",
  Top = "top",
  Grid = "grid",
  ArrowTop = "arrowTop",
  Trash = "trash",
  ArrowDown = "arrowDown",
  Close = "close",
  Clock = "clock",
  Hamburger = "hamburger",
  BookOpen = "bookOpen",
  Ai = "ai",
  Book = "book",
  FileCopy = "fileCopy",
  FileCopyFilled = "fileCopyFilled",
  FileUpload = "fileUpload",
  ReadFile = "readFile",
  Search = "search",
  SearchFile = "searchFile",
  SearchFiles = "searchFiles",
  PlayHistory = "playHistory",
  MenuHorizontal = "menuHorizontal",
  HideSidebar = "hideSidebar",
  MenuVertical = "menuVertical",
  Tag = "tag",
  TagAdd = "tagAdd",
  Moon = "moon",
  Sun = "sun",
  Desktop = "desktop",
  DoubleArrowsVertical = "doubleArrowsVertical",
  FinanceMode = "financeMode",
  Refresh = "refresh",
  Info = "info",
  FolderCopy = "folderCopy",
  Important = "important",
  Globe = "globe",
  Filter = "filter",
  Microphone = "microphone",
  Image = "image",
  Attachment = "attachment",
  Plane = "plane",
  PlaneAdd = "planeAdd",
  Headphones = "headphones",
  Bolt = "bolt",
  Private = "private",
  Scheme = "scheme",
  Repair = "repair",
  Flow = "flow",
  Folder = "folder",
  Folders = "folders",
  Edit = "edit",
  AddCircle = "addCircle",
  Loader = "loader",
  Gear = "gear",
  Exit = "exit",
  Archive = "archive",
  FolderOpen = "folderOpen",
  Flag = "flag",
  DoubleArrowHorizontal = "doubleArrowHorizontal",
  Code = "code",
  List = "list",
  UserData = "userData",
  Text = "text",
  Check = "check",
  FullScreen = "fullScreen",
  Function = "function",
  Combine = "combine",
  Danger = "danger",
  Download = "download",
  Stop = "stop",
  // Deliberate aliases: these names reuse an existing glyph.
  /* eslint-disable @typescript-eslint/no-duplicate-enum-values */
  JSON = "code",
  File = "attachment",
  /* eslint-enable @typescript-eslint/no-duplicate-enum-values */
  Remove = "remove",
  AddBox = "addBox",
  Layers = "layers",
  Eye = "eye",
  EyeStrikethrough = "eyeStrikethrough",
  BoltStrikethrough = "boltStrikethrough",
  Drag = "drag",
  Lock = "lock",
  Javascript = "javascript",
  Python = "python",
  FullScreenExit = "fullScreenExit",
  Person = "person",
  People = "people",
  Group = "group",
  Arcee = "arcee",
  Cart = "cart",
  Google = "google",
  Timelaps = "timelaps",
  Token = "token",
  CloseSidebar = "closeSidebar",
  OpenSidebar = "openSidebar",
  Money = "money",
  AddCreditCard = "addCreditCard",
  External = "external",
  ScreenView = "screenView",
  Activity = "activity",
  Purchase = "purchase",
  Key = "key",
  Discord = "discord",
  Dollar = "dollar",
  Temperature = "temperature",
  CheckCircle = "checkCircle",
  Server = "server",
  Retry = "retry",
  Provider = "provider",
  Github = "github",
  Price = "price",
  Calendar = "calendar",
  Terminal = "terminal",
  WriteCommand = "writeCommand",
  Chunk = "chunk",
  Markdown = "markdown",
  String = "string",
  Brain = "brain",
  SearchPage = "searchPage",
  Pin = "pin",
  Unpin = "unpin",
  OpenMobileModal = "openMobileModal",
  ChatGpt = "chatGpt",
  Robot = "robot",
  Orchestrator = "orchestrator",
}

interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "color"> {
  iconName: IconName;
  /** CSS color for the glyph. Stylesheets can still override it via `fill`. */
  color?: string;
  size?: number;
  /**
   * Same tokens and timing as `text-shimmer-basic`. `background-clip: text`
   * cannot paint an SVG path (`fill: currentColor` would go transparent).
   */
  shimmer?: boolean;
}

const DEFAULT_VIEW_BOX = "0 0 24 24";

const pathSegments = (d: string | readonly string[] | undefined): readonly string[] =>
  d == null ? [""] : typeof d === "string" ? [d] : d;

const getGlyph = (iconName: IconName) => {
  const entry = iconPaths[iconName];
  if (entry?.kind === "glyph") {
    return {
      viewBox: entry.viewBox,
      segments: pathSegments(entry.d),
      fillRule: entry.fillRule,
    };
  }
  return {
    viewBox: DEFAULT_VIEW_BOX,
    segments: pathSegments(entry?.d),
    fillRule: entry?.fillRule,
  };
};

/**
 * Normalize icon name string by converting to lowercase, trimming, and removing underscores/dashes
 * Also handles camelCase by removing capital letters (converts to lowercase)
 * @param iconName - Icon name string from backend (e.g., "Search", "book_open", "book-open", "BookOpen", "bookOpen")
 * @returns Normalized string (e.g., "search", "bookopen")
 */
const normalizeIconName = (iconName: string): string => {
  return iconName
    .trim()
    .replace(/[_-]/g, "") // Remove underscores and dashes
    .toLowerCase(); // Convert to lowercase (handles camelCase like "bookOpen" -> "bookopen")
};

/**
 * Map backend icon name string to IconName enum
 * Handles various formats: "Search", "search", "book_open", "book-open", "BookOpen", "bookOpen", etc.
 * This is reverse mapping from enum values - maps all string variations to enum keys
 * @param iconNameString - Icon name string from backend
 * @param defaultIcon - Default IconName to return if no match found
 * @returns IconName enum value
 */
export const mapIconName = (
  iconNameString: string | undefined | null,
  defaultIcon: IconName = IconName.Search,
): IconName => {
  if (!iconNameString) {
    return defaultIcon;
  }

  const normalized = normalizeIconName(iconNameString);

  // Try to find matching enum value
  // Check each enum value's normalized form
  for (const [key, value] of Object.entries(IconName)) {
    const normalizedEnumValue = normalizeIconName(value);
    if (normalized === normalizedEnumValue) {
      // SAFETY: the key came from Object.entries of the enum itself, so it is
      // one of the enum's own member names.
      return IconName[key as keyof typeof IconName];
    }
  }

  // If no exact match, return default
  return defaultIcon;
};

// Component
const Icon: React.FC<IconProps> & { Name: typeof IconName } = ({
  iconName = IconName.Checklist,
  color,
  size = 20,
  className = "",
  style,
  shimmer = false,
  ...props
}) => {
  const { segments, viewBox, fillRule } = getGlyph(iconName);
  const gradientId = `icon-shimmer-${useId().replace(/:/g, "")}`;
  const fill = shimmer ? `url(#${gradientId})` : "currentColor";
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={color && !shimmer ? { color, ...style } : style}
      {...props}
    >
      {shimmer ? (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="objectBoundingBox"
            x1="-1"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor="var(--color-text-basic-secondary)" />
            <stop offset="50%" stopColor="var(--color-text-basic-muted)" />
            <stop offset="100%" stopColor="var(--color-text-basic-secondary)" />
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="-1 0"
              to="1 0"
              dur="2s"
              repeatCount="indefinite"
            />
          </linearGradient>
        </defs>
      ) : null}
      {segments.map((d, index) => (
        <path key={index} d={d} fill={fill} fillRule={fillRule} />
      ))}
    </svg>
  );
};

// Attach enum to Icon
Icon.Name = IconName;

export default Icon;
