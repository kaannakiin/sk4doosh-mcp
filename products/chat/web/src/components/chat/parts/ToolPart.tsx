import { Button } from "@mantine/core";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { getToolName } from "ai";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { formatToolInput, formatToolOutput } from "../../../lib/tool-output";

export type ReaderToolPart = ToolUIPart | DynamicToolUIPart;

export interface ToolPartProps {
  readonly part: ReaderToolPart;
  readonly onDecision: (approvalId: string, approved: boolean) => void;
}

function ToolPartComponent({ part, onDecision }: ToolPartProps) {
  const { t } = useTranslation();
  const name = getToolName(part);
  const args = formatToolInput(part.input);
  const approvalId = part.approval?.id;
  const reason = part.approval?.requestReason;

  return (
    <section
      className="group/tool mt-4 rounded-[10px] border border-hairline bg-panel px-3.5 py-3 data-[state=approval-requested]:border-amber data-[state=output-denied]:border-red data-[state=output-error]:border-red"
      data-state={part.state}
    >
      <header className="flex items-center justify-between gap-3">
        <span className="font-mono text-[0.8125rem] font-medium">
          {t(`tool.names.${name}`, { defaultValue: name })}
        </span>
        <span className="text-[0.6875rem] tracking-widest whitespace-nowrap text-ink-dim uppercase group-data-[state=approval-requested]/tool:text-amber group-data-[state=output-available]/tool:text-green group-data-[state=output-denied]/tool:text-red group-data-[state=output-error]/tool:text-red">
          {t(`tool.states.${part.state}`)}
        </span>
      </header>

      {reason === undefined ? null : (
        <p className="mt-2 text-[0.8125rem] text-ink-dim">{reason}</p>
      )}

      {args.length === 0 ? null : (
        <dl className="mt-2.5 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-px font-mono text-xs">
          {args.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-ink-dim">{key}</dt>
              <dd className="[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {part.state === "approval-requested" && approvalId !== undefined ? (
        <div className="mt-3 flex gap-2">
          <Button
            size="xs"
            onClick={() => {
              onDecision(approvalId, true);
            }}
          >
            {t("tool.approve")}
          </Button>
          <Button
            size="xs"
            variant="default"
            onClick={() => {
              onDecision(approvalId, false);
            }}
          >
            {t("tool.deny")}
          </Button>
        </div>
      ) : null}

      {part.state === "output-available" ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs tracking-wider text-ink-dim uppercase">
            {t("tool.output")}
          </summary>
          <pre className="mt-2 max-h-88 overflow-auto rounded-md bg-raised p-2.5 font-mono text-xs leading-relaxed">
            {formatToolOutput(part.output)}
          </pre>
        </details>
      ) : null}

      {part.state === "output-error" ? (
        <p className="mt-2 text-[0.8125rem] text-red">{part.errorText}</p>
      ) : null}
    </section>
  );
}

export const ToolPart = memo(ToolPartComponent);
