import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import jsQR from 'jsqr';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';

type Step = 'scanning' | 'validating' | 'face' | 'gps' | 'submitting' | 'success' | 'error';

interface RequiredChecks {
  face: boolean;
  gps: boolean;
  wifi: boolean;
  deviceTrust: boolean;
}

// Extracts the token from a scanned QR's deep-link URL
// (https://.../qr/{token}) — falls back to treating the raw scanned text as
// the token itself, so a QR that somehow encodes a bare token still works.
function extractTokenFromScan(scanned: string): string {
  try {
    const url = new URL(scanned);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || scanned;
  } catch {
    return scanned;
  }
}

// One consolidated employee-side QR flow: scan (in-app rear camera, or a
// token already supplied via the /qr/:token deep link) -> validate ->
// whatever this tenant's QR policy requires (face / GPS / Wi-Fi / device
// trust) -> mark-from-qr. Deliberately a standalone page (not threaded into
// EmployeeAttendance.tsx's already-large state machine) — it duplicates a
// small amount of camera-capture/face-verification logic rather than
// risking that existing, already-shipped flow.
export default function QrScan({ user }: { user: User }) {
  const navigate = useNavigate();
  const params = useParams<{ token?: string }>();
  const token = localStorage.getItem('auth_token');

  const [step, setStep] = useState<Step>(params.token ? 'validating' : 'scanning');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [requiredChecks, setRequiredChecks] = useState<RequiredChecks | null>(null);
  const [scanPassToken, setScanPassToken] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState('Starting camera...');
  const [challenge, setChallenge] = useState<string[]>([]);
  const [faceToken, setFaceToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const getDeviceFingerprint = () => {
    let deviceId = localStorage.getItem('device_fingerprint');
    if (!deviceId) {
      deviceId = 'device_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('device_fingerprint', deviceId);
    }
    return deviceId;
  };

  const stopCamera = useCallback(() => {
    if (scanFrameRef.current) cancelAnimationFrame(scanFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // --- STEP: scan (rear camera + jsQR decode loop) ---
  useEffect(() => {
    if (step !== 'scanning') return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        const tick = () => {
          if (cancelled) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
              if (code && code.data) {
                stopCamera();
                const extracted = extractTokenFromScan(code.data);
                setStep('validating');
                validateToken(extracted);
                return;
              }
            }
          }
          scanFrameRef.current = requestAnimationFrame(tick);
        };
        scanFrameRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error(err);
        setError('Camera access denied or unavailable.');
        setStep('error');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // --- STEP: validate (token from either the camera scan above, or
  // already supplied via the /qr/:token deep link) ---
  const validateToken = useCallback(async (rawToken: string) => {
    setError('');
    try {
      const res = await fetch('/api/qr/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ token: rawToken, deviceId: getDeviceFingerprint() })
      });
      const data = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          QR_EXPIRED: 'This QR code has expired. Please scan the current one.',
          QR_ALREADY_USED: 'This QR code has already been used. Please scan the current one.',
          SESSION_CLOSED: 'This QR Attendance session has ended.',
          QR_INVALID: 'This QR code is not valid.',
        };
        throw new Error(messages[data.code] || data.error || 'Failed to validate QR code.');
      }
      setScanPassToken(data.scanPassToken);
      setRequiredChecks(data.requiredChecks);
      if (data.requiredChecks.face) {
        setStep('face');
      } else if (data.requiredChecks.gps) {
        setStep('gps');
      } else {
        submitAttendance(data.scanPassToken, data.requiredChecks, null, null, null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to validate QR code.');
      setStep('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (params.token && step === 'validating') {
      validateToken(params.token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  // --- STEP: face (reuses the existing, unchanged challenge/verify-face
  // endpoints — same camera-capture pattern as EmployeeAttendance.tsx) ---
  useEffect(() => {
    if (step !== 'face') return;
    let cancelled = false;

    (async () => {
      try {
        const challengeRes = await fetch('/api/attendance/challenge', { headers: { 'Authorization': `Bearer ${token}` } });
        const challengeData = await challengeRes.json();
        if (!cancelled) setChallenge(challengeData.challenge || []);

        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setFaceStatus('Ready to scan');
      } catch (err) {
        console.error(err);
        setError('Camera access denied.');
        setStep('error');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleFaceScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setLoading(true);
    setError('');
    try {
      setFaceStatus('Hold steady — capturing a few frames...');
      const frames: string[] = [];
      for (let i = 0; i < 8; i++) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx && video.videoWidth) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL('image/jpeg', 0.85));
        }
        await new Promise(resolve => setTimeout(resolve, 260));
      }
      if (frames.length < 4) throw new Error('Could not capture enough frames from the camera. Please try again.');

      setFaceStatus('Verifying identity and liveness...');
      const res = await fetch('/api/attendance/verify-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ images: frames })
      });
      const data = await res.json();
      if (!res.ok || !data.passed) throw new Error(data.error || 'Face verification failed.');

      stopCamera();
      setFaceToken(data.token);
      if (requiredChecks?.gps) {
        setStep('gps');
      } else {
        submitAttendance(scanPassToken, requiredChecks, data.token, null, null);
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
      setFaceStatus('Ready to scan');
    } finally {
      setLoading(false);
    }
  };

  // --- STEP: gps ---
  useEffect(() => {
    if (step !== 'gps') return;
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device.');
      setStep('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        submitAttendance(scanPassToken, requiredChecks, faceToken, position.coords.latitude, position.coords.longitude);
      },
      (err) => {
        setError(err.code === err.TIMEOUT
          ? 'Could not get a GPS fix in time. Move somewhere with a clearer signal and try again.'
          : 'GPS location access is required to mark attendance.');
        setStep('error');
      },
      // timeout so it can't hang forever on a weak signal; maximumAge lets a
      // recent fix return instantly instead of forcing a slow high-accuracy one.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // --- STEP: submit ---
  const submitAttendance = async (
    passToken: string | null,
    checks: RequiredChecks | null,
    faceTok: string | null,
    lat: number | null,
    lng: number | null
  ) => {
    setStep('submitting');
    setError('');
    try {
      const res = await fetch('/api/attendance/mark-from-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          scanPassToken: passToken,
          faceToken: faceTok,
          lat, lng,
          deviceId: getDeviceFingerprint(),
          clientTimestamp: new Date().toISOString(),
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to mark attendance.');
      setSuccess(data.log?.type === 'check_out' ? 'Checked out successfully!' : (data.pendingApproval ? 'Checked in — pending manager approval.' : 'Checked in successfully!'));
      setStep('success');
      setTimeout(() => navigate(user.isKycCompleted ? '/employee/home' : '/employee/attendance'), 1800);
    } catch (err: any) {
      setError(err.message || 'Failed to mark attendance.');
      setStep('error');
    }
  };

  const retry = () => {
    setError('');
    setScanPassToken(null);
    setFaceToken(null);
    setRequiredChecks(null);
    setStep('scanning');
  };

  return (
    <div className="min-h-screen premium-gradient-bg flex items-center justify-center p-6 font-sans relative overflow-hidden">
      <PageChrome fallbackHref="/employee/attendance" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full glass-card rounded-3xl p-8 relative z-10"
      >
        <div className="text-center mb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-gradient inline-block">QR Attendance</h1>
          <p className="text-sm text-[var(--color-premium-muted)] mt-2 font-medium">{user.name}</p>
        </div>

        {(step === 'scanning' || step === 'face') && (
          <div className="relative rounded-2xl overflow-hidden bg-[var(--color-premium-ink)] aspect-square mb-4 flex items-center justify-center border-2 border-[var(--color-premium-border)]">
            <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            {step === 'scanning' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-56 h-56 border-2 border-dashed border-[var(--color-premium-accent-2)]/60 rounded-2xl"></div>
              </div>
            )}
            {step === 'face' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-48 h-64 border-2 border-dashed border-[var(--color-premium-accent-2)]/60 rounded-[40px]"></div>
                <div className="scan-line"></div>
              </div>
            )}
          </div>
        )}

        {step === 'scanning' && (
          <p className="text-center text-xs font-bold text-[var(--color-premium-accent-2)] font-mono uppercase tracking-wider">
            Point your camera at the QR code
          </p>
        )}

        {step === 'validating' && (
          <div className="py-10 text-center space-y-4">
            <div className="w-10 h-10 mx-auto border-4 border-[var(--color-premium-accent)]/20 border-t-[var(--color-premium-accent)] rounded-full animate-spin"></div>
            <p className="text-xs font-bold text-[var(--color-premium-accent)] uppercase tracking-wider">Validating QR code...</p>
          </div>
        )}

        {step === 'face' && (
          <div className="space-y-4">
            {challenge.length > 0 && (
              <div className="p-3 bg-[var(--color-premium-accent-2-soft)] border border-[var(--color-premium-accent-2)]/30 rounded-xl text-center">
                <p className="text-xs text-[var(--color-premium-ink)] font-medium">
                  Look at the camera and {challenge.join(', then ')}.
                </p>
              </div>
            )}
            <p className="text-center text-xs font-bold text-[var(--color-premium-accent-2)] font-mono uppercase tracking-wider">{faceStatus}</p>
            <button
              onClick={handleFaceScan}
              disabled={loading}
              className="w-full bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white rounded-xl py-4 font-bold text-sm uppercase tracking-wider transition-all disabled:opacity-40"
            >
              {loading ? 'Verifying...' : 'Scan & Verify'}
            </button>
          </div>
        )}

        {step === 'gps' && (
          <div className="py-10 text-center space-y-4">
            <div className="w-10 h-10 mx-auto border-4 border-[var(--color-premium-accent-2)]/20 border-t-[var(--color-premium-accent-2)] rounded-full animate-spin"></div>
            <p className="text-xs font-bold text-[var(--color-premium-accent-2)] uppercase tracking-wider">Requesting GPS lock...</p>
          </div>
        )}

        {step === 'submitting' && (
          <div className="py-10 text-center space-y-4">
            <div className="w-10 h-10 mx-auto border-4 border-[var(--color-premium-accent)]/20 border-t-[var(--color-premium-accent)] rounded-full animate-spin"></div>
            <p className="text-xs font-bold text-[var(--color-premium-accent)] uppercase tracking-wider">Recording attendance...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="bg-[var(--color-premium-accent-2-soft)] border border-[var(--color-premium-accent-2)]/30 p-8 rounded-2xl text-center space-y-3">
            <div className="w-16 h-16 mx-auto bg-[var(--color-premium-surface)] border border-[var(--color-premium-accent-2)] rounded-full flex items-center justify-center pulse-ring">
              <svg className="w-8 h-8 text-[var(--color-premium-accent-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--color-premium-accent-2)]">{success}</p>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-4">
            <div className="bg-[var(--color-premium-danger-soft)] text-[var(--color-premium-danger)] text-xs p-4 rounded-xl border border-[var(--color-premium-danger)]/20 font-medium text-center">
              ⚠️ {error}
            </div>
            <button
              onClick={retry}
              className="w-full bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-all"
            >
              Try Again
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
