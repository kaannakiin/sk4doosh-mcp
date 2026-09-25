import type { AgentStep } from "@chat/contracts/agent/stream-parts";
import { Loader } from "@mantine/core";
import {
  IconArrowsMinimize,
  IconCheck,
  IconFile,
  IconPlug,
  IconRobot,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { createElement, memo } from "react";
import { useTranslation } from "react-i18next";

import { asClock } from "~/core/text/duration";
import { useLocale } from "~/core/hooks/use-locale";
import { asCompact } from "~/core/text/count";
import type { StepEntry } from "~/lib/agent-parts";
import { asReadable } from "~/lib/tool-output";

export interface AgentStepsPartProps {
  readonly steps: readonly StepEntry[];
  readonly running: boolean;
}

const ICON_BY_KIND = {
  command: IconTerminal2,
  file_change: IconFile,
  tool_call: IconPlug,
  subagent: IconRobot,
  compaction: IconArrowsMinimize,
} as const;

function StatusGlyph({ step }: Readonly<{ step: AgentStep }>) {
  if (step.status === "running") {
    return <Loader size={11} className="shrink-0" />;
  }

  return step.status === "completed" ? (
    <IconCheck size={13} className="shrink-0 text-ink-dim" />
  ) : (
    <IconX size={13} className="shrink-0 text-red" />
  );
}

function StepLabel({ step }: Readonly<{ step: AgentStep }>) {
  const { t } = useTranslation();
  const locale = useLocale();

  switch (step.kind) {
    case "command":
      return <span className="font-mono">{step.command}</span>;
    case "file_change":
      return (
        <span className="font-mono">
          {step.changes.map((change) => change.path).join(", ")}
        </span>
      );
    case "tool_call":
      return (
        <span>
          <span className="font-mono">{`${step.server}.${step.tool}`}</span>
          {step.workerUsage === null ? null : (
            <span className="ms-2 text-ink-dim">
              {t("agents.workerTokens", {
                input: asCompact(step.workerUsage.input, locale),
                output: asCompact(step.workerUsage.output, locale),
              })}
            </span>
          )}
        </span>
      );
    case "subagent":
      return (
        <span>
          {t("agents.subagent")} <span className="font-mono">{step.path}</span>
        </span>
      );
    case "compaction":
      return <span>{t("agents.compaction")}</span>;
  }
}

function StepLine({ step }: Readonly<{ step: AgentStep }>) {
  return (
    <>
      {createElement(ICON_BY_KIND[step.kind], {
        size: 13,
        className: "mt-0.5 shrink-0 text-accent",
      })}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <StepLabel step={step} />
      </span>
      {step.durationMs === null ? null : (
        <span className="font-mono tabular-nums text-ink-dim">
          {asClock(step.durationMs)}
        </span>
      )}
      <span className="mt-0.5">
        <StatusGlyph step={step} />
      </span>
    </>
  );
}

function StepPayload({
  label,
  text,
}: Readonly<{ label: string; text: string }>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.6875rem] tracking-wider text-ink-dim uppercase">
        {label}
      </span>
      <pre className="max-h-72 overflow-auto rounded-md bg-raised p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
        {asReadable(text)}
      </pre>
    </div>
  );
}

function StepRow({ step }: Readonly<{ step: AgentStep }>) {
  const { t } = useTranslation();
  const input = step.kind === "tool_call" ? step.input : null;
  const output = step.kind === "tool_call" ? step.output : null;

  if (input === null && output === null) {
    return (
      <li className="flex items-start gap-1.5">
        <StepLine step={step} />
      </li>
    );
  }

  return (
    <li>
      <details className="group/step">
        <summary className="flex cursor-pointer list-none items-start gap-1.5">
          <StepLine step={step} />
        </summary>
        <div className="ms-5 mt-1.5 mb-2 flex flex-col gap-2">
          {input === null ? null : (
            <StepPayload label={t("agents.stepInput")} text={input} />
          )}
          {output === null ? null : (
            <StepPayload label={t("agents.stepOutput")} text={output} />
          )}
        </div>
      </details>
    </li>
  );
}

function AgentStepsPartComponent({ steps, running }: AgentStepsPartProps) {
  const { t } = useTranslation();

  const list = (
    <ul className="mt-2 flex flex-col gap-1 text-xs">
      {steps.map((entry) => (
        <StepRow key={entry.id} step={entry.step} />
      ))}
    </ul>
  );

  return running ? (
    <div className="my-2.5" aria-live="polite" aria-busy>
      {list}
    </div>
  ) : (
    <details className="my-2.5 text-xs text-ink-dim">
      <summary className="cursor-pointer select-none">
        {t("agents.steps", { count: steps.length })}
      </summary>
      {list}
    </details>
  );
}

export const AgentStepsPart = memo(AgentStepsPartComponent);
