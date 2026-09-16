/**
 * Seven day toggles — 28px squares, accent fill when selected.
 *
 * Shared by the Rules rows and the New rule sheet, which previously carried two
 * separate copies of the same markup.
 */

const DAYS = [
  { value: 0, short: "S", name: "Sunday" },
  { value: 1, short: "M", name: "Monday" },
  { value: 2, short: "T", name: "Tuesday" },
  { value: 3, short: "W", name: "Wednesday" },
  { value: 4, short: "T", name: "Thursday" },
  { value: 5, short: "F", name: "Friday" },
  { value: 6, short: "S", name: "Saturday" },
] as const;

export function DayPicker({
  days,
  onToggle,
  disabled = false,
}: {
  days: number[];
  onToggle: (day: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-none gap-1" role="group" aria-label="Days">
      {DAYS.map((day) => {
        const on = days.includes(day.value);
        return (
          <button
            key={day.value}
            type="button"
            aria-pressed={on}
            aria-label={day.name}
            disabled={disabled}
            onClick={() => onToggle(day.value)}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] border text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: on ? "var(--ff-accent)" : "var(--ff-card)",
              color: on ? "#fff" : "var(--ff-ink-3)",
              borderColor: on ? "var(--ff-accent)" : "var(--ff-control-line)",
            }}
          >
            {day.short}
          </button>
        );
      })}
    </div>
  );
}
