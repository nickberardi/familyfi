/**
 * Segmented control — Always|Scheduled, Person/Network scope, Category|App.
 *
 * Replaces four hand-rolled copies of the same inline-styled ternary. The selected
 * segment is a white chip on the --ff-field trough, exactly as the design specifies.
 */

export type Segment<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function Segmented<T extends string>({
  name,
  value,
  segments,
  onChange,
  size = "md",
  grow = false,
}: {
  /** Accessible name for the radio-style group. */
  name: string;
  value: T;
  segments: readonly Segment<T>[];
  onChange: (next: T) => void;
  size?: "sm" | "md";
  /** Stretch segments to fill the row (sheet controls) instead of hugging (table rows). */
  grow?: boolean;
}) {
  const pad = size === "sm" ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-1.5 text-[13px]";

  return (
    <div
      role="group"
      aria-label={name}
      className="flex flex-none gap-0.5 rounded-lg p-0.5"
      style={{ background: "var(--ff-field)" }}
    >
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            aria-pressed={active}
            disabled={segment.disabled}
            onClick={() => !segment.disabled && onChange(segment.value)}
            className={`rounded-md font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${pad} ${
              grow ? "flex-1 text-center" : ""
            }`}
            style={
              active
                ? { background: "var(--ff-card)", color: "var(--ff-ink)" }
                : { background: "transparent", color: "var(--ff-ink-3)" }
            }
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
