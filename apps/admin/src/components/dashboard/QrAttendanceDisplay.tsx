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
    return <div className="text-center py-16 text-sm text-[var(--color-nexus-muted)]">Loading QR Attendance...</div>;
  }

  return (
    <div
      ref={containerRef}
      className={`nexus-card rounded-3xl ${isFullscreen ? 'fixed inset-0 z-50 flex flex-col items-center justify-center rounded-none' : 'p-8'}`}
    >
      {error && (
        <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-xl mb-4 border border-[var(--color-nexus-error)]/20 font-medium max-w-md mx-auto">{error}</div>
      )}

      {!session ? (
        <div className="text-center py-12 max-w-sm mx-auto">
          <h2 className="text-lg font-bold text-gradient font-sans mb-2">Start QR Attendance Session</h2>
          <p className="text-xs text-[var(--color-nexus-muted)] mb-6">Displays a rotating QR code employees can scan with their phone to mark attendance.</p>
          <label className="block text-xs font-semibold text-[var(--color-nexus-ink)] mb-1.5 uppercase tracking-wider">Rotation Interval</label>
          <select
            value={rotationSeconds}
            onChange={e => setRotationSeconds(parseInt(e.target.value, 10))}
            className="w-full px-4 py-3 bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--color-nexus-primary)]"
          >
            {ROTATION_OPTIONS.map(s => <option key={s} value={s}>{s} seconds</option>)}
          </select>
          <button
            onClick={handleStart}
            disabled={starting}
            className="w-full bg-[var(--color-nexus-primary)] text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider hover:bg-[var(--color-nexus-primary-hover)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_4px_15px_rgba(37,99,235,0.3)]"
          >
            <Play size={14} />
            {starting ? 'Starting...' : 'Start Session'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 bg-[color:var(--color-nexus-success-text)]/10 text-[var(--color-nexus-success-text)] rounded-full text-[10px] font-bold uppercase tracking-wider border border-[color:var(--color-nexus-success-text)]/20 pulse-ring">
              Session Active
            </span>
            <button onClick={toggleFullscreen} className="text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] transition-colors" aria-label="Toggle fullscreen">
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>

          {qrImageUrl && (
            <div className="relative p-4 rounded-3xl bg-white border-2 border-[var(--color-nexus-primary-fixed)] shadow-[0_10px_40px_-12px_rgba(37,99,235,0.35)]">
              <img src={qrImageUrl} alt="Scan to mark attendance" className={isFullscreen ? 'w-[70vmin] h-[70vmin]' : 'w-72 h-72 md:w-96 md:h-96'} />
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[var(--color-nexus-primary)] text-white text-xs font-mono font-bold px-4 py-1.5 rounded-full shadow-lg">
                {secondsLeft}s
              </div>
            </div>
          )}

          <p className="text-xs text-[var(--color-nexus-muted)] mt-6 mb-4">Refreshes automatically every {session.rotationSeconds}s — no need to reload.</p>

          <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-6">
            <div className="nexus-card  rounded-xl p-3">
              <span className="block text-[9px] text-[var(--color-nexus-muted)] uppercase font-bold tracking-wider">Scans</span>
              <span className="text-xl font-black text-[var(--color-nexus-ink)]">{counts.scansCount}</span>
            </div>
            <div className="rounded-xl p-3 border border-[color:var(--color-nexus-success-text)]/20 bg-[color:var(--color-nexus-success-text)]/10">
              <span className="block text-[9px] text-[var(--color-nexus-success-text)] uppercase font-bold tracking-wider">Success</span>
              <span className="text-xl font-black text-[var(--color-nexus-success-text)]">{counts.successCount}</span>
            </div>
            <div className="rounded-xl p-3 border border-[var(--color-nexus-error)]/20 bg-[var(--color-nexus-error-soft)]">
              <span className="block text-[9px] text-[var(--color-nexus-error)] uppercase font-bold tracking-wider">Failed</span>
              <span className="text-xl font-black text-[var(--color-nexus-error)]">{counts.failCount}</span>
            </div>
          </div>

          <button
            onClick={handleStop}
            className="bg-[var(--color-nexus-error-soft)] hover:brightness-95 text-[var(--color-nexus-error)] font-bold text-xs uppercase tracking-wider py-2.5 px-6 rounded-xl transition-all flex items-center gap-2"
          >
            <Square size={12} />
            Stop Session
          </button>
        </div>
      )}
    </div>
  );
}
