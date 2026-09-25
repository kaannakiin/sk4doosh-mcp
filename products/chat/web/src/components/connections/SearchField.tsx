import { Kbd, TextInput } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { useRef } from "react";

interface SearchFieldProps {
  readonly value: string;
  readonly label: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  readonly className?: string;
}

export function SearchField({
  value,
  label,
  placeholder,
  onChange,
  className,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);

  useHotkeys([
    [
      "/",
      () => {
        input.current?.focus();
      },
    ],
  ]);

  return (
    <TextInput
      ref={input}
      className={className}
      type="search"
      size="sm"
      radius="md"
      value={value}
      aria-label={label}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      leftSection={<IconSearch size={15} />}
      rightSection={value === "" ? <Kbd size="xs">/</Kbd> : null}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onChange("");
          event.currentTarget.blur();
        }
      }}
    />
  );
}
