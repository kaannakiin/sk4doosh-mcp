import {
  oauthProfileCompletionSchema,
  type OAuthProfileCompletion,
} from "@chat/contracts/auth/auth";
import { useCompleteOAuthProfile } from "@chat/queries/auth/mutations";
import { Alert, Button, TextInput } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AuthHeading } from "~/components/auth/AuthHeading";
import { LiveStatus } from "~/components/auth/LiveStatus";
import { applyServerIssues } from "~/core/forms/apply-server-issues";
import { contractResolver } from "~/core/forms/contract-resolver";
import { useAuthError } from "~/core/forms/use-auth-error";
import { useLocale } from "~/core/hooks/use-locale";
import { resetSessionGuard } from "~/lib/auth-refresh";

export const Route = createFileRoute("/auth/complete")({
  component: CompleteRoute,
});

function CompleteRoute() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const complete = useCompleteOAuthProfile(locale);
  const describe = useAuthError();
  const [formError, setFormError] = useState<unknown>(undefined);

  const form = useForm<OAuthProfileCompletion>({
    resolver: contractResolver(oauthProfileCompletionSchema, t),
    defaultValues: { firstName: "", lastName: "" },
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      await complete.mutateAsync(values);
      resetSessionGuard();
      await navigate({ to: search.next ?? "/", replace: true });
    } catch (error) {
      if (applyServerIssues(error, form.setError) === "form") {
        setFormError(error);
      }
    }
  });

  const failure = describe(formError);

  return (
    <>
      <AuthHeading title={t("auth.complete.title")} />

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

      <form
        onSubmit={submit}
        noValidate
        aria-busy={isSubmitting}
        className="mt-8"
      >
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

        <Button
          type="submit"
          fullWidth
          size="md"
          radius="md"
          className="mt-6"
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {t("auth.complete.submit")}
        </Button>
      </form>

      <LiveStatus message={isSubmitting ? t("auth.status.submitting") : ""} />
    </>
  );
}
