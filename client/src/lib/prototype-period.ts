import { PROTOTYPE_DATE } from "@shared/prototype";

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  return day <= daysInMonth ? { year, month, day } : null;
}

function quarterOf(date: CalendarDate): number {
  return Math.floor((date.month - 1) / 3);
}

/** Returns whether a valid calendar date belongs to the selected prototype period. */
export function inPrototypePeriod(
  date: string,
  period: string,
  reference = PROTOTYPE_DATE
): boolean {
  const selectedPeriod = period.trim();
  if (!selectedPeriod || selectedPeriod === "all") return true;

  const candidate = parseCalendarDate(date);
  if (!candidate) return false;

  if (/^\d{4}-\d{2}$/.test(selectedPeriod)) {
    const [year, month] = selectedPeriod.split("-").map(Number);
    return month >= 1 && month <= 12 && candidate.year === year && candidate.month === month;
  }

  if (/^\d{4}$/.test(selectedPeriod)) {
    return candidate.year === Number(selectedPeriod);
  }

  const scenarioDate = parseCalendarDate(reference);
  if (!scenarioDate) return false;

  if (selectedPeriod === "month") {
    return candidate.year === scenarioDate.year && candidate.month === scenarioDate.month;
  }
  if (selectedPeriod === "quarter") {
    return candidate.year === scenarioDate.year && quarterOf(candidate) === quarterOf(scenarioDate);
  }
  if (selectedPeriod === "year") {
    return candidate.year === scenarioDate.year;
  }

  return false;
}
