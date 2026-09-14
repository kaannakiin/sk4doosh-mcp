import {
  Input,
  Select,
  TextInput,
  type ComboboxItem,
  type OptionsFilter,
} from "@mantine/core";
import type { CountryCode } from "libphonenumber-js";
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useLocale } from "~/core/hooks/use-locale";
import {
  preloadPhoneKit,
  usePhoneKit,
  type PhoneKit,
} from "~/core/hooks/use-phone-kit";
import { fold } from "~/core/text/fold";

const NON_DIGITS = /\D/gu;

/** Why the typed number cannot be dialled, for the caller to phrase. */
export type PhoneIssue = "incomplete" | "unsupported";

export interface PhoneInputProps {
  /** The number in E.164, or an empty string while it is not yet dialable. */
  readonly value: string;
  readonly onChange: (e164: string) => void;
  readonly onBlur?: () => void;
  readonly onIssueChange?: (issue: PhoneIssue | undefined) => void;
  readonly defaultCountry?: CountryCode;
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  /** Accessible name for the country selector. */
  readonly countryLabel: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly name?: string;
}

interface Reading {
  readonly text: string;
  readonly e164: string;
  readonly issue: PhoneIssue | undefined;
}

/**
 * Guard: the digits are the state and the formatted string is derived from them
 * on every pass, never stored. Feeding `AsYouType` its own output re-enters the
 * separators the reader just deleted, and holding the formatted string would
 * leave anything typed before the metadata arrived unformatted for good.
 */
function read(
  kit: PhoneKit | undefined,
  country: CountryCode,
  digits: string,
): Reading {
  if (kit === undefined) {
    return {
      text: digits,
      e164: "",
      issue: digits.length > 0 ? "incomplete" : undefined,
    };
  }

  const formatter = new kit.AsYouType(country);
  const text = formatter.input(digits);

  if (digits.length === 0) {
    return { text, e164: "", issue: undefined };
  }

  const parsed = formatter.getNumber();
  if (parsed?.isValid() === true) {
    return { text, e164: parsed.number, issue: undefined };
  }

  const tooShort =
    parsed === undefined ||
    kit.validatePhoneNumberLength(digits, country) === "TOO_SHORT";

  return { text, e164: "", issue: tooShort ? "incomplete" : "unsupported" };
}

/**
 * A phone number field for every country libphonenumber knows, emitting E.164.
 *
 * Guard: the caller decides when an issue becomes a visible message. This
 * reports through `onIssueChange` and renders whatever `error` it is handed, so
 * the field never shouts at someone who is still typing.
 *
 * Guard: validation here is UX, never the gate. The api re-validates at
 * registration; a number that reaches it has only passed a browser.
 */
export function PhoneInput({
  value,
  onChange,
  onBlur,
  onIssueChange,
  defaultCountry = "TR",
  label,
  description,
  error,
  countryLabel,
  placeholder,
  disabled,
  required,
  name,
}: PhoneInputProps) {
  const locale = useLocale();
  const kit = usePhoneKit();
  const inputId = useId();
  const [country, setCountry] = useState<CountryCode>(defaultCountry);
  const [digits, setDigits] = useState("");
  const [adoptedFrom, setAdoptedFrom] = useState("");
  const pristine = useRef(true);

  /**
   * Guard: adjusting state during render rather than in an effect, which is what
   * React prescribes for state that follows a prop. An incoming E.164 can only
   * be split once the metadata has landed, and `adoptedFrom` bounds it to one
   * attempt per value — otherwise every keystroke that is not yet dialable, and
   * so reports an empty string upwards, would be undone on the next pass.
   */
  if (
    kit !== undefined &&
    value.length > 0 &&
    value !== adoptedFrom &&
    digits.length === 0
  ) {
    setAdoptedFrom(value);
    const parsed = kit.parsePhoneNumberFromString(value);
    if (parsed?.country !== undefined) {
      setCountry(parsed.country);
      setDigits(parsed.nationalNumber);
    }
  }

  const reading = read(kit, country, digits);
  const { e164, issue } = reading;

  const notify = useEffectEvent(
    (next: string, reason: PhoneIssue | undefined) => {
      onChange(next);
      onIssueChange?.(reason);
    },
  );

  /**
   * Guard: the first pass is swallowed. The caller's own initial value reaches
   * this component as a prop, and reporting the empty reading of a field nobody
   * has touched yet would wipe it before the metadata has even arrived.
   */
  useEffect(() => {
    if (pristine.current) {
      pristine.current = false;
      return;
    }
    notify(e164, issue);
  }, [e164, issue]);

  const { known, haystack } = useMemo(() => {
    if (kit === undefined) {
      return { known: [] as ComboboxItem[], haystack: new Map<string, string>() };
    }

    const names = new Intl.DisplayNames([locale], { type: "region" });
    const folded = new Map<string, string>();

    const options = kit
      .getCountries()
      .map((iso) => {
        const label = `${names.of(iso) ?? iso} +${kit.getCountryCallingCode(iso)}`;
        folded.set(iso, fold(`${label} ${iso}`));
        return { value: iso, label };
      })
      /**
       * Guard: sorted with the reader's collation, not by code unit. Turkish
       * orders `Ç` after `C` and `İ` after `I`, so an ordinal sort scatters
       * every accented country to the end of a 245-row list.
       */
      .sort((a, b) => a.label.localeCompare(b.label, locale));

    return { known: options, haystack: folded };
  }, [kit, locale]);

  /**
   * Guard: Mantine's default filter lowercases both sides, which cannot match a
   * Turkish name — see `fold`. The folded labels are built once with the list
   * rather than per keystroke, because there are 245 of them.
   */
  const filter = useMemo<OptionsFilter>(
    () =>
      ({ options, search, limit }) => {
        const needle = fold(search);
        const items = options as ComboboxItem[];
        const matched =
          needle.length === 0
            ? items
            : items.filter((item) =>
                (haystack.get(item.value) ?? fold(item.label)).includes(needle),
              );

        return matched.slice(0, limit);
      },
    [haystack],
  );

  const countries =
    known.length > 0 ? known : [{ value: country, label: country }];

  return (
    <Input.Wrapper
      label={label}
      description={description}
      error={error}
      required={required}
      labelProps={{ htmlFor: inputId }}
    >
      <div className="flex items-start gap-2">
        <Select
          className="w-32 shrink-0"
          data={countries}
          value={country}
          searchable
          filter={filter}
          limit={40}
          allowDeselect={false}
          disabled={disabled}
          aria-label={countryLabel}
          error={error !== undefined}
          onDropdownOpen={preloadPhoneKit}
          onChange={(next) => {
            if (next !== null) {
              setCountry(next as CountryCode);
            }
          }}
        />

        <TextInput
          id={inputId}
          className="flex-1"
          name={name}
          value={reading.text}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={placeholder}
          disabled={disabled}
          error={error !== undefined}
          onFocus={preloadPhoneKit}
          onBlur={onBlur}
          onChange={(event) => {
            const typed = event.currentTarget.value;
            const next = typed.replace(NON_DIGITS, "");

            /**
             * Guard: deleting a separator leaves the digits untouched, so the
             * formatter would put it straight back and the caret would never
             * move. A shorter string carrying the same digits means the reader
             * meant to delete the digit in front of it.
             */
            setDigits(
              typed.length < reading.text.length && next === digits
                ? next.slice(0, -1)
                : next,
            );
          }}
        />
      </div>
    </Input.Wrapper>
  );
}
