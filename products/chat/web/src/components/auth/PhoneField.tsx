import type { PhoneIssue } from "~/core/components/PhoneInput";
import { PhoneInput } from "~/core/components/PhoneInput";
import { useState } from "react";
import type { Control, FieldValues, Path } from "react-hook-form";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";

const ISSUE_KEY: Readonly<Record<PhoneIssue, string>> = {
  incomplete: "auth.fields.phone.incomplete",
  unsupported: "auth.fields.phone.unsupported",
};

/**
 * Guard: bound with `Controller`, not `register`. `PhoneInput` is a controlled
 * field that emits E.164 from a country selector plus a national number — there
 * is no single input and no change event for `register` to hook.
 *
 * Guard: a shape problem is held back until the field is left. Reporting it
 * while the reader is still typing means the number is "incomplete" after every
 * keystroke, which trains people to ignore the message by the time it is true.
 */
export function PhoneField<TValues extends FieldValues>({
  control,
  name,
}: Readonly<{ control: Control<TValues>; name: Path<TValues> }>) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<PhoneIssue | undefined>(undefined);
  const [touched, setTouched] = useState(false);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <PhoneInput
          name={field.name}
          value={field.value ?? ""}
          onChange={field.onChange}
          onBlur={() => {
            setTouched(true);
            field.onBlur();
          }}
          onIssueChange={setIssue}
          required
          label={t("auth.fields.phone.label")}
          countryLabel={t("auth.fields.phone.country")}
          size="md"
          error={
            fieldState.error?.message ??
            (touched && issue !== undefined ? t(ISSUE_KEY[issue]) : undefined)
          }
        />
      )}
    />
  );
}
