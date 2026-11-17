import { type SessionStatus } from "../../lib/sessionStatus";
/**
 * The status ladder's glyph: a 6px dot (8px with `size="md"`). Amber needs
 * you, red failed, a breathing ink dot is working, a ring waits on children,
 * green is finished-and-unseen, a faint dot is idle. The label is always
 * available to assistive technology; pass `labelled` to also show it.
 */
export default function StatusDot({ status, size, labelled, hideIdle, className, }: {
    status: SessionStatus;
    size?: "sm" | "md";
    labelled?: boolean;
    /** Render nothing at all for idle sessions (keeps quiet rows quiet). */
    hideIdle?: boolean;
    className?: string;
}): import("react").JSX.Element | null;
