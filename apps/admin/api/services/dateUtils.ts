// Local calendar date, NOT toISOString().slice(0, 10) — that converts to UTC
// first, so for any timezone ahead of UTC (e.g. IST, +5:30) local midnight at
// the start of a day serializes to the PREVIOUS day's date (local midnight
// Monday IST = 18:30 UTC Sunday). Every "what day is this" computation on the
// server must use the same local-day key that the check-in/checkout
// `todayStart.setHours(0,0,0,0)` boundary already uses, or a lookup keyed by
// this can disagree with the row that boundary actually matched.
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
