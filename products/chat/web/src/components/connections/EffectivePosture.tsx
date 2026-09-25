import type { ToolPostureAnswer } from "@chat/contracts/tools/approval-decision";
import { useTranslation } from "react-i18next";

interface EffectivePostureProps {
  readonly answer: ToolPostureAnswer;
  readonly destructive: boolean;
  readonly className?: string;
}

export function EffectivePosture({
  answer,
  destructive,
  className = "",
}: EffectivePostureProps) {
  const { t } = useTranslation();

  return (
    <p className={`font-mono text-[0.6875rem] leading-snug ${className}`}>
      <span
        className={
          answer.posture === "allow" && destructive
            ? "text-amber"
            : answer.posture === "ask"
              ? "text-ink-dim"
              : "text-ink"
        }
      >
        {t(`connections.posture.${answer.posture}`)}
      </span>
      <span className="text-ink-dim">
        {" · "}
        {t(`connections.posture.source.${answer.source}`)}
      </span>
    </p>
  );
}
