import type { QuestionRecord } from "../../types/api";
interface QuestionFormProps {
    sessionId: string;
    question: QuestionRecord;
    /** 1–9 pick a suggested answer while this is the card on top. */
    shortcuts?: boolean;
    /** Bare section rather than its own bordered card, for a host that frames it. */
    bare?: boolean;
    /** 44px controls for a touch screen. */
    touch?: boolean;
}
/** One pending question: its suggested answers, a free-text answer, and Cancel. */
export declare function QuestionForm({ sessionId, question, shortcuts, bare, touch, }: QuestionFormProps): import("react").JSX.Element;
/** Every pending question at once, for a view without the attention card. */
export declare function QuestionControls({ sessionId, enabled }: {
    sessionId: string;
    enabled: boolean;
}): import("react").JSX.Element | null;
export {};
