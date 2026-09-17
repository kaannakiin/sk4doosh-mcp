import {
  AUTH_CHALLENGE_MAX_ATTEMPTS,
  challengePurposeSchema,
  authChannelSchema,
  type PendingChallenge,
} from "@chat/contracts/auth/auth";
import {
  useConfirmPhoneLogin,
  useConfirmVerification,
  useResendChallenge,
} from "@chat/queries/auth/mutations";
import { errorCodeOf } from "@chat/queries/client";
import { Alert, Button, Input, PinInput } from "@mantine/core";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ClipboardEvent } from "react";
import { Trans, useTranslation } from "react-i18next";

import { AuthHeading } from "~/components/auth/AuthHeading";
import { AuthLink } from "~/components/auth/AuthLink";
import { LiveStatus } from "~/components/auth/LiveStatus";
import { useCountdown } from "~/core/hooks/use-countdown";
import { useLocale } from "~/core/hooks/use-locale";
import { asClock } from "~/core/text/duration";
import { resetSessionGuard } from "~/lib/auth-refresh";

const CODE_LENGTH = 6;
const AUTO_SUBMIT_BUDGET = 2;
const RESEND_TICK_MS = 1_000;
const EXPIRY_TICK_MS = 30_000;
const MINUTE_MS = 60_000;

/**
 * Guard: the challenge travels in the url, not in router state or session
 * storage. The screen is server-rendered, and neither of those is readable from
 * a render — a reader who alt-tabs to their mail client and reloads would land
 * on a blank step. Nothing here is a credential: the id opens nothing without
 * the six digits, which the api caps at five attempts, and the target arrives
 * already masked by the server.
 */
type VerifySearch = Partial<PendingChallenge>;

function parseChallenge(search: Record<string, unknown>): VerifySearch {
  const purpose = challengePurposeSchema.safeParse(search.purpose);
  const channel = authChannelSchema.safeParse(search.channel);
  if (
    !purpose.success ||
    !channel.success ||
    typeof search.challengeId !== "string" ||
    typeof search.expiresAt !== "string" ||
    typeof search.resendAt !== "string" ||
    typeof search.maskedTarget !== "string"
  ) {
    return {};
  }

  return {
    challengeId: search.challengeId,
    purpose: purpose.data,
    channel: channel.data,
    expiresAt: search.expiresAt,
    resendAt: search.resendAt,
    maskedTarget: search.maskedTarget,
  };
}

export const Route = createFileRoute("/auth/verify")({
  validateSearch: parseChallenge,
  beforeLoad: ({ search }) => {
    /**
     * Guard: an incomplete challenge in the url is treated as no challenge at
     * all. Every field is optional in the search type because a visitor can type
     * anything into the address bar; this is the one place that decides the step
     * is usable, so the component below can read it as a whole.
     */
    if (search.challengeId === undefined) {
      throw redirect({ to: "/auth/login", replace: true });
    }
  },
  component: VerifyRoute,
});

function VerifyRoute() {
  const challenge = Route.useSearch() as PendingChallenge;

  return <VerifyStep key={challenge.challengeId} challenge={challenge} />;
}

/**
 * Guard: keyed on the challenge id so a resend remounts the step. Every counter
 * here — the digits, the local failures, the announcement — describes one
 * challenge, and a resend replaces the row on the server rather than amending
 * it.
 */
