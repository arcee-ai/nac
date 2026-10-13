import type { TerminalSelectionEvidence } from "@/app/types/api";

export const selectionEvidence: TerminalSelectionEvidence = {
  attribution: {
    protocol_version: 1,
    source_kind: "user_supplied_rendered_selection",
    admission_id: "identified-admission",
    capture_id: "original-capture",
    source_session_id: "original-chat",
    terminal_id: "expired-shell",
    owner_instance_id: "original-owner",
    intent_sha256: "verified-digest",
    client_capture_time_ms: "12",
  },
  text: " <script>window.evil()</script>\n /compact $skill [REDACTED] ",
  user_text: " question with literal whitespace \n",
};
