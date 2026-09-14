import {
  phoneRegistrationSchema,
  type PhoneRegistration,
} from "@chat/contracts/auth/auth";
import { useRegisterPhone } from "@chat/queries/auth/mutations";
import { Alert, Button, TextInput } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AuthHeading } from "~/components/auth/AuthHeading";
import { AuthLink } from "~/components/auth/AuthLink";
import { AuthMethodSwitch } from "~/components/auth/AuthMethodSwitch";
import { LiveStatus } from "~/components/auth/LiveStatus";
import { OAuthButtons } from "~/components/auth/OAuthButtons";
import { PhoneField } from "~/components/auth/PhoneField";
import { REGISTER_METHODS } from "~/components/auth/register-methods";
import { applyServerIssues } from "~/core/forms/apply-server-issues";
import { contractResolver } from "~/core/forms/contract-resolver";
import { useAuthError } from "~/core/forms/use-auth-error";
import { useLocale } from "~/core/hooks/use-locale";

export const Route = createFileRoute("/auth/register_/phone")({
  component: RegisterPhoneRoute,
});

const FIELD_FOR_CODE = { account_exists: "phoneE164" } as const;

function RegisterPhoneRoute() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const register = useRegisterPhone(locale);
  const describe = useAuthError();
  const [formError, setFormError] = useState<unknown>(undefined);

  const form = useForm<PhoneRegistration>({
    resolver: contractResolver(phoneRegistrationSchema, t),
    defaultValues: { firstName: "", lastName: "", phoneE164: "" },
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

  return (
    <>
      <AuthHeading title={t("auth.register.title")} />

      <AuthMethodSwitch
        methods={REGISTER_METHODS}
        current="/auth/register/phone"
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
          <PhoneField control={form.control} name="phoneE164" />
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
          {t("auth.register.submitPhone")}
        </Button>
      </form>

      <OAuthButtons />

      <p className="mt-8 border-t border-hairline pt-5 text-sm text-ink-dim">
        <AuthLink to="/auth/login" search={search}>
          {t("auth.register.signIn")}
        </AuthLink>
      </p>

      <LiveStatus message={isSubmitting ? t("auth.status.submitting") : ""} />
    </>
  );
}
