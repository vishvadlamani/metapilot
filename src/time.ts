const DAY_MS = 24 * 60 * 60 * 1000;

export type Window = { since: Date; until: Date };

/**
 * Returns a date window of `days` days ending `endOffsetDays` ago.
 * Example: nDayWindow(now, 7, 1) → last 7 days ending yesterday.
 *          nDayWindow(now, 7, 8) → the 7 days before that (days -14..-8).
 */
export function nDayWindow(now: Date, days: number, endOffsetDays = 1): Window {
  const t = now.getTime();
  const until = new Date(t - endOffsetDays * DAY_MS);
  const since = new Date(t - (endOffsetDays + days - 1) * DAY_MS);
  return { since, until };
}

export function fmtYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
