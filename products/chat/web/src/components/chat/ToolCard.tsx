import { Button, Group, Stack, Text } from "@mantine/core";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { getToolName } from "ai";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { formatToolInput, formatToolOutput } from "../../lib/tool-output";

export type ReaderToolPart = ToolUIPart | DynamicToolUIPart;

export interface ToolCardProps {
  readonly part: ReaderToolPart;
  readonly onDecision: (approvalId: string, approved: boolean) => void;
}

function ToolCardComponent({ part, onDecision }: ToolCardProps) {
  const { t } = useTranslation();
  const name = getToolName(part);
  const args = formatToolInput(part.input);
  const approvalId = part.approval?.id;
  const reason = part.approval?.requestReason;

  return (
    <div className="chat-tool" data-state={part.state}>
      <Stack gap="xs" p="sm">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text ff="monospace" fw={600} size="sm">
            {t(`tool.names.${name}`, { defaultValue: name })}
          </Text>
          <Text className="chat-eyebrow">{t(`tool.states.${part.state}`)}</Text>
        </Group>

        {reason === undefined ? null : (
          <Text size="sm" c="var(--chat-ink-dim)">
            {reason}
          </Text>
        )}

        {args.length === 0 ? null : (
          <dl className="chat-kv">
            {args.map(([key, value]) => (
              <div key={key} style={{ display: "contents" }}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {part.state === "approval-requested" && approvalId !== undefined ? (
          <Group gap="xs">
            <Button size="xs" onClick={() => onDecision(approvalId, true)}>
              {t("tool.approve")}
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={() => onDecision(approvalId, false)}
            >
              {t("tool.deny")}
            </Button>
          </Group>
        ) : null}

        {part.state === "output-available" ? (
          <details className="chat-disclosure">
            <summary>{t("tool.output")}</summary>
            <pre className="chat-payload">{formatToolOutput(part.output)}</pre>
          </details>
        ) : null}

        {part.state === "output-error" ? (
          <Text size="sm" c="var(--chat-red)">
            {part.errorText}
          </Text>
        ) : null}
      </Stack>
    </div>
  );
}

export const ToolCard = memo(ToolCardComponent);
