/**
 * Signalyn Europe/Athens Timezone & Reporting Window Utility
 *
 * Ensures robust 24-hour reporting windows aligned to Europe/Athens local time,
 * safely handling Daylight Saving Time (UTC+2 in winter, UTC+3 in summer) without
 * naive fixed hour assumptions.
 */

export interface AthensReportingWindow {
  dateStr: string; // 'YYYY-MM-DD'
  windowStartIso: string; // ISO 8601 string representing 00:00:00 in Europe/Athens
  windowEndIso: string; // ISO 8601 string representing 23:59:59.999 in Europe/Athens
  timezone: string; // 'Europe/Athens'
  offsetMinutes: number; // e.g., 120 (UTC+2) or 180 (UTC+3)
}

/**
 * Gets the current date formatted as 'YYYY-MM-DD' in Europe/Athens.
 */
export function getAthensCurrentDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Gets the timezone offset in minutes for Europe/Athens at a specific reference date.
 * Positive value represents minutes ahead of UTC (e.g. +120 or +180).
 */
export function getAthensOffsetMinutes(refDate: Date): number {
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    timeZoneName: 'longOffset',
  }).formatToParts(refDate).find((part) => part.type === 'timeZoneName')?.value;
  if (offset === 'GMT') return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset ?? '');
  if (!match) throw new Error('Could not determine the Europe/Athens offset.');
  const [, sign, hours, minutes] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/**
 * Computes exact ISO timestamps for 00:00:00.000 to 23:59:59.999 in Europe/Athens
 * for any given date string 'YYYY-MM-DD' or for today if omitted.
 */
export function getAthensReportingWindow(dateStr?: string): AthensReportingWindow {
  const targetDateStr = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? dateStr
    : getAthensCurrentDateString();

  const [year, month, day] = targetDateStr.split('-').map(Number);

  // Check each local midnight separately because the offset can change during the day.
  const startDayMs = Date.UTC(year, month - 1, day);
  const nextDayMs = Date.UTC(year, month - 1, day + 1);
  const localMidnightUtc = (utcDayMs: number) => {
    const initialOffset = getAthensOffsetMinutes(new Date(utcDayMs));
    const candidate = utcDayMs - initialOffset * 60_000;
    return utcDayMs - getAthensOffsetMinutes(new Date(candidate)) * 60_000;
  };
  const startUtcMs = localMidnightUtc(startDayMs);
  const endUtcMs = localMidnightUtc(nextDayMs) - 1;
  const offsetMinutes = (startDayMs - startUtcMs) / 60_000;

  return {
    dateStr: targetDateStr,
    windowStartIso: new Date(startUtcMs).toISOString(),
    windowEndIso: new Date(endUtcMs).toISOString(),
    timezone: 'Europe/Athens',
    offsetMinutes,
  };
}

/**
 * Checks whether an article timestamp falls within the Europe/Athens reporting window.
 */
export function isWithinAthensReportingWindow(
  isoTimestamp: string,
  windowStartIso: string,
  windowEndIso: string
): boolean {
  if (!isoTimestamp) return false;
  const time = new Date(isoTimestamp).getTime();
  if (isNaN(time)) return false;

  const start = new Date(windowStartIso).getTime();
  const end = new Date(windowEndIso).getTime();

  return time >= start && time <= end;
}

/**
 * Human-friendly Greek and English date labels.
 */
export function formatAthensDateDisplay(dateStr: string): { en: string; el: string } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const en = dateObj.toLocaleDateString('en-GB', {
    timeZone: 'Europe/Athens',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const el = dateObj.toLocaleDateString('el-GR', {
    timeZone: 'Europe/Athens',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return { en, el };
}
