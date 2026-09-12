import { memo } from "react";
import { useTranslation } from "react-i18next";

export interface ReasoningPartProps {
  readonly text: string;
  readonly streaming: boolean;
}

/**
 * Guard: open while it streams, closed once it is done. A reasoning model emits
 * this before any answer text, so a disclosure that stays shut leaves the reader
 * watching an empty column for the whole of the model's longest pause.
 */
function ReasoningPartComponent({ text, streaming }: ReasoningPartProps) {
  const { t } = useTranslation();

  return (
    <details
      className="mt-3 font-serif text-[0.9375rem] text-ink-dim italic"
      open={streaming}
    >
      <summary className="cursor-pointer font-sans text-xs tracking-wider uppercase not-italic">
        {t("conversation.reasoning")}
      </summary>
      <p>{text}</p>
    </details>
  );
}

export const ReasoningPart = memo(ReasoningPartComponent);
