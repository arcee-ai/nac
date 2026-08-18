import React from "react";

interface HintProps extends React.HTMLAttributes<HTMLParagraphElement> {
  text?: string;
  className?: string;
}

const Hint: React.FC<HintProps> = ({ text, className = "", children, ...props }) => {
  const baseClasses = "text-basic-tertiary text-micro";
  const combinedClasses = `${baseClasses} ${className}`.trim();

  return (
    <p className={combinedClasses} {...props}>
      {text || children}
    </p>
  );
};

export default Hint;
