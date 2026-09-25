import type { AgentSelection } from "@chat/contracts/agent/model";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { useAnswerAgentApproval } from "@chat/queries/agent/mutations";
import { useUploadAttachment } from "@chat/queries/attachments/mutations";
import { useRememberTool } from "@chat/queries/connections/mutations";
import { useAttachments } from "@chat/queries/attachments/list";
import { usePendingUploads } from "@chat/queries/attachments/pending";
import {
  attachedFilesPart,
  unsentAttachments,
} from "@chat/queries/chat/attached-files";
import { useChatSession } from "@chat/queries/chat/use-chat-session";
import type { SessionView } from "@chat/queries/sessions/detail";
import { Alert, Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBinaryTree2 } from "@tabler/icons-react";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { asCompact } from "~/core/text/count";
import { turnsOf } from "~/lib/agent-parts";
import { turnTokens } from "~/lib/agent-session";

import type { ToolDecision } from "./parts/ApprovalControls";
import { AttachmentStrip } from "./AttachmentStrip";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";

const AgentActivityDialog = lazy(async () => ({
  default: (await import("~/components/agents/AgentActivityDialog"))
    .AgentActivityDialog,
}));

export interface ChatSurfaceProps {
  readonly sessionId: SessionId;
  readonly locale: Locale;
  readonly view: SessionView;
}

/**
 * Guard: the caller mounts this keyed on `sessionId`, and only once the history
 * has arrived. `useChat` reads its initial messages exactly once per chat id, so
 * a surface that is reused across conversations keeps the previous one's turns.
 */
export function ChatSurface({ sessionId, locale, view }: ChatSurfaceProps) {
  const { t } = useTranslation();
  const attachments = useAttachments(sessionId, locale, view.attachments);
  const pending = usePendingUploads(sessionId);
  const upload = useUploadAttachment(sessionId, locale);
  const { mutate: rememberTool } = useRememberTool(locale);
  const { mutate: answerAgentApproval } = useAnswerAgentApproval(locale);
  const [agent, setAgent] = useState<AgentSelection | null>(null);
  const [agentsOpened, agentsDialog] = useDisclosure(false);

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
    addToolApprovalResponse,
  } = useChatSession({
    sessionId,
    locale,
    initialMessages: view.messages,
    session: view.session,
    attachmentCount: view.attachments.length,
  });

  const turns = useMemo(() => turnsOf(messages), [messages]);
  const spent = turns.reduce(
    (sum, turn) => sum + turnTokens(turn.telemetry).fresh,
    0,
  );

  const busy = status === "submitted" || status === "streaming";

  /**
   * Guard: derived from the turns on screen rather than kept in state. A file is
   * stored against the session the moment it is dropped, so "still in the
   * composer" means only that no turn has recorded it yet — and that answer has
   * to survive a reload, which a `useState` list would not.
   */
  const staged = unsentAttachments(messages, attachments.data ?? []);

  const onDrop = useCallback(
    (files: readonly File[]) => {
      for (const file of files) {
        upload.mutate(file);
      }
    },
    [upload],
  );

  /**
   * Guard: the grant is fired and not awaited. The AI SDK's approval response
   * carries nothing but the id and the verdict, so remembering has to be a
   * second request — and holding the tool behind it would make every approval
   * wait on a round trip whose only job is to save the reader a click next time.
   *
   * Guard: `mutate` is destructured out and the callback depends on that, never
   * on the mutation object. `useMutation` returns a new object on every status
   * change, so depending on it would rebuild this callback mid-stream and break
   * `memo` on every tool card in the list.
   */
  const onDecision = useCallback(
    ({
      channel,
      approvalId,
      approved,
      rememberAs,
      scope,
      ttl,
    }: ToolDecision) => {
      if (rememberAs !== undefined) {
        rememberTool({
          exposedName: rememberAs,
          scope,
          ttl,
          ...(scope === "session" ? { sessionId } : {}),
        });
      }
      if (channel === "gateway") {
        answerAgentApproval({
          approvalId,
          approved,
          remembered: rememberAs !== undefined,
        });

        return;
      }
      void addToolApprovalResponse({ id: approvalId, approved });
    },
    [addToolApprovalResponse, answerAgentApproval, rememberTool, sessionId],
  );

  /**
   * Guard: the files ride along as a data part rather than as the SDK's `file`
   * parts. `convertToModelMessages` turns a file part into model content and
   * parses its url, which an xlsx behind a session-scoped id is not; a data part
   * is dropped before the prompt is built, so the turn keeps its record of what
   * was attached without offering the model a second, weaker way to reach it
   * than the reader tools.
   */
  const onSend = useCallback(
    (text: string) => {
      void sendMessage(
        {
          parts: [
            ...(staged.length > 0 ? [attachedFilesPart(staged)] : []),
            { type: "text", text },
          ],
        },
        agent === null ? undefined : { body: { agent } },
      );
    },
    [sendMessage, staged, agent],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <MessageList
          sessionId={sessionId}
          messages={messages}
          streaming={status === "streaming"}
          pending={status === "submitted"}
          truncated={view.truncated}
          onDecision={onDecision}
        />
      )}

      <div className="border-t border-hairline bg-surface">
        {error === undefined ? null : (
          <Alert
            color="red"
            variant="light"
            withCloseButton
            className="mx-auto mt-3 max-w-measure py-2"
            closeButtonLabel={t("errors.dismiss")}
            onClose={clearError}
          >
            {error.message.length > 0 ? error.message : t("errors.network")}
          </Alert>
        )}

        {upload.isError ? (
          <Alert
            color="red"
            variant="light"
            className="mx-auto mt-3 max-w-measure py-2"
          >
            {upload.error.message}
          </Alert>
        ) : null}

        <div className="mx-auto flex max-w-measure items-center justify-between gap-2 px-4 pt-2">
          <ModelPicker
            sessionId={sessionId}
            locale={locale}
            value={agent}
            onChange={setAgent}
          />
          <Button
            variant="subtle"
            size="compact-xs"
            color="gray"
            leftSection={<IconBinaryTree2 size={13} />}
            onClick={agentsDialog.open}
          >
            {spent === 0
              ? t("agents.open")
              : `${t("agents.open")} · ${t("agents.tokens", { value: asCompact(spent, locale) })}`}
          </Button>
        </div>

        <Composer
          busy={busy}
          attached={staged.length > 0 || pending.length > 0}
          onSend={onSend}
          onStop={stop}
          onDrop={onDrop}
        >
          <AttachmentStrip
            sessionId={sessionId}
            locale={locale}
            files={staged}
            pending={pending}
            removable
          />
        </Composer>
      </div>

      {agentsOpened ? (
        <Suspense fallback={null}>
          <AgentActivityDialog
            opened={agentsOpened}
            onClose={agentsDialog.close}
            turns={turns}
            locale={locale}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
