import type React from "react";
import {
  Activity,
  AppWindow,
  Archive,
  ArrowDown,
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftFromLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowRightFromLine,
  ArrowUp,
  ArrowUpRight,
  ArrowUpToLine,
  Book,
  BookOpen,
  Bot,
  Brain,
  Calendar,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CirclePlay,
  CirclePlus,
  Clock,
  Cloud,
  Coins,
  Combine,
  ContactRound,
  Copy,
  CreditCard,
  DollarSign,
  Download,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  FilePlus,
  FileSearch,
  FileText,
  FileUp,
  Flag,
  Folder,
  FolderOpen,
  Folders,
  FolderSearch,
  Funnel,
  GitBranch,
  Globe,
  GripVertical,
  Group,
  Hand,
  Hash,
  Headphones,
  History,
  House,
  ImageIcon,
  IndentDecrease,
  Info,
  KeyRound,
  Layers,
  LayoutGrid,
  LayoutList,
  List,
  ListChecks,
  ListOrdered,
  LoaderCircle,
  Lock,
  LogOut,
  Maximize,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Minimize,
  Minus,
  Monitor,
  Moon,
  MousePointer2,
  Network,
  PanelRightOpen,
  Paperclip,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Rows3,
  ScanText,
  Search,
  Send,
  Server,
  Settings,
  ShieldUser,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareCode,
  SquareFunction,
  SquarePen,
  SquarePlus,
  SquareTerminal,
  Sun,
  Tag,
  Tags,
  Terminal,
  Thermometer,
  Timer,
  ToolCase,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  UserRound,
  UsersRound,
  Variable,
  Workflow,
  Wrench,
  X,
  Zap,
  ZapOff,
  ZoomIn,
  ZoomOut,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";
import { brandIconPaths } from "./icon-paths";

// Enums
export enum IconName {
  Checklist = "checklist",
  Features = "features",
  Publish = "publish",
  Toolbox = "toolbox",
  Play = "play",
  Add = "add",
  Chat = "chat",
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
  Hamburger = "hamburger",
  BookOpen = "bookOpen",
  Ai = "ai",
  Book = "book",
  FileCopy = "fileCopy",
  FileCopyFilled = "fileCopyFilled",
  FileUpload = "fileUpload",
  Search = "search",
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
  Pause = "pause",
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
  SidebarChevronLeft = "sidebarChevronLeft",
  SidebarChevronRight = "sidebarChevronRight",
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
  Chunk = "chunk",
  Markdown = "markdown",
  String = "string",
  Brain = "brain",
  SearchPage = "searchPage",
  Pin = "pin",
  Unpin = "unpin",
  OpenMobileModal = "openMobileModal",
  ChatGpt = "chatGpt",
  Orchestrator = "orchestrator",
  Robot = "robot",
  ReadFile = "readFile",
  SearchFile = "searchFile",
  SearchFiles = "searchFiles",
  WriteCommand = "writeCommand",
  Clock = "clock",
  AddChat = "addChat",
}

interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "color"> {
  iconName: IconName;
  /** CSS color for the glyph. A class or stylesheet rule that colors the icon still overrides it. */
  color?: string;
  size?: number;
}

// Lucide has no brand marks, so these keep their filled paths.
type BrandIconName =
  | IconName.Arcee
  | IconName.ChatGpt
  | IconName.Discord
  | IconName.Github
  | IconName.Google
  | IconName.Javascript
  | IconName.Python;

// Lucide's send with a plus in the corner it leaves empty.
const SendPlus = createLucideIcon("send-plus", [
  [
    "path",
    {
      d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
      key: "send",
    },
  ],
  ["path", { d: "m21.854 2.147-10.94 10.939", key: "send-fold" }],
  ["path", { d: "M5 16v6", key: "plus-vertical" }],
  ["path", { d: "M2 19h6", key: "plus-horizontal" }],
]);

const lucideIcons: Partial<Record<IconName, LucideIcon>> = {
  [IconName.Checklist]: ListChecks,
  [IconName.Features]: LayoutList,
  [IconName.Publish]: ArrowUpToLine,
  [IconName.Toolbox]: ToolCase,
  [IconName.Play]: Play,
  [IconName.Add]: Plus,
  [IconName.Chat]: MessageSquare,
  [IconName.Home]: House,
  [IconName.Coursor]: MousePointer2,
  [IconName.Hand]: Hand,
  [IconName.Order]: ListOrdered,
  [IconName.ZoomIn]: ZoomIn,
  [IconName.ZoomOut]: ZoomOut,
  [IconName.TurnLeft]: Undo2,
  [IconName.TurnRight]: Redo2,
  [IconName.History]: History,
  [IconName.Env]: Variable,
  [IconName.AddNote]: FilePlus,
  [IconName.Controls]: SlidersHorizontal,
  [IconName.ArrowLeft]: ArrowLeft,
  [IconName.Down]: ChevronDown,
  [IconName.Left]: ChevronLeft,
  [IconName.ArrowRight]: ArrowRight,
  [IconName.Right]: ChevronRight,
  [IconName.Top]: ChevronUp,
  [IconName.Grid]: LayoutGrid,
  [IconName.ArrowTop]: ArrowUp,
  [IconName.Trash]: Trash2,
  [IconName.ArrowDown]: ArrowDown,
  [IconName.Close]: X,
  [IconName.Hamburger]: Menu,
  [IconName.BookOpen]: BookOpen,
  [IconName.Ai]: Sparkles,
  [IconName.Book]: Book,
  [IconName.FileCopy]: Copy,
  [IconName.FileCopyFilled]: Copy,
  [IconName.FileUpload]: FileUp,
  [IconName.Search]: Search,
  [IconName.PlayHistory]: CirclePlay,
  [IconName.MenuHorizontal]: Ellipsis,
  [IconName.HideSidebar]: IndentDecrease,
  [IconName.MenuVertical]: EllipsisVertical,
  [IconName.Tag]: Tag,
  [IconName.TagAdd]: Tags,
  [IconName.Moon]: Moon,
  [IconName.Sun]: Sun,
  [IconName.Desktop]: Monitor,
  [IconName.DoubleArrowsVertical]: ArrowDownUp,
  [IconName.FinanceMode]: ChartLine,
  [IconName.Refresh]: RefreshCw,
  [IconName.Info]: Info,
  [IconName.FolderCopy]: Folders,
  [IconName.Important]: CircleAlert,
  [IconName.Globe]: Globe,
  [IconName.Filter]: Funnel,
  [IconName.Microphone]: Mic,
  [IconName.Image]: ImageIcon,
  [IconName.Attachment]: Paperclip,
  [IconName.Plane]: Send,
  [IconName.PlaneAdd]: SendPlus,
  [IconName.Headphones]: Headphones,
  [IconName.Bolt]: Zap,
  [IconName.Private]: ShieldUser,
  [IconName.Scheme]: GitBranch,
  [IconName.Repair]: Wrench,
  [IconName.Flow]: Workflow,
  [IconName.Folder]: Folder,
  [IconName.Folders]: Folders,
  [IconName.Edit]: SquarePen,
  [IconName.AddCircle]: CirclePlus,
  [IconName.Loader]: LoaderCircle,
  [IconName.Gear]: Settings,
  [IconName.Exit]: LogOut,
  [IconName.Archive]: Archive,
  [IconName.FolderOpen]: FolderOpen,
  [IconName.Flag]: Flag,
  [IconName.DoubleArrowHorizontal]: ArrowLeftRight,
  [IconName.Code]: SquareCode,
  [IconName.List]: List,
  [IconName.UserData]: ContactRound,
  [IconName.Text]: FileText,
  [IconName.Check]: Check,
  [IconName.FullScreen]: Maximize,
  [IconName.Function]: SquareFunction,
  [IconName.Combine]: Combine,
  [IconName.Danger]: TriangleAlert,
  [IconName.Download]: Download,
  [IconName.Stop]: Square,
  [IconName.Pause]: Pause,
  [IconName.Remove]: Minus,
  [IconName.AddBox]: SquarePlus,
  [IconName.Layers]: Layers,
  [IconName.Eye]: Eye,
  [IconName.EyeStrikethrough]: EyeOff,
  [IconName.BoltStrikethrough]: ZapOff,
  [IconName.Drag]: GripVertical,
  [IconName.Lock]: Lock,
  [IconName.FullScreenExit]: Minimize,
  [IconName.Person]: UserRound,
  [IconName.People]: UsersRound,
  [IconName.Group]: Group,
  [IconName.Cart]: ShoppingCart,
  [IconName.Timelaps]: Timer,
  [IconName.Token]: Coins,
  [IconName.SidebarChevronLeft]: ArrowLeftFromLine,
  [IconName.SidebarChevronRight]: ArrowRightFromLine,
  [IconName.Money]: CreditCard,
  [IconName.AddCreditCard]: CreditCard,
  [IconName.External]: ArrowUpRight,
  [IconName.ScreenView]: AppWindow,
  [IconName.Activity]: Activity,
  [IconName.Purchase]: ShoppingCart,
  [IconName.Key]: KeyRound,
  [IconName.Dollar]: DollarSign,
  [IconName.Temperature]: Thermometer,
  [IconName.CheckCircle]: CircleCheck,
  [IconName.Server]: Server,
  [IconName.Retry]: RotateCcw,
  [IconName.Provider]: Cloud,
  [IconName.Price]: DollarSign,
  [IconName.Calendar]: Calendar,
  [IconName.Terminal]: SquareTerminal,
  [IconName.Chunk]: Rows3,
  [IconName.Markdown]: Hash,
  [IconName.String]: Type,
  [IconName.Brain]: Brain,
  [IconName.SearchPage]: FileSearch,
  [IconName.Pin]: Pin,
  [IconName.Unpin]: PinOff,
  [IconName.OpenMobileModal]: PanelRightOpen,
  [IconName.Orchestrator]: Network,
  [IconName.Robot]: Bot,
  [IconName.ReadFile]: ScanText,
  [IconName.SearchFile]: FileSearch,
  [IconName.SearchFiles]: FolderSearch,
  [IconName.WriteCommand]: Terminal,
  [IconName.Clock]: Clock,
  [IconName.AddChat]: MessageSquarePlus,
} satisfies Record<Exclude<IconName, BrandIconName>, LucideIcon>;

/** The `color` prop as a fallback the stylesheet reads, so classes keep the final say. */
type IconStyle = React.CSSProperties & { "--icon-color"?: string };

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
  strokeWidth = 1.75,
  className = "",
  style,
  ...props
}) => {
  const iconStyle: IconStyle | undefined = color ? { "--icon-color": color, ...style } : style;
  const LucideGlyph = lucideIcons[iconName];

  if (LucideGlyph) {
    return (
      <LucideGlyph
        className={`icon ${className}`}
        size={size}
        strokeWidth={strokeWidth}
        style={iconStyle}
        {...props}
      />
    );
  }

  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={iconStyle}
      {...props}
    >
      <path d={brandIconPaths[iconName] ?? ""} fill="currentColor" />
    </svg>
  );
};

// Attach enum to Icon
Icon.Name = IconName;

export default Icon;
