import { useEffect, useId, useRef, useState } from "react";
import { decimalError, normalizeDecimal, parseDecimal } from "@/lib/numeric";

/** Keep keyboard text local; commit only valid numbers (or an intentional clear) on blur. */
export function DecimalInput({
  value,
  onChange,
  className,
  placeholder,
  min,
  max,
  integer = false,
  label,
  disabled,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  className?: string | undefined;
  placeholder?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  integer?: boolean;
  label?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const [raw, setRaw] = useState(value == null ? "" : String(value));
  const [error, setError] = useState("");
  const focused = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!focused.current) setRaw(value == null ? "" : String(value));
  }, [value]);
  return (
    <>
      <input
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        value={raw}
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={error ? id : undefined}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          setRaw(event.target.value);
          const message = decimalError(parseDecimal(event.target.value), { min, max, integer });
          event.target.setCustomValidity(message);
          setError(message);
        }}
        onBlur={(event) => {
          focused.current = false;
          const result = parseDecimal(raw);
          const message = decimalError(result, { min, max, integer });
          event.target.setCustomValidity(message);
          setError(message);
          if (message || result.kind === "invalid") return;
          setRaw(normalizeDecimal(raw));
          const next = result.kind === "value" ? result.value : undefined;
          if (next !== value) onChange(next);
        }}
      />
      {error ? (
        <span id={id} role="alert" className="mt-1 block text-[11px] text-danger">
          {error}
        </span>
      ) : null}
    </>
  );
}
