import type React from "react";
import { iconPaths } from "./icon-paths";

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
  Chunk = "chunk",
  Markdown = "markdown",
  String = "string",
  Brain = "brain",
  SearchPage = "searchPage",
  Pin = "pin",
  Unpin = "unpin",
  OpenMobileModal = "openMobileModal",
  ChatGpt = "chatGpt",
}

interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "color"> {
  iconName: IconName;
  /** CSS color for the glyph. Stylesheets can still override it via `fill`. */
  color?: string;
  size?: number;
}

const DEFAULT_VIEW_BOX = "0 0 24 24";

const getGlyph = (iconName: IconName): { d: string; viewBox: string } => {
  const entry = iconPaths[iconName];
  if (typeof entry === "string") {
    return { d: entry, viewBox: DEFAULT_VIEW_BOX };
  }
  return entry ?? { d: "", viewBox: DEFAULT_VIEW_BOX };
};

// Component
const Icon: React.FC<IconProps> & { Name: typeof IconName } = ({
  iconName = IconName.Checklist,
  color,
  size = 20,
  className = "",
  style,
  ...props
}) => {
  const { d, viewBox } = getGlyph(iconName);
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={color ? { color, ...style } : style}
      {...props}
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
};

// Attach enum to Icon
Icon.Name = IconName;

export default Icon;
