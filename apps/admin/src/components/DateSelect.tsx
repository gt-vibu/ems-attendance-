/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dropdown-only date picker replacing the browser's native <input type="date">
// — the OS date picker (Android's especially) shows no label/placeholder text
// when empty, reads as an unlabeled blank field, and its styling can't be
// controlled at all. Three plain <select> elements (day/month/year) give a
// legible, consistently-styled control that always shows what it is, works
// identically on every platform, and never opens an OS overlay that can
// visually clash with or get cut off by the surrounding page.
//
import { useState, useEffect } from 'react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(year: number, month1based: number): number {
  return new Date(year, month1based, 0).getDate();
}

function parseValue(value: string): { year: number | ''; month: number | ''; day: number | '' } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return { year: '', month: '', day: '' };
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function formatValue(year: number | '', month: number | '', day: number | ''): string {
  if (!year || !month || !day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const selectClass = "flex-1 min-w-0 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-2.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]";

export default function DateSelect({
  value,
  onChange,
  minYear = new Date().getFullYear() - 3,
  maxYear = new Date().getFullYear() + 1,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  minYear?: number;
  maxYear?: number;
  required?: boolean;
}) {
  const parsed = parseValue(value);
  const [internalYear, setInternalYear] = useState<number | ''>(parsed.year);
  const [internalMonth, setInternalMonth] = useState<number | ''>(parsed.month);
  const [internalDay, setInternalDay] = useState<number | ''>(parsed.day);

  useEffect(() => {
    const p = parseValue(value);
    setInternalYear(p.year);
    setInternalMonth(p.month);
    setInternalDay(p.day);
  }, [value]);

  const maxDay = internalYear && internalMonth ? daysInMonth(Number(internalYear), Number(internalMonth)) : 31;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);

  const setPart = (part: 'year' | 'month' | 'day', v: number | '') => {
    const today = new Date();
    let nextYear = part === 'year' ? v : internalYear;
    let nextMonth = part === 'month' ? v : internalMonth;
    let nextDay = part === 'day' ? v : internalDay;

    if (v !== '') {
      if (!nextYear) nextYear = today.getFullYear();
      if (!nextMonth) nextMonth = today.getMonth() + 1;
      if (!nextDay) nextDay = today.getDate();
    }

    if (nextYear && nextMonth && nextDay) {
      const cap = daysInMonth(Number(nextYear), Number(nextMonth));
      if (Number(nextDay) > cap) nextDay = cap;
    }

    setInternalYear(nextYear);
    setInternalMonth(nextMonth);
    setInternalDay(nextDay);

    onChange(formatValue(nextYear, nextMonth, nextDay));
  };

  return (
    <div className="flex gap-2" role="group" aria-label="Date">
      <select
        className={selectClass}
        value={internalDay}
        onChange={(e) => setPart('day', e.target.value ? Number(e.target.value) : '')}
        required={required}
      >
        <option value="">Day</option>
        {days.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select
        className={`${selectClass} flex-[1.4]`}
        value={internalMonth}
        onChange={(e) => setPart('month', e.target.value ? Number(e.target.value) : '')}
        required={required}
      >
        <option value="">Month</option>
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select
        className={selectClass}
        value={internalYear}
        onChange={(e) => setPart('year', e.target.value ? Number(e.target.value) : '')}
        required={required}
      >
        <option value="">Year</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
