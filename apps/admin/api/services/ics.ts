// Generates a minimal, valid iCalendar (.ics) file for an approved leave
// request — attached to the decision email so it one-click-imports into
// Google Calendar, Outlook, Apple Calendar, or anything else that reads the
// standard format. This is deliberately NOT live OAuth calendar sync (that
// would need the employee to grant this app write access to their actual
// Google/Outlook calendar via a registered OAuth app with client secrets
// this deployment doesn't have) — an .ics attachment needs no external
// credentials, no consent flow, and works identically across every
// calendar provider.
function icsDateStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// All-day event spanning [startDate, endDate] inclusive — DTEND in the
// iCalendar all-day convention is EXCLUSIVE, so it's the day after endDate.
function icsDateOnly(dateStr: string, addDays = 0): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function buildLeaveIcs(params: {
  uid: string;
  summary: string;
  description: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Smart Teams//Leave Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${icsDateStamp(new Date())}`,
    `DTSTART;VALUE=DATE:${icsDateOnly(params.startDate)}`,
    `DTEND;VALUE=DATE:${icsDateOnly(params.endDate, 1)}`,
    `SUMMARY:${escapeIcsText(params.summary)}`,
    `DESCRIPTION:${escapeIcsText(params.description)}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
