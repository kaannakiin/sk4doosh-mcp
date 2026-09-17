import type { GrantScope } from "@chat/contracts/integration/grant-scope";
import { Button, Checkbox, Radio } from "@mantine/core";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { getToolName } from "ai";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { codexOutputOf } from "~/lib/codex-output";
import { formatToolInput, formatToolOutput } from "~/lib/tool-output";
import { CodexPart } from "./CodexPart";

export type ReaderToolPart = ToolUIPart | DynamicToolUIPart;

export interface ToolDecision {
  readonly approvalId: string;
  readonly approved: boolean;
  /** The tool name to stop asking about, when the reader asked for that. */
  readonly rememberAs: string | undefined;
  /** How far that grant reaches. Meaningless when nothing is remembered. */
  readonly scope: GrantScope;
}

/**
 * Guard: read from the part rather than derived from the name. The server puts
 * each tool's posture in `metadata`, which the sdk copies here — a page that
 * guessed instead would offer to remember a tool the server refuses to remember,
 * which is what it used to do for every destructive one.
 */
function rememberable(part: ReaderToolPart): boolean {
  const policy = (part.toolMetadata as { policy?: unknown } | undefined)
    ?.policy;

  return policy !== "always";
}

export interface ToolPartProps {
  readonly part: ReaderToolPart;
  readonly onDecision: (decision: ToolDecision) => void;
}

function ToolPartComponent({ part, onDecision }: ToolPartProps) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);
  const [scope, setScope] = useState<GrantScope>("session");
  const name = getToolName(part);
  const args = formatToolInput(part.input);
  const approvalId = part.approval?.id;
  const reason = part.approval?.requestReason;
  /**
   * A streaming tool reaches `output-available` on its first progress update and
   * stays there for the rest of the run, so the state alone reads as finished.
   * `preliminary` is what separates the two, and it drives the label, the border
   * and whether the result is offered as a collapsed block.
   */
  const running =
    part.state === "output-available" && part.preliminary === true;
  const display = running ? "running" : part.state;
  const codex =
    part.state === "output-available" ? codexOutputOf(part.output) : undefined;

  return (
    <section
      className="group/tool mt-4 rounded-[10px] border border-hairline bg-panel px-3.5 py-3 data-[state=approval-requested]:border-amber data-[state=output-denied]:border-red data-[state=output-error]:border-red"
      data-state={display}
    >
      <header className="flex items-center justify-between gap-3">
        <span className="font-mono text-[0.8125rem] font-medium">
          {t(`tool.names.${name}`, { defaultValue: name })}
        </span>
        <span className="text-[0.6875rem] tracking-widest whitespace-nowrap text-ink-dim uppercase group-data-[state=approval-requested]/tool:text-amber group-data-[state=output-available]/tool:text-green group-data-[state=output-denied]/tool:text-red group-data-[state=output-error]/tool:text-red">
          {t(`tool.states.${display}`)}
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
        <div className="mt-3 flex flex-col gap-2.5">
          {/*
            The narrow grant is the one that is selected, and widening it is a
            second, deliberate click. A single checkbox meaning "forever and
            everywhere" made the widest thing a reader can give the easiest thing
            to give.
          */}
          {rememberable(part) ? (
            <div className="flex flex-col gap-1.5">
              <Checkbox
                size="xs"
                checked={remember}
                label={t("tool.remember")}
                onChange={(event) => {
                  setRemember(event.currentTarget.checked);
                }}
              />
              {remember ? (
                <Radio.Group
                  size="xs"
                  value={scope}
                  onChange={(value) => {
                    setScope(value === "global" ? "global" : "session");
                  }}
                >
                  <div className="ms-6 flex flex-col gap-1">
                    <Radio
                      size="xs"
                      value="session"
                      label={t("tool.rememberScope.session")}
                    />
                    <Radio
                      size="xs"
                      value="global"
                      label={t("tool.rememberScope.global")}
                    />
                  </div>
                </Radio.Group>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              size="xs"
              onClick={() => {
                onDecision({
                  approvalId,
                  approved: true,
                  rememberAs: remember ? name : undefined,
                  scope,
                });
              }}
            >
              {t("tool.approve")}
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                onDecision({
                  approvalId,
                  approved: false,
                  rememberAs: undefined,
                  scope,
                });
              }}
            >
              {t("tool.deny")}
            </Button>
          </div>
        </div>
      ) : null}

      {codex === undefined ? null : (
        <CodexPart output={codex} running={running} />
      )}

      {part.state === "output-available" && codex === undefined && !running ? (
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
