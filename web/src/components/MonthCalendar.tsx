import { datesInMonth, monthLabel, weekdayOf } from "../dates";
import { formatDate } from "../format";

const WEEKDAYS = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
];

interface Props {
  month: string; // YYYY-MM
  /** Dates that can be tapped. Others are shown greyed out. */
  enabled: Set<string>;
  selected: Set<string>;
  onToggle?: (date: string) => void;
  /** Optional count shown in each cell (e.g. how many people are free). */
  counts?: Map<string, number>;
  /** Dates to highlight as the most popular. */
  best?: Set<string>;
  /** Text describing what "selected" means, for screen readers. */
  selectedLabel?: string;
}

export function MonthCalendar({ month, enabled, selected, onToggle, counts, best, selectedLabel = "selected" }: Props) {
  const days = datesInMonth(month);
  const leading = weekdayOf(days[0]);

  return (
    <div className="calendar" role="group" aria-label={monthLabel(month)}>
      <p className="calendar-month">{monthLabel(month)}</p>
      <div className="calendar-grid">
        {WEEKDAYS.map(([short, long]) => (
          <div key={short} className="calendar-weekday">
            <abbr title={long}>{short}</abbr>
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}
        {days.map((d) => {
          const isEnabled = enabled.has(d);
          const isSelected = selected.has(d);
          const count = counts?.get(d) ?? 0;
          const isBest = best?.has(d);
          const day = Number(d.slice(8));
          const label = `${formatDate(d)}${isSelected ? `, ${selectedLabel}` : ""}${counts ? `, ${count} available` : ""}${isBest ? ", most popular" : ""}`;
          return (
            <button
              key={d}
              type="button"
              className={`calendar-day${isSelected ? " selected" : ""}${isBest ? " best" : ""}${isEnabled ? "" : " unavailable"}`}
              disabled={!isEnabled || !onToggle}
              aria-pressed={isEnabled && onToggle ? isSelected : undefined}
              aria-label={label}
              onClick={() => onToggle?.(d)}
            >
              <span className="calendar-day-num">{day}</span>
              {isEnabled && isSelected && (
                <span className="calendar-check" aria-hidden="true">
                  ✓
                </span>
              )}
              {isEnabled && counts && (
                <span className="calendar-count" aria-hidden="true">
                  {count > 0 ? `${count} free` : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
