/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dropdown-only time picker replacing the browser's native <input type="time">
// (the OS clock-face/scroll-wheel picker), for the same reasons as
// DateSelect.tsx — no OS-styled overlay, always legible, consistent
// everywhere. value/onChange use the same 'HH:MM' 24-hour string the native
// input did, so this drops in wherever that was used.

import { useState, useEffect } from 'react';

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
  let h24 = Number(hour12) % 12;
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
  const parsed = parseValue(value);
  const [internalHour, setInternalHour] = useState<number | ''>(parsed.hour12);
  const [internalMin, setInternalMin] = useState<number | ''>(parsed.minute);
  const [internalPeriod, setInternalPeriod] = useState<'AM' | 'PM' | ''>(parsed.period);

  useEffect(() => {
    const p = parseValue(value);
    setInternalHour(p.hour12);
    setInternalMin(p.minute);
    setInternalPeriod(p.period);
  }, [value]);

  const setPart = (part: 'hour12' | 'minute' | 'period', v: number | 'AM' | 'PM' | '') => {
    const now = new Date();
    let nextHour = part === 'hour12' ? (v as number | '') : internalHour;
    let nextMin = part === 'minute' ? (v as number | '') : internalMin;
    let nextPeriod = part === 'period' ? (v as 'AM' | 'PM' | '') : internalPeriod;

    if (v !== '') {
      if (!nextHour) {
        const h24 = now.getHours();
        nextHour = h24 % 12 || 12;
      }
      if (nextMin === '') {
        nextMin = Math.floor(now.getMinutes() / 5) * 5;
      }
      if (!nextPeriod) {
        nextPeriod = now.getHours() >= 12 ? 'PM' : 'AM';
      }
    }

    setInternalHour(nextHour);
    setInternalMin(nextMin);
    setInternalPeriod(nextPeriod);

    onChange(formatValue(nextHour, nextMin, nextPeriod));
  };

  return (
    <div className="flex gap-2" role="group" aria-label="Time">
      <select
        className={selectClass}
        value={internalHour}
        onChange={(e) => setPart('hour12', e.target.value ? Number(e.target.value) : '')}
        required={required}
      >
        <option value="">Hour</option>
        {HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select
        className={selectClass}
        value={internalMin}
        onChange={(e) => setPart('minute', e.target.value === '' ? '' : Number(e.target.value))}
        required={required}
      >
        <option value="">Min</option>
        {MINUTES.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <select
        className={selectClass}
        value={internalPeriod}
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
