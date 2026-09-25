import {
  isGrantTtl,
  type GrantScope,
  type GrantTtl,
} from "@chat/contracts/integration/grant-scope";
import { useCurrentUser } from "@chat/queries/auth/current-user";
import { Button, Checkbox, Radio, SegmentedControl } from "@mantine/core";
import { memo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { useLocale } from "~/core/hooks/use-locale";

export interface ToolDecision {
  /**
   * Which gate asked: the ai sdk's tool approval, answered by resending the
   * conversation, or the agent gateway, answered while the turn waits.
   */
  readonly channel: "stream" | "gateway";
  readonly approvalId: string;
  readonly approved: boolean;
  /** The tool name to stop asking about, when the reader asked for that. */
  readonly rememberAs: string | undefined;
  /** How far that grant reaches. Meaningless when nothing is remembered. */
  readonly scope: GrantScope;
  /** How long that grant lives. Meaningless when nothing is remembered. */
  readonly ttl: GrantTtl;
}

export interface ApprovalControlsProps {
  readonly channel: ToolDecision["channel"];
  readonly approvalId: string;
  readonly toolName: string;
  readonly rememberable: boolean;
  readonly onDecision: (decision: ToolDecision) => void;
}

interface ApprovalForm {
  readonly remember: boolean;
  readonly scope: GrantScope;
  readonly ttl: GrantTtl | null;
}

const DEFAULTS: ApprovalForm = { remember: false, scope: "session", ttl: null };

/**
 * Guard: `ttl` starts empty rather than at the reader's preference. The
 * preference arrives with `/auth/me`, which may still be loading when the prompt
 * appears, and a default captured then would freeze whatever it was at that
 * moment; an empty field reads the preference at the time of the answer.
 */
function ApprovalControlsComponent({
  channel,
  approvalId,
  toolName,
  rememberable,
  onDecision,
}: ApprovalControlsProps) {
  const { t } = useTranslation();
  const me = useCurrentUser(useLocale());
  const form = useForm<ApprovalForm>({ defaultValues: DEFAULTS });
  const remember = useWatch({ control: form.control, name: "remember" });
  const answered = form.formState.isSubmitted;
  const preferred = me.data?.grantTtl ?? "never";

  const decide = (approved: boolean) =>
    form.handleSubmit((values) => {
      onDecision({
        channel,
        approvalId,
        approved,
        rememberAs: approved && values.remember ? toolName : undefined,
        scope: values.scope,
        ttl: values.ttl ?? preferred,
      });
    });

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {/*
        The narrow grant is the one that is selected, and widening it is a
        second, deliberate click. A single checkbox meaning "forever and
        everywhere" made the widest thing a reader can give the easiest thing
        to give.
      */}
      {rememberable ? (
        <div className="flex flex-col gap-1.5">
          <Controller
            control={form.control}
            name="remember"
            render={({ field }) => (
              <Checkbox
                size="xs"
                name={field.name}
                checked={field.value}
                disabled={answered}
                label={t("tool.remember")}
                onChange={(event) => {
                  field.onChange(event.currentTarget.checked);
                }}
                onBlur={field.onBlur}
              />
            )}
          />
          {remember ? (
            <Controller
              control={form.control}
              name="scope"
              render={({ field }) => (
                <Radio.Group
                  size="xs"
                  name={field.name}
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value === "global" ? "global" : "session");
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
              )}
            />
          ) : null}
          {remember ? (
            <div className="ms-6 flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-dim">
                {t("tool.rememberFor")}
              </span>
              <Controller
                control={form.control}
                name="ttl"
                render={({ field }) => (
                  <SegmentedControl
                    size="xs"
                    radius="md"
                    name={field.name}
                    value={field.value ?? preferred}
                    data={[
                      { value: "day", label: t("tool.rememberTtl.day") },
                      { value: "week", label: t("tool.rememberTtl.week") },
                      { value: "never", label: t("tool.rememberTtl.never") },
                    ]}
                    onChange={(value) => {
                      if (isGrantTtl(value)) {
                        field.onChange(value);
                      }
                    }}
                  />
                )}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button size="xs" disabled={answered} onClick={decide(true)}>
          {t("tool.approve")}
        </Button>
        <Button
          size="xs"
          variant="default"
          disabled={answered}
          onClick={decide(false)}
        >
          {t("tool.deny")}
        </Button>
      </div>
    </div>
  );
}

export const ApprovalControls = memo(ApprovalControlsComponent);
