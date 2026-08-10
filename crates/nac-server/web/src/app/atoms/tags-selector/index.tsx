import type React from "react";
import { cn } from "../../lib/cn";
import Button, { ButtonSize, ButtonVariant } from "../button";

interface TagsSelectorProps {
  tags: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/** Chips that toggle a multi-select, e.g. the environment filter on the board. */
const TagsSelector: React.FC<TagsSelectorProps> = ({
  tags,
  selected,
  onChange,
  disabled = false,
  className = "",
}) => {
  const toggle = (tag: string) => {
    onChange(
      selected.includes(tag)
        ? selected.filter((item) => item !== tag)
        : [...selected, tag],
    );
  };

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {tags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <Button
            key={tag}
            size={ButtonSize.Small}
            variant={
              active ? ButtonVariant.SecondaryAccent : ButtonVariant.Secondary
            }
            disabled={disabled}
            aria-pressed={active}
            onClick={() => toggle(tag)}
          >
            {tag}
          </Button>
        );
      })}
    </div>
  );
};

export default TagsSelector;
