import React from "react";
interface HintProps extends React.HTMLAttributes<HTMLParagraphElement> {
    text?: string;
    className?: string;
}
declare const Hint: React.FC<HintProps>;
export default Hint;
