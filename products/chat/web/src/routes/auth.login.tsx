import {
  passwordLoginSchema,
  type PasswordLogin,
} from "@chat/contracts/auth/auth";
import { errorCodeOf } from "@chat/queries/client";

import { ApiRequestError } from "~/lib/api-response";
import { useLoginPassword } from "@chat/queries/auth/mutations";
import { Alert, Button, PasswordInput, TextInput } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AuthHeading } from "~/components/auth/AuthHeading";
import { AuthLink } from "~/components/auth/AuthLink";
import { LiveStatus } from "~/components/auth/LiveStatus";
import { OAuthButtons } from "~/components/auth/OAuthButtons";
import { applyServerIssues } from "~/core/forms/apply-server-issues";
import { contractResolver } from "~/core/forms/contract-resolver";
import { useAuthError } from "~/core/forms/use-auth-error";
import { useLocale } from "~/core/hooks/use-locale";
import { preloadPhoneKit } from "~/core/hooks/use-phone-kit";
import { resetSessionGuard } from "~/lib/auth-refresh";

export const Route = createFileRoute("/auth/login")({ component: LoginRoute });

function noticeOf(
  describe: ReturnType<typeof useAuthError>,
  notice: string | undefined,
): ReturnType<ReturnType<typeof useAuthError>> {
  return notice === undefined
    ? undefined
    : describe(new ApiRequestError({ code: notice, message: "" }));
}

function LoginRoute() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const login = useLoginPassword(locale);
  const describe = useAuthError();

  const [formError, setFormError] = useState<unknown>(undefined);

  const form = useForm<PasswordLogin>({
    resolver: contractResolver(passwordLoginSchema, t),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      await login.mutateAsync(values);
      resetSessionGuard();
      await navigate({ to: search.next ?? "/", replace: true });
    } catch (error) {
      /**
       * Guard: `mutateAsync` is awaited inside `handleSubmit` so a rejection
       * lands here instead of becoming an unhandled rejection. The mutation's own
       * `isError` cannot drive field errors — it has no `setError`.
       */
      if (applyServerIssues(error, form.setError) === "form") {
        setFormError(error);
      }
      /**
       * Guard: the password is cleared but the email is kept. The api refuses to
       * say which half was wrong, and a manager-filled password that was rejected
       * is the one field worth retyping.
       */
      if (errorCodeOf(error) === "invalid_credentials") {
        form.resetField("password");
      }
    }
  });

  /**
   * Guard: a notice from the oauth callback is shown until the reader submits.
   * The provider round trip ends on this screen with nothing but a code in the
   * url, so this is the only place its outcome can be explained.
   */
  const failure = describe(formError) ?? noticeOf(describe, search.notice);

  return (
    <>
      <AuthHeading title={t("auth.login.title")} />

      {failure === undefined ? null : (
        <Alert
          className="mt-6"
          color="var(--color-red)"
          variant="light"
          title={failure.title}
        >
          {failure.body}
        </Alert>
      )}

      <form onSubmit={submit} noValidate aria-busy={isSubmitting} className="mt-8">
        <div className="flex flex-col gap-4">
          <TextInput
            {...form.register("email")}
            size="md"
            radius="md"
            type="email"
            inputMode="email"
            /**
             * Guard: `username`, not `email`, on the sign-in screen alone.
             * Password managers key a credential pair off `username` paired with
             * `current-password`; the register screen uses `email` because there
             * is no pair there to match.
             */
            autoComplete="username"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            label={t("auth.fields.email.label")}
            error={errors.email?.message}
          />
          <PasswordInput
            {...form.register("password")}
            size="md"
            radius="md"
            autoComplete="current-password"
            maxLength={128}
            label={t("auth.fields.password.label")}
            visibilityToggleFocusable
            visibilityToggleButtonProps={{
              "aria-label": t("auth.fields.password.toggle"),
            }}
            error={errors.password?.message}
          />
        </div>

        <Button
          type="submit"
          fullWidth
          size="md"
          radius="md"
          className="mt-6"
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {t("auth.login.submit")}
        </Button>
      </form>

      <OAuthButtons />

      <p className="mt-8 flex flex-col gap-2 border-t border-hairline pt-5 text-sm text-ink-dim">
        <AuthLink
          to="/auth/login/phone"
          search={search}
          onPointerEnter={preloadPhoneKit}
          onFocus={preloadPhoneKit}
        >
          {t("auth.login.phoneLink")}
        </AuthLink>
        <AuthLink to="/auth/register" search={search}>
          {t("auth.login.createAccount")}
        </AuthLink>
      </p>

      <LiveStatus message={isSubmitting ? t("auth.status.submitting") : ""} />
    </>
  );
}
