import { useLocation, useNavigate } from "react-router-dom";

import { FileIcon, Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import {
  revealSidePanel,
  selectFile,
  selectFileListing,
  selectRevision,
  useSelectedFile,
} from "@/app/store/sessionLayoutStore";

/** Opens the Files panel on this workspace path. Label is the full relative path. */
export function FileSegmentButton({
  path,
  directory = false,
}: {
  path: string;
  directory?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const selected = useSelectedFile();
  const sessionId = sessionIdFromPath(location.pathname);
  const active = selected === path;

  return (
    <button
      type="button"
      className={cn(
        "flex w-fit max-w-full items-start gap-[6px] py-1 px-2 rounded-[4px] text-left self-start",
        active ? "btn-ghost-highlighted" : "btn-ghost",
      )}
      aria-pressed={active}
      title={path}
      onClick={() => {
        if (!sessionId) return;
        selectRevision(null);
        selectFileListing("tree");
        selectFile(path);
        revealSidePanel(isMobile);
        navigate(routes.session(sessionId, "files"));
      }}
    >
      {directory ? (
        <Icon iconName={IconName.Folder} size={16} className="mt-[2px] shrink-0" />
      ) : (
        <FileIcon path={path} className="mt-[2px]" />
      )}
      <span className="code code-small break-all text-basic-primary">{path}</span>
    </button>
  );
}
