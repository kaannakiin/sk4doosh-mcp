import {
  emailRegistrationSchema,
  type EmailRegistration,
} from "@chat/contracts/auth/auth";
import { useRegisterEmail } from "@chat/queries/auth/mutations";
import { Alert, Button, PasswordInput, TextInput } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AuthHeading } from "~/components/auth/AuthHeading";
import { AuthLink } from "~/components/auth/AuthLink";
import { AuthMethodSwitch } from "~/components/auth/AuthMethodSwitch";
import { LiveStatus } from "~/components/auth/LiveStatus";
import { OAuthButtons } from "~/components/auth/OAuthButtons";
import { REGISTER_METHODS } from "~/components/auth/register-methods";
import { applyServerIssues } from "~/core/forms/apply-server-issues";
import { contractResolver } from "~/core/forms/contract-resolver";
import { useAuthError } from "~/core/forms/use-auth-error";
import { useLocale } from "~/core/hooks/use-locale";

export const Route = createFileRoute("/auth/register")({
  component: RegisterRoute,
});

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

/**
 * Guard: `account_exists` carries no `issues[]`, so it is pinned to the field it
 * is actually about. The recovery is a link to sign in, which the alert below
 * renders beside it.
 */
const FIELD_FOR_CODE = { account_exists: "email" } as const;

function RegisterRoute() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const register = useRegisterEmail(locale);
  const describe = useAuthError();
  const [formError, setFormError] = useState<unknown>(undefined);

  const form = useForm<EmailRegistration>({
    resolver: contractResolver(emailRegistrationSchema, t),
    defaultValues: { firstName: "", lastName: "", email: "", password: "" },
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      const challenge = await register.mutateAsync(values);
      await navigate({
        to: "/auth/verify",
        search: { ...search, ...challenge },
        replace: true,
      });
    } catch (error) {
      if (applyServerIssues(error, form.setError, FIELD_FOR_CODE) === "form") {
        setFormError(error);
      }
    }
  });

  const failure = describe(formError);
  const taken = errors.email?.type === "account_exists";

  return (
    <>
      <AuthHeading title={t("auth.register.title")} />

      <AuthMethodSwitch
        methods={REGISTER_METHODS}
        current="/auth/register"
        label={t("auth.register.methodLabel")}
      />

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

      <form onSubmit={submit} noValidate aria-busy={isSubmitting} className="mt-6">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <TextInput
              {...form.register("firstName")}
              size="md"
              radius="md"
              autoComplete="given-name"
              autoCapitalize="words"
              spellCheck={false}
              label={t("auth.fields.firstName.label")}
              error={errors.firstName?.message}
            />
            <TextInput
              {...form.register("lastName")}
              size="md"
              radius="md"
              autoComplete="family-name"
              autoCapitalize="words"
              spellCheck={false}
              label={t("auth.fields.lastName.label")}
              error={errors.lastName?.message}
            />
          </div>
          <TextInput
            {...form.register("email")}
            size="md"
            radius="md"
            type="email"
            inputMode="email"
            autoComplete="email"
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
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            label={t("auth.fields.password.label")}
            description={t("auth.fields.password.hint", { min: PASSWORD_MIN })}
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
          {t("auth.register.submit")}
        </Button>
      </form>

      <OAuthButtons />

      <p className="mt-8 border-t border-hairline pt-5 text-sm text-ink-dim">
        <AuthLink to="/auth/login" search={search}>
          {taken
            ? t("auth.errors.account_exists.action")
            : t("auth.register.signIn")}
        </AuthLink>
      </p>

      <LiveStatus message={isSubmitting ? t("auth.status.submitting") : ""} />
    </>
  );
}
