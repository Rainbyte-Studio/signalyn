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
  const athensTimeStr = refDate.toLocaleString('en-US', { timeZone: 'Europe/Athens' });
  const utcTimeStr = refDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const diffMs = new Date(athensTimeStr).getTime() - new Date(utcTimeStr).getTime();
  return Math.round(diffMs / 60000);
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

  // Approximate noon UTC on that day to safely sample the Athens DST offset
  const middayUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetMinutes = getAthensOffsetMinutes(middayUtc);

  // 00:00:00 Athens local time in UTC:
  // Athens = UTC + offsetMinutes => UTC = Athens - offsetMinutes
  const startUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMinutes * 60 * 1000;
  const endUtcMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMinutes * 60 * 1000;

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
