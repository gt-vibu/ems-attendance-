import { useState } from 'react';

// Holiday Calendar — visible to everyone in the tenant, editable behind
// holiday.manage. Extracted verbatim from Dashboard.tsx.
export function useHolidays(
  token: string | null,
  setLoading: (v: boolean) => void,
  setError: (v: string) => void,
) {
  const [holidaysList, setHolidaysList] = useState<any[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');

  const fetchHolidays = async () => {
    try {
      const res = await fetch('/api/tenant/holidays', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.holidays) setHolidaysList(data.holidays);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayDate || !newHolidayName) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/holidays', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ date: newHolidayDate, name: newHolidayName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add holiday');
      setNewHolidayDate('');
      setNewHolidayName('');
      fetchHolidays();
    } catch (err: any) {
      setError(err.message || 'Failed to add holiday');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteHoliday = async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/holidays/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      fetchHolidays();
    } catch (err: any) {
      setError(err.message || 'Failed to remove holiday');
    } finally {
      setLoading(false);
    }
  };

  return {
    holidaysList,
    newHolidayDate, setNewHolidayDate,
    newHolidayName, setNewHolidayName,
    fetchHolidays,
    handleAddHoliday,
    handleDeleteHoliday,
  };
}
