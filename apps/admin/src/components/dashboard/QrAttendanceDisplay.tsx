import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { Maximize2, Minimize2, Square, Play } from 'lucide-react';

const ROTATION_OPTIONS = [15, 30, 60, 120];

interface QrSession {
  id: number;
  status: 'active' | 'closed';
  rotationSeconds: number;
}

export default function QrAttendanceDisplay() {
  const token = localStorage.getItem('auth_token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  const [session, setSession] = useState<QrSession | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [counts, setCounts] = useState({ scansCount: 0, successCount: 0, failCount: 0, pendingCount: 0 });
  const [qrImageUrl, setQrImageUrl] = useState<string>('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [rotationSeconds, setRotationSeconds] = useState(30);
  const [error, setError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const deepLinkFor = (t: string) => `${window.location.origin}/qr/${t}`;

  const renderQr = useCallback(async (t: string) => {
    try {
      const url = await QRCode.toDataURL(deepLinkFor(t), { width: 480, margin: 2, color: { dark: '#1B1530', light: '#FFFFFF' } });
      setQrImageUrl(url);
    } catch (err) {
      console.error('Failed to render QR code', err);
    }
  }, []);

  const fetchCurrent = useCallback(async () => {
    try {
      const res = await fetch('/api/qr/current', { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load QR session');
        return;
      }
      if (!data.session) {
        setSession(null);
        setQrToken(null);
        return;
      }
      setSession(data.session);
      setExpiresAt(data.expiresAt);
      setCounts({ scansCount: data.scansCount, successCount: data.successCount, failCount: data.failCount, pendingCount: data.pendingCount });
      if (data.token !== qrToken) {
        setQrToken(data.token);
        await renderQr(data.token);
      }
      setError('');
    } catch (err) {
      console.error(err);
      setError('Network error — retrying...');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken, renderQr]);

  useEffect(() => {
    fetchCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll frequently enough to catch a rotation quickly without hammering
  // the server — 2s is responsive even for the shortest (15s) rotation option.
  useEffect(() => {
    if (session?.status === 'active') {
      pollRef.current = setInterval(fetchCurrent, 2000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [session?.status, fetchCurrent]);

  // Local 1s countdown between polls, purely cosmetic — the backend poll
  // above is the actual source of truth for when a new code has rotated in.
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => setSecondsLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    update();
    tickRef.current = setInterval(update, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [expiresAt]);

  const handleStart = async () => {
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/api/qr/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ rotationSeconds })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start QR session');
      setSession(data.session);
      setExpiresAt(data.expiresAt);
      setCounts({ scansCount: data.scansCount, successCount: data.successCount, failCount: data.failCount, pendingCount: data.pendingCount });
      setQrToken(data.token);
      await renderQr(data.token);
    } catch (err: any) {
      setError(err.message || 'Failed to start QR session');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!session) return;
    try {
      await fetch('/api/qr/session/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sessionId: session.id })
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSession(null);
      setQrToken(null);
      if (pollRef.current) clearInterval(pollRef.current);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (loading) {
    return <div className="text-center py-16 text-sm text-slate-400">Loading QR Attendance...</div>;
  }

  return (
    <div
      ref={containerRef}
      className={`bg-white rounded-3xl border border-slate-200 shadow-sm ${isFullscreen ? 'fixed inset-0 z-50 flex flex-col items-center justify-center rounded-none' : 'p-8'}`}
    >
      {error && (
        <div className="bg-red-50 text-red-600 text-xs p-3 rounded-xl mb-4 border border-red-100 font-medium max-w-md mx-auto">{error}</div>
      )}

      {!session ? (
        <div className="text-center py-12 max-w-sm mx-auto">
          <h2 className="text-lg font-bold text-slate-900 font-display mb-2">Start QR Attendance Session</h2>
          <p className="text-xs text-slate-500 mb-6">Displays a rotating QR code employees can scan with their phone to mark attendance.</p>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">Rotation Interval</label>
          <select
            value={rotationSeconds}
            onChange={e => setRotationSeconds(parseInt(e.target.value, 10))}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
          >
            {ROTATION_OPTIONS.map(s => <option key={s} value={s}>{s} seconds</option>)}
          </select>
          <button
            onClick={handleStart}
            disabled={starting}
            className="w-full bg-slate-900 text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Play size={14} />
            {starting ? 'Starting...' : 'Start Session'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
              Session Active
            </span>
            <button onClick={toggleFullscreen} className="text-slate-400 hover:text-slate-700 transition-colors" aria-label="Toggle fullscreen">
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>

          {qrImageUrl && (
            <div className="relative">
              <img src={qrImageUrl} alt="Scan to mark attendance" className={isFullscreen ? 'w-[70vmin] h-[70vmin]' : 'w-72 h-72 md:w-96 md:h-96'} />
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-mono font-bold px-4 py-1.5 rounded-full shadow-lg">
                {secondsLeft}s
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400 mt-6 mb-4">Refreshes automatically every {session.rotationSeconds}s — no need to reload.</p>

          <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-6">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <span className="block text-[9px] text-slate-400 uppercase font-bold tracking-wider">Scans</span>
              <span className="text-xl font-black text-slate-900">{counts.scansCount}</span>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
              <span className="block text-[9px] text-emerald-600 uppercase font-bold tracking-wider">Success</span>
              <span className="text-xl font-black text-emerald-700">{counts.successCount}</span>
            </div>
            <div className="bg-rose-50 rounded-xl p-3 border border-rose-100">
              <span className="block text-[9px] text-rose-600 uppercase font-bold tracking-wider">Failed</span>
              <span className="text-xl font-black text-rose-700">{counts.failCount}</span>
            </div>
          </div>

          <button
            onClick={handleStop}
            className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs uppercase tracking-wider py-2.5 px-6 rounded-xl transition-colors flex items-center gap-2"
          >
            <Square size={12} />
            Stop Session
          </button>
        </div>
      )}
    </div>
  );
}
