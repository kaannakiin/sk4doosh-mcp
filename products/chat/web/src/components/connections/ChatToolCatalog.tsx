import type { Locale } from "@chat/contracts/common/locale";
import type { ChatToolEntry } from "@chat/contracts/integration/tool-approval";
import {
  toolOverrideSettingSchema,
  type ToolApprovalMode,
} from "@chat/contracts/integration/tool-approval-mode";
import { toolPosture } from "@chat/contracts/tools/approval-decision";
import {
  CHAT_TOOL_FAMILIES,
  CHAT_TOOL_FAMILY,
} from "@chat/contracts/tools/tool-name";
import {
  useChatToolApprovals,
  useChatTools,
} from "@chat/queries/connections/approvals";
import { useSetToolOverride } from "@chat/queries/connections/mutations";
import { Badge, SegmentedControl, Skeleton } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { EffectivePosture } from "./EffectivePosture";

const ROW =
  "grid grid-cols-1 gap-x-4 gap-y-2 border-t border-hairline px-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_13rem_auto]";

interface ChatToolCatalogProps {
  readonly readerMode: ToolApprovalMode | undefined;
  readonly locale: Locale;
}

export function ChatToolCatalog({ readerMode, locale }: ChatToolCatalogProps) {
  const { t } = useTranslation();
  const tools = useChatTools(locale);
  const approvals = useChatToolApprovals(locale, true);
  const {
    mutate: overrideTool,
    isPending,
    variables,
  } = useSetToolOverride(locale);

  if (tools.data === undefined) {
    return tools.isError ? (
      <p className="mt-3 text-sm text-ink-dim">
        {t("connections.chatTools.failed")}
      </p>
    ) : (
      <div className="mt-3 flex flex-col gap-2" aria-busy>
        <Skeleton height={56} radius="md" />
        <Skeleton height={56} radius="md" />
        <Skeleton height={56} radius="md" />
      </div>
    );
  }

  const remembered = new Set(
    (approvals.data ?? []).flatMap((approval) =>
      approval.expired ? [] : [approval.toolName],
    ),
  );
  const families = CHAT_TOOL_FAMILIES.flatMap((family) => {
    const members = (tools.data ?? []).filter(
      (tool) => CHAT_TOOL_FAMILY[tool.name] === family,
    );

    return members.length === 0 ? [] : [{ family, members }];
  });

  return (
    <div className="mt-3 flex flex-col gap-6">
      {families.map(({ family, members }) => (
        <div key={family}>
          <h3 className="px-1 pb-2 text-sm font-medium">
            {t(`connections.chatTools.families.${family}`)}
            <span className="ms-2 font-mono text-xs font-normal text-ink-dim tabular-nums">
              {members.length}
            </span>
          </h3>
          <ul className="border-b border-hairline">
            {members.map((tool) => (
              <ChatToolRow
                key={tool.name}
                tool={tool}
                readerMode={readerMode}
                remembered={remembered.has(tool.name)}
                disabled={isPending && variables?.exposedName === tool.name}
                onChoose={(mode) => {
                  overrideTool({ exposedName: tool.name, mode });
                }}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface ChatToolRowProps {
  readonly tool: ChatToolEntry;
  readonly readerMode: ToolApprovalMode | undefined;
  readonly remembered: boolean;
  readonly disabled: boolean;
  readonly onChoose: (mode: ChatToolEntry["override"]) => void;
}

function ChatToolRow({
  tool,
  readerMode,
  remembered,
  disabled,
  onChoose,
}: ChatToolRowProps) {
  const { t } = useTranslation();
  const askable = tool.policy === "askable";
  const answer =
    askable && readerMode !== undefined
      ? toolPosture({
          override: tool.override,
          overrideStale: tool.overrideStale,
          destructive: false,
          integrationMode: "inherit",
          readerMode,
        })
      : undefined;
  const posture =
    answer === undefined ? (
      <p className="font-mono text-[0.6875rem] leading-snug">
        <span
          className={tool.policy === "always" ? "text-ink-dim" : "text-ink"}
        >
          {tool.policy === "always"
            ? t("connections.chatTools.policy.always")
            : t("connections.chatTools.policy.auto")}
        </span>
        <span className="text-ink-dim">
          {" · "}
          {t("connections.chatTools.policy.fixed")}
        </span>
      </p>
    ) : (
      <EffectivePosture answer={answer} destructive={false} />
    );

  return (
    <li className={ROW}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-mono text-[0.8125rem]">
            {tool.name}
          </span>
          {remembered ? (
            <Badge size="xs" variant="light" color="var(--color-accent)">
              {t("connections.chatTools.remembered")}
            </Badge>
          ) : null}
          {tool.overrideStale ? (
            <Badge size="xs" variant="light" color="var(--color-amber)">
              {t("connections.toolList.stale")}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-ink-dim">
          {t(`connections.chatTools.descriptions.${tool.name}`)}
        </p>
        <div className="mt-1.5 lg:hidden">{posture}</div>
      </div>

      <div className="hidden pt-1 lg:block">{posture}</div>

      {askable ? (
        <SegmentedControl
          size="xs"
          radius="md"
          className="self-start justify-self-start sm:justify-self-end"
          value={tool.override}
          disabled={disabled}
          aria-label={t("connections.toolList.overrideFor", {
            name: tool.name,
          })}
          data={[
            {
              value: "inherit",
              label: t("connections.toolList.override.inherit"),
            },
            {
              value: "always_ask",
              label: t("connections.toolList.override.always_ask"),
            },
            { value: "auto", label: t("connections.toolList.override.auto") },
          ]}
          onChange={(value) => {
            const parsed = toolOverrideSettingSchema.safeParse(value);
            if (parsed.success) {
              onChoose(parsed.data);
            }
          }}
        />
      ) : (
        <span className="hidden sm:block" />
      )}
    </li>
  );
}
