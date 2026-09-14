import {
  Input,
  Select,
  TextInput,
  type ComboboxItem,
  type MantineSize,
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
const E164_MAX_DIGITS = 15;

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
  readonly size?: MantineSize;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly name?: string;
}

interface MobileLengths {
  readonly possibleLengths?: () => readonly number[];
  readonly type?: (
    kind: "MOBILE",
  ) => { readonly possibleLengths?: () => readonly number[] } | undefined;
}

interface Bounds {
  readonly min: number;
  readonly max: number;
}

const bounds = new Map<CountryCode, Bounds>();

/**
 * How many national digits a mobile number in this country can have.
 *
 * Guard: read from the mobile number description, not from
 * `validatePhoneNumberLength`, which answers for every number type the plan
 * knows. Turkey's plan allows thirteen digits across all types while a mobile
 * number is ten, so length validation alone lets `54542148455555` stand in a
 * field that only accepts mobiles. The mobile lengths are reached defensively
 * because the published typings stop at the plan.
 */
function mobileBounds(kit: PhoneKit, country: CountryCode): Bounds {
  const cached = bounds.get(country);
  if (cached !== undefined) {
    return cached;
  }

  const metadata = new kit.Metadata();
  metadata.selectNumberingPlan(country);
  const plan = metadata.numberingPlan as unknown as MobileLengths | undefined;
  const lengths =
    plan?.type?.("MOBILE")?.possibleLengths?.() ?? plan?.possibleLengths?.();
  const known = lengths !== undefined && lengths.length > 0;
  const next: Bounds = {
    min: known ? Math.min(...lengths) : 1,
    max: known ? Math.max(...lengths) : E164_MAX_DIGITS,
  };

  bounds.set(country, next);
  return next;
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
 *
 * Guard: formatted through the international formatter with the calling code cut
 * back off, not through `AsYouType(country)`. Most countries write their national
 * format around the national prefix — `AsYouType("DE").input("15112345678")`
 * returns the digits untouched because nothing typed here carries the leading
 * zero — so the national formatter silently formats Turkey and almost nowhere
 * else.
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

  const prefix = `+${kit.getCountryCallingCode(country)}`;
  const formatter = new kit.AsYouType();
  const formatted = formatter.input(`${prefix}${digits}`);
  const text = formatted.startsWith(prefix)
    ? formatted.slice(prefix.length).trimStart()
    : formatted;

  if (digits.length === 0) {
    return { text, e164: "", issue: undefined };
  }

  const parsed = formatter.getNumber();
  if (parsed?.isValid() === true) {
    return { text, e164: parsed.number, issue: undefined };
  }

  const tooShort =
    parsed === undefined ||
    digits.length < mobileBounds(kit, country).min ||
    kit.validatePhoneNumberLength(digits, country) === "TOO_SHORT";

  return { text, e164: "", issue: tooShort ? "incomplete" : "unsupported" };
}

/**
 * The national digits a change should leave in the field, or `undefined` when the
 * field should refuse them.
 *
 * Guard: length is capped at the input, not reported after the fact. Without it
 * the field takes any number of digits and only calls the result unsupported on
 * blur, so `54542148455555` sits there looking like a phone number.
 *
 * Guard: an international number pasted over the field re-selects the country
 * rather than being refused. The cap would otherwise reject `+905425551234`
 * outright and leave the field empty with no explanation.
 */
function adopt(
  kit: PhoneKit | undefined,
  country: CountryCode,
  typed: string,
  digits: string,
): { readonly country: CountryCode; readonly digits: string } | undefined {
  if (kit === undefined) {
    return digits.length <= E164_MAX_DIGITS ? { country, digits } : undefined;
  }

  if (typed.trimStart().startsWith("+")) {
    const parsed = kit.parsePhoneNumberFromString(typed);
    if (parsed?.country !== undefined) {
      return { country: parsed.country, digits: parsed.nationalNumber };
    }
  }

  const { max } = mobileBounds(kit, country);
  if (digits.length <= max) {
    return { country, digits };
  }

  const callingCode = kit.getCountryCallingCode(country);
  const rest = digits.startsWith(callingCode)
    ? digits.slice(callingCode.length)
    : "";

  return rest.length > 0 && rest.length <= max
    ? { country, digits: rest }
    : undefined;
}

/**
 * Guard: the flag is a background image, not an `<img>`. libphonenumber knows a
 * handful of territories the flag cdn does not serve (`AC`, `TA`), and a missing
 * background leaves an empty box where a missing `src` would draw the browser's
 * broken-image icon in the middle of the country list.
 */
function CountryFlag({ iso }: Readonly<{ iso: string }>) {
  return (
    <span
      aria-hidden
      className="ring-hairline h-3.75 w-5 shrink-0 rounded-xs bg-cover bg-center ring-1"
      style={{
        backgroundImage: `url(https://flagcdn.com/w40/${iso.toLowerCase()}.png)`,
      }}
    />
  );
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
  size,
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

  const { known, haystack, nameOf } = useMemo(() => {
    const named = new Map<string, string>();
    const folded = new Map<string, string>();

    if (kit === undefined) {
      return { known: [] as ComboboxItem[], haystack: folded, nameOf: named };
    }

    const names = new Intl.DisplayNames([locale], { type: "region" });

    const options = kit
      .getCountries()
      .map((iso) => {
        const name = names.of(iso) ?? iso;
        const label = `+${kit.getCountryCallingCode(iso)}`;
        named.set(iso, name);
        folded.set(iso, fold(`${name} ${label} ${iso}`));
        return { value: iso, label };
      })
      /**
       * Guard: sorted with the reader's collation, not by code unit. Turkish
       * orders `Ç` after `C` and `İ` after `I`, so an ordinal sort scatters
       * every accented country to the end of a 245-row list.
       */
      .sort((a, b) =>
        (named.get(a.value) ?? a.value).localeCompare(
          named.get(b.value) ?? b.value,
          locale,
        ),
      );

    return { known: options, haystack: folded, nameOf: named };
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
          size={size}
          searchable
          filter={filter}
          allowDeselect={false}
          disabled={disabled}
          autoComplete="tel-country-code"
          aria-label={countryLabel}
          error={error !== undefined}
          leftSection={<CountryFlag iso={country} />}
          comboboxProps={{ width: 320, position: "bottom-start" }}
          renderOption={({ option }) => (
            <div className="flex w-full items-center gap-2.5">
              <CountryFlag iso={option.value} />
              <span className="flex-1 truncate">
                {nameOf.get(option.value) ?? option.value}
              </span>
              <span className="text-ink-dim text-xs tabular-nums">
                {option.label}
              </span>
            </div>
          )}
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
          size={size}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
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
            if (typed.length < reading.text.length && next === digits) {
              setDigits(next.slice(0, -1));
              return;
            }

            const adopted = adopt(kit, country, typed, next);
            if (adopted === undefined) {
              return;
            }

            setCountry(adopted.country);
            setDigits(adopted.digits);
          }}
        />
      </div>
    </Input.Wrapper>
  );
}
