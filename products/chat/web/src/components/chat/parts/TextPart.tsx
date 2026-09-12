import { memo } from "react";

import { Markdown } from "./Markdown";

export interface TextPartProps {
  readonly text: string;
  readonly live: boolean;
  readonly asked: boolean;
}

/**
 * Guard: only the assistant's half is parsed as markdown. A question is whatever
 * the visitor typed, and running it through a parser turns an underscore in a
 * column name into emphasis and a leading `#` into a heading.
 */
function TextPartComponent({ text, live, asked }: TextPartProps) {
  if (asked) {
    return (
      <p className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        {text}
      </p>
    );
  }

  return <Markdown text={text} live={live} />;
}

export const TextPart = memo(TextPartComponent);