function VerifyStep({ challenge }: Readonly<{ challenge: PendingChallenge }>) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const pin = useRef<HTMLInputElement>(null);

  const [code, setCode] = useState("");
  const [failures, setFailures] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const confirmContact = useConfirmVerification(locale);
  const confirmPhoneLogin = useConfirmPhoneLogin(locale);
  const resend = useResendChallenge(locale);
  const confirm =
    challenge.purpose === "phoneLogin" ? confirmPhoneLogin : confirmContact;

  const expiresIn = useCountdown(
    Date.parse(challenge.expiresAt),
    EXPIRY_TICK_MS,
  );
  const resendIn = useCountdown(Date.parse(challenge.resendAt), RESEND_TICK_MS);

  const expired = expiresIn === 0;
  const burned = failures >= AUTH_CHALLENGE_MAX_ATTEMPTS;
  const dead = expired || burned;
  const busy = confirm.isPending || resend.isPending;

  async function verify(value: string): Promise<void> {
    if (dead || busy) {
      return;
    }
    setAnnouncement(t("auth.status.verifying"));
    try {
      await confirm.mutateAsync({
        challengeId: challenge.challengeId,
        code: value,
      });
      resetSessionGuard();
      setAnnouncement(t("auth.status.signedIn"));
      await navigate({ to: "/", replace: true });
    } catch (error) {
      setAnnouncement("");
      /**
       * Guard: the failure counter only advances on the api's verdict on a code.
       * A rate limit or a dropped connection did not spend an attempt, and
       * counting it would retire a challenge the reader could still finish.
       */
      if (errorCodeOf(error) === "invalid_or_expired_challenge") {
        setFailures((previous) => previous + 1);
      }
      setCode("");
      pin.current?.focus();
    }
  }

  async function sendAnother(): Promise<void> {
    const next = await resend.mutateAsync({
      challengeId: challenge.challengeId,
    });
    await navigate({ to: "/auth/verify", search: next, replace: true });
  }

  /**
   * Guard: Mantine validates the whole pasted string against `/^[0-9]+$/`, so a
   * paste of an entire sms — "Your code is 482913" — is dropped with no feedback
   * at all. People paste the message, not the digits.
   */
  function acceptPaste(event: ClipboardEvent<HTMLInputElement>): void {
    const digits = event.clipboardData
      .getData("text/plain")
      .replaceAll(/\D/gu, "");
    if (digits.length === 0) {
      return;
    }
    event.preventDefault();
    const next = digits.slice(0, CODE_LENGTH);
    setCode(next);
    if (next.length === CODE_LENGTH) {
      void verify(next);
    }
  }

  const attemptsLeft = AUTH_CHALLENGE_MAX_ATTEMPTS - failures;
  /**
   * Guard: auto-submit is withdrawn once the budget is short. It saves a tap
   * after an sms autofill, but with two attempts spent a misfiring autofill or a
   * fat-fingered sixth digit would burn one of the three that remain.
   */
  const autoSubmits = failures < AUTO_SUBMIT_BUDGET;

  return (
    <>
      <AuthHeading
        takeFocus={false}
        title={t("auth.otp.title")}
        subtitle={
          /**
           * Guard: `Trans`, not interpolation into a string. The target sits at
           * the end of the english sentence and at the start of the turkish one,
           * so any code that splits the sentence to style the target assumes a
           * word order one of the two locales does not have.
           */
          <Trans
            i18nKey={
              challenge.channel === "phone"
                ? "auth.otp.sentPhone"
                : "auth.otp.sentEmail"
            }
            values={{ target: challenge.maskedTarget }}
            components={{ target: <span className="font-mono text-ink" /> }}
          />
        }
      />

      {dead ? (
        <Alert
          className="mt-6"
          color="var(--color-amber)"
          variant="light"
          title={t(
            expired
              ? "auth.errors.challenge_expired.title"
              : "auth.errors.challenge_burned.title",
          )}
        >
          {t(
            expired
              ? "auth.errors.challenge_expired.body"
              : "auth.errors.challenge_burned.body",
          )}
        </Alert>
      ) : null}

      <div className="mt-8">
        <Input.Wrapper
          /**
           * Guard: `labelElement="div"`. A `<label>` cannot name six inputs, and
           * the wrapper's context is what wires `aria-describedby` from this
           * description and error onto every one of them.
           */
          labelElement="div"
          label={t("auth.fields.code.label")}
          error={
            failures > 0 && !dead
              ? t("auth.errors.challenge_wrong.body")
              : undefined
          }
        >
          <PinInput
            ref={pin}
            length={CODE_LENGTH}
            type="number"
            autoFocus
            size="md"
            radius="md"
            gap="xs"
            value={code}
            onChange={setCode}
            onComplete={(value) => {
              if (autoSubmits) {
                void verify(value);
              }
            }}
            disabled={dead || busy}
            error={failures > 0 && !dead}
            getInputProps={(index) => ({
              className: "font-mono",
              onPaste: acceptPaste,
              "aria-label": t("auth.fields.code.digit", {
                index: index + 1,
                count: CODE_LENGTH,
              }),
            })}
          />
        </Input.Wrapper>

        {dead ? null : (
          <p className="mt-2 text-xs text-ink-dim">
            {expiresIn < MINUTE_MS
              ? t("auth.otp.expiresSoon")
              : t("auth.otp.expiresIn", {
                  count: Math.ceil(expiresIn / MINUTE_MS),
                })}
            {failures > 0
              ? ` ${t("auth.otp.attemptsLeft", { count: attemptsLeft })}`
              : ""}
          </p>
        )}
      </div>

      {autoSubmits || dead ? null : (
        <Button
          fullWidth
          size="md"
          radius="md"
          className="mt-6"
          loading={confirm.isPending}
          disabled={busy || code.length < CODE_LENGTH}
          onClick={() => {
            void verify(code);
          }}
        >
          {t("auth.otp.submit")}
        </Button>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-hairline pt-5">
        {expired ? (
          <AuthLink to="/auth/register" className="text-sm">
            {t("auth.otp.startOver")}
          </AuthLink>
        ) : (
          <ResendButton
            disabled={resendIn > 0 || busy}
            remainingMs={resendIn}
            onResend={() => {
              void sendAnother().then(() => {
                setAnnouncement(t("auth.otp.resent"));
              });
            }}
          />
        )}
        <AuthLink to="/auth/login" className="text-sm">
          {t("auth.actions.backToSignIn")}
        </AuthLink>
      </div>

      <LiveStatus message={announcement} />
    </>
  );
}

/**
 * Guard: the visible countdown is `aria-hidden` and the button's accessible name
 * is static per state. An accessible name that changes every second is read out
 * every second, which makes the control unusable with a screen reader.
 */
function ResendButton({
  disabled,
  remainingMs,
  onResend,
}: Readonly<{ disabled: boolean; remainingMs: number; onResend: () => void }>) {
  const { t } = useTranslation();
  const waiting = remainingMs > 0;

  return (
    <Button
      variant="subtle"
      size="compact-sm"
      disabled={disabled}
      onClick={onResend}
      aria-label={t(waiting ? "auth.otp.resendUnavailable" : "auth.otp.resend")}
    >
      {waiting ? (
        <span aria-hidden className="tabular-nums">
          {t("auth.otp.resendCountdown", { time: asClock(remainingMs) })}
        </span>
      ) : (
        t("auth.otp.resend")
      )}
    </Button>
  );
}
