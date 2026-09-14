import {
  phoneLoginRequestSchema,
  type PhoneLoginRequest,
} from "@chat/contracts/auth/auth";
import { useRequestPhoneLogin } from "@chat/queries/auth/mutations";
import { Alert, Button } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AuthHeading } from "~/components/auth/AuthHeading";
import { AuthLink } from "~/components/auth/AuthLink";
import { LiveStatus } from "~/components/auth/LiveStatus";
import { OAuthButtons } from "~/components/auth/OAuthButtons";
import { PhoneField } from "~/components/auth/PhoneField";
import { applyServerIssues } from "~/core/forms/apply-server-issues";
import { contractResolver } from "~/core/forms/contract-resolver";
import { useAuthError } from "~/core/forms/use-auth-error";
import { useLocale } from "~/core/hooks/use-locale";

export const Route = createFileRoute("/auth/login_/phone")({
  component: LoginPhoneRoute,
});

function LoginPhoneRoute() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const request = useRequestPhoneLogin(locale);
  const describe = useAuthError();
  const [formError, setFormError] = useState<unknown>(undefined);

  const form = useForm<PhoneLoginRequest>({
    resolver: contractResolver(phoneLoginRequestSchema, t),
    defaultValues: { phoneE164: "" },
    mode: "onTouched",
  });
  const { isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      /**
       * Guard: this answer is not evidence the number is registered. The api
       * mints a decoy challenge for an unknown number and for any request inside
       * its sixty second window, so the step after this one is entered exactly
       * the same way either way — which is the whole point, and why nothing here
       * may branch on it.
       */
      const challenge = await request.mutateAsync(values);
      await navigate({
        to: "/auth/verify",
        search: { ...search, ...challenge },
        replace: true,
      });
    } catch (error) {
      if (applyServerIssues(error, form.setError) === "form") {
        setFormError(error);
      }
    }
  });

  const failure = describe(formError);

  return (
    <>
      <AuthHeading title={t("auth.loginPhone.title")} />

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
        <PhoneField control={form.control} name="phoneE164" />

        <Button
          type="submit"
          fullWidth
          size="md"
          radius="md"
          className="mt-6"
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {t("auth.loginPhone.submit")}
        </Button>
      </form>

      <OAuthButtons />

      <p className="mt-8 flex flex-col gap-2 border-t border-hairline pt-5 text-sm text-ink-dim">
        <AuthLink to="/auth/login" search={search}>
          {t("auth.loginPhone.passwordLink")}
        </AuthLink>
        <AuthLink to="/auth/register" search={search}>
          {t("auth.login.createAccount")}
        </AuthLink>
      </p>

      <LiveStatus message={isSubmitting ? t("auth.status.submitting") : ""} />
    </>
  );
}
