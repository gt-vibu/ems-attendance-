/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dropdown-only time picker replacing the browser's native <input type="time">
// (the OS clock-face/scroll-wheel picker), for the same reasons as
// DateSelect.tsx — no OS-styled overlay, always legible, consistent
// everywhere. value/onChange use the same 'HH:MM' 24-hour string the native
// input did, so this drops in wherever that was used.

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,...,55

function parseValue(value: string): { hour12: number | ''; minute: number | ''; period: 'AM' | 'PM' | '' } {
  const m = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!m) return { hour12: '', minute: '', period: '' };
  const h24 = Number(m[1]);
  const minute = Number(m[2]);
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, period };
}

function formatValue(hour12: number | '', minute: number | '', period: 'AM' | 'PM' | ''): string {
  if (!hour12 || minute === '' || !period) return '';
  let h24 = hour12 % 12;
  if (period === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const selectClass = "flex-1 min-w-0 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-2.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]";

export default function TimeSelect({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const { hour12, minute, period } = parseValue(value);

  const setPart = (part: 'hour12' | 'minute' | 'period', v: number | 'AM' | 'PM' | '') => {
    const next = { hour12, minute, period, [part]: v };
    onChange(formatValue(next.hour12, next.minute, next.period));
  };

  return (
    <div className="flex gap-2" role="group" aria-label="Time">
      <select
        className={selectClass}
        value={hour12 || ''}
        onChange={(e) => setPart('hour12', e.target.value ? Number(e.target.value) : '')}
        required={required}
      >
        <option value="">Hour</option>
        {HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select
        className={selectClass}
        value={minute === '' ? '' : minute}
        onChange={(e) => setPart('minute', e.target.value === '' ? '' : Number(e.target.value))}
        required={required}
      >
        <option value="">Min</option>
        {MINUTES.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <select
        className={selectClass}
        value={period}
        onChange={(e) => setPart('period', e.target.value as 'AM' | 'PM' | '')}
        required={required}
      >
        <option value="">--</option>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
