import type { CodexTaskOutput } from "@chat/contracts/tools/codex/task";
import { Progress } from "@mantine/core";
import { IconCheck, IconFile, IconTerminal2 } from "@tabler/icons-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { asClock } from "~/core/text/duration";

export interface CodexPartProps {
  readonly output: CodexTaskOutput;
  readonly running: boolean;
}

function CodexPartComponent({ output, running }: CodexPartProps) {
  const { t } = useTranslation();

  if (output.phase === "failed") {
    return (
      <div className="mt-2.5">
        <p className="text-[0.8125rem] text-red">
          {t(`tool.codex.errors.${output.error}`)}
        </p>
        {output.detail === undefined ? null : (
          <pre className="mt-2 overflow-x-auto rounded-md bg-raised p-2.5 font-mono text-xs text-ink-dim">
            {output.detail}
          </pre>
        )}
      </div>
    );
  }

  if (output.phase === "done") {
    return (
      <div className="mt-2.5 flex flex-col gap-2.5">
        {output.summary === "" ? null : (
          <p className="text-[0.8125rem] whitespace-pre-wrap">
            {output.summary}
          </p>
        )}
        <Counts
          commands={output.commands.length}
          changes={output.changedFiles.length}
        />
        {output.changedFiles.length === 0 ? null : (
          <ul className="flex flex-col gap-px font-mono text-xs text-ink-dim">
            {output.changedFiles.map((path) => (
              <li key={path} className="[overflow-wrap:anywhere]">
                {path}
              </li>
            ))}
          </ul>
        )}
        {output.truncated ? (
          <p className="text-xs text-ink-dim">{t("tool.codex.truncated")}</p>
        ) : null}
      </div>
    );
  }

  const done = output.todos?.filter((todo) => todo.completed).length ?? 0;
  const total = output.todos?.length ?? 0;

  return (
    <div
      className="mt-2.5 flex flex-col gap-2.5"
      aria-live="polite"
      aria-busy={running}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-mono text-xs text-ink-dim">
          {output.step === "" ? t("tool.codex.starting") : output.step}
        </p>
        <span className="font-mono text-xs tabular-nums text-ink-dim">
          {asClock(output.elapsedMs)}
        </span>
      </div>

      {total === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <Progress value={(done / total) * 100} size="xs" radius="xl" />
          <ul className="flex flex-col gap-px text-xs">
            {output.todos?.map((todo) => (
              <li
                key={todo.text}
                className="flex items-start gap-1.5 text-ink-dim data-completed:text-ink"
                data-completed={todo.completed ? "" : undefined}
              >
                {todo.completed ? (
                  <IconCheck size={13} className="mt-0.5 shrink-0" />
                ) : (
                  <span className="mt-0.5 w-[13px] shrink-0" aria-hidden />
                )}
                <span className="[overflow-wrap:anywhere]">{todo.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Counts commands={output.commands} changes={output.changes} />
    </div>
  );
}

function Counts({
  commands,
  changes,
}: {
  readonly commands: number;
  readonly changes: number;
}) {
  const { t } = useTranslation();

  if (commands === 0 && changes === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 text-xs text-ink-dim">
      <span className="flex items-center gap-1">
        <IconTerminal2 size={13} />
        {t("tool.codex.commands", { count: commands })}
      </span>
      <span className="flex items-center gap-1">
        <IconFile size={13} />
        {t("tool.codex.changes", { count: changes })}
      </span>
    </div>
  );
}

export const CodexPart = memo(CodexPartComponent);
