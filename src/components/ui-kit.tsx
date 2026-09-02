import { cn } from "@/lib/utils";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { DecimalInput } from "./DecimalInput";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("card-surface fade-up p-4", className)}>{children}</section>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "warn" | "danger" | "muted";
  className?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    good: "text-good",
    warn: "text-warn",
    danger: "text-danger",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div className={cn("card-surface fade-up p-3", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn("num mt-1 text-2xl font-semibold", toneClass)}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Bar({
  value,
  target,
  label,
  unit,
  range,
}: {
  value: number | undefined;
  target: number;
  label: string;
  unit: string;
  range?: readonly [number, number];
}) {
  const pct = Math.min(100, Math.round(((value ?? 0) / target) * 100));
  const v = value ?? 0;
  const inRange = range ? v >= range[0] && v <= range[1] : Math.abs(v - target) <= target * 0.05;
  const over = range ? v > range[1] * 1.05 : v > target * 1.1;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="num font-medium">
          {value ?? 0}
          <span className="text-muted-foreground">
            {" "}
            / {range ? `${range[0]} to ${range[1]}` : target} {unit}
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            over ? "bg-warn" : value != null && inRange ? "bg-good" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] text-muted-foreground/80">{hint}</span>
      ) : null}
    </label>
  );
}

export function NumInput({
  value,
  onChange,
  placeholder,
  step = "0.1",
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <DecimalInput
      value={value}
      integer={step === "1"}
      placeholder={placeholder}
      onChange={onChange}
      className="num mt-1 w-full rounded-xl border border-input bg-elevated px-3 py-2.5 text-lg font-semibold outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-ring"
    />
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-2 text-sm font-medium transition-all active:scale-95",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-elevated text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-elevated/70 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

export function PendingLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {children}
    </span>
  );
}
