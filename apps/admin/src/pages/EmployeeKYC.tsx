import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import FloatingOrbs from '../components/FloatingOrbs';

// All face detection/recognition happens server-side, in a separate Python
// microservice (services/face-service) that the Node backend calls. This
// page's only job is to walk the employee through 8 guided poses and
// capture a short burst of plain JPEG frames per pose — there is no ML
// model to download or run in the browser at all, which is what actually
// makes this work reliably on any device (old phones, low-end browsers, no
// WebGL) rather than just in principle.
//
// Each pose is a real check, not decoration: the backend rejects
// enrollment (per-step, via `failedActions`) if a pose wasn't actually
// detected in its burst — e.g. "turn_left" frames that never actually
// turned. This is the same guided-pose vocabulary the daily attendance
// liveness challenge is drawn from.
const KYC_STEPS: { key: string; title: string; instruction: string }[] = [
  { key: 'look_center', title: 'Look straight ahead', instruction: 'Center your face in the frame and look directly at the camera.' },
  { key: 'turn_left', title: 'Turn left', instruction: 'Slowly turn your head to your left.' },
  { key: 'turn_right', title: 'Turn right', instruction: 'Slowly turn your head to your right.' },
  { key: 'look_up', title: 'Look up', instruction: 'Tilt your head up slightly.' },
  { key: 'look_down', title: 'Look down', instruction: 'Tilt your head down slightly.' },
  { key: 'smile', title: 'Smile', instruction: 'Give a natural smile.' },
  { key: 'open_mouth', title: 'Open your mouth', instruction: 'Open your mouth, like starting to say "ah".' },
  { key: 'blink', title: 'Blink', instruction: 'Blink a couple of times at a normal pace.' },
];

const FRAMES_PER_STEP = 6;
const CAPTURE_INTERVAL_MS = 350;
const GET_READY_MS = 1100;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function EmployeeKYC({ user, updateSession }: { user: User, updateSession: (u: User) => void }) {
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<'get_ready' | 'capturing' | 'done'>('get_ready');
  const [stepProgress, setStepProgress] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [redoActions, setRedoActions] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const actionsRef = useRef<Record<string, string[]>>({});
  const cancelledRef = useRef(false);
  // Lets the "Next Pose" button skip the short auto-advance pause between
  // steps instead of waiting out the timer.
  const advanceResolverRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // React StrictMode (see main.tsx) double-invokes this effect in dev:
    // mount -> cleanup -> mount again. The cleanup below sets this flag so
    // the *first* mount's in-flight capture loop knows to stop — reset it
    // here so the real, second mount doesn't inherit a stale "cancelled"
    // state and silently stall forever on the first "get ready" step.
    cancelledRef.current = false;
    startCamera();
    return () => {
      cancelledRef.current = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolves either when the timeout elapses or the "Next Pose" button is
  // clicked, whichever comes first — gives a clear, tappable confirmation
  // between poses without losing the fully-automatic happy path.
  const waitForAdvance = (timeoutMs: number) => {
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        advanceResolverRef.current = null;
        resolve();
      };
      advanceResolverRef.current = finish;
      setTimeout(finish, timeoutMs);
    });
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraReady(true);
      runSequence(KYC_STEPS.map((_, i) => i));
    } catch (err) {
      console.error(err);
      setError('Camera access denied or unavailable.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  };

  // Snapshot the current video frame to a compressed JPEG data URL. No face
  // detection happens here — that's the backend's job now.
  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video.videoWidth || !video.videoHeight) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  const captureStep = async (idx: number) => {
    const step = KYC_STEPS[idx];
    actionsRef.current[step.key] = [];
    setStepIndex(idx);
    setPhase('get_ready');
    setStepProgress(0);
    await delay(GET_READY_MS);
    if (cancelledRef.current) return;

    setPhase('capturing');
    while (actionsRef.current[step.key].length < FRAMES_PER_STEP) {
      if (cancelledRef.current) return;
      const frame = captureFrame();
      if (frame) {
        actionsRef.current[step.key].push(frame);
        setStepProgress(actionsRef.current[step.key].length);
      }
      await delay(CAPTURE_INTERVAL_MS);
    }
    if (cancelledRef.current) return;
    setCompletedSteps(prev => new Set(prev).add(step.key));

    // Brief, visible "captured" confirmation between poses — advances on
    // its own after a moment, or immediately if the employee taps Next.
    setPhase('done');
    await waitForAdvance(900);
  };

  const runSequence = async (indices: number[]) => {
    for (const idx of indices) {
      await captureStep(idx);
      if (cancelledRef.current) return;
    }
    submitKYC();
  };

  const submitKYC = async () => {
    setSubmitting(true);
    setError('');
    try {
      const deviceId = localStorage.getItem('device_fingerprint') || crypto.randomUUID();
      localStorage.setItem('device_fingerprint', deviceId);

      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/kyc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          actions: actionsRef.current,
          deviceId
        })
      });

      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.failedActions) && data.failedActions.length > 0) {
          setError(data.error || 'A few steps could not be confirmed. Please redo them.');
          setRedoActions(data.failedActions);
          setSubmitting(false);
          return;
        }
        throw new Error(data.error || 'Failed to submit KYC. Please try again.');
      }

      updateSession(data.user);
      setTimeout(() => {
        navigate('/employee/attendance');
      }, 800);
    } catch (err: any) {
      setError(err.message || 'Failed to submit KYC. Please try again.');
      setSubmitting(false);
    }
  };

  const redoFailedSteps = () => {
    const indices = redoActions
      .map(key => KYC_STEPS.findIndex(s => s.key === key))
      .filter(i => i >= 0)
      .sort((a, b) => a - b);
    setRedoActions([]);
    setError('');
    runSequence(indices);
  };

  const currentStep = KYC_STEPS[stepIndex];
  const doneCount = completedSteps.size;
  const overallProgress = Math.round((doneCount / KYC_STEPS.length) * 100);

  return (
    <div className="min-h-screen premium-mesh-bg flex items-center justify-center p-6 font-sans relative overflow-hidden">
      {/* No WebGL AuroraField here, deliberately: this page runs a live
          camera feed for face capture at the same time — layering a
          Three.js/WebGL canvas underneath would compete for GPU/CPU with
          the camera and liveness capture on lower-end phones. FloatingOrbs
          (pure CSS) gives the same vibrant floating ambience for near-zero
          cost. */}
      <FloatingOrbs />
      <PageChrome fallbackHref="/employee/login" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-xl w-full glass-card rounded-3xl p-8 relative z-10"
      >
        <div className="text-center mb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-premium-ink)]">Biometric KYC Enrollment</h1>
          <p className="text-sm text-[var(--color-premium-muted)] mt-2 font-medium">Follow each prompt so we can register your face for secure attendance</p>
        </div>

        {error && (
          <div className="bg-[var(--color-premium-danger-soft)] text-[var(--color-premium-danger)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-premium-danger)]/20 font-medium">
            {error}
            {redoActions.length > 0 && (
              <button
                onClick={redoFailedSteps}
                className="block mt-2 font-semibold underline underline-offset-2"
              >
                Redo {redoActions.length === 1 ? 'that step' : 'those steps'}
              </button>
            )}
          </div>
        )}

        <div className="relative rounded-2xl overflow-hidden bg-[var(--color-premium-ink)] aspect-video mb-4 flex items-center justify-center border-4 border-[var(--color-premium-border)]">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-48 h-64 border-2 border-dashed border-[var(--color-premium-accent-2)]/60 rounded-[40px]"></div>
          </div>

          {!cameraReady && !error && (
            <div className="absolute inset-0 bg-[var(--color-premium-ink)]/80 flex items-center justify-center text-white/70 text-xs font-medium">
              Starting camera...
            </div>
          )}

          {cameraReady && redoActions.length === 0 && (
            <div className="absolute bottom-3 left-3 right-3 bg-[var(--color-premium-ink)]/90 border border-white/10 backdrop-blur-md py-2.5 px-4 rounded-xl text-center">
              {phase === 'done' ? (
                <>
                  <p className="font-mono text-[9px] tracking-widest uppercase font-extrabold text-[var(--color-premium-accent-2)] mb-0.5">
                    ✓ Captured
                  </p>
                  <h5 className="font-sans font-bold text-sm tracking-tight text-white">
                    {currentStep?.title}
                  </h5>
                  <button
                    onClick={() => advanceResolverRef.current?.()}
                    className="mt-2 w-full bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white text-xs font-bold uppercase tracking-wider py-2 rounded-lg transition-all cursor-pointer"
                  >
                    {stepIndex === KYC_STEPS.length - 1 ? 'Finish Enrollment' : `Next: ${KYC_STEPS[stepIndex + 1]?.title}`}
                  </button>
                </>
              ) : (
                <>
                  <p className={`font-mono text-[9px] tracking-widest uppercase font-extrabold text-[var(--color-premium-accent-2)] mb-0.5 inline-block rounded-full px-1 ${phase === 'capturing' ? 'pulse-ring' : ''}`}>
                    {phase === 'get_ready' ? 'Get ready' : `Capturing ${stepProgress}/${FRAMES_PER_STEP}`}
                  </p>
                  <h5 className="font-sans font-bold text-sm tracking-tight text-white">
                    {currentStep?.title}
                  </h5>
                  <p className="text-[11px] text-white/60 mt-0.5">{currentStep?.instruction}</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {KYC_STEPS.map((step, i) => (
            <div
              key={step.key}
              title={step.title}
              className={`h-2 rounded-full transition-all duration-300 ${
                completedSteps.has(step.key)
                  ? 'w-2 bg-[var(--color-premium-accent-2)]'
                  : i === stepIndex
                    ? 'w-5 bg-[var(--color-premium-accent)]'
                    : 'w-2 bg-[var(--color-premium-border)]'
              }`}
            />
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex justify-between text-xs font-semibold text-[var(--color-premium-muted)] uppercase tracking-wider">
            <span>Progress</span>
            <span>{doneCount}/{KYC_STEPS.length} steps</span>
          </div>
          <div className="w-full bg-[var(--color-premium-surface-alt)] rounded-full h-2">
            <div
              className="bg-[var(--color-premium-accent-2)] h-2 rounded-full transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            ></div>
          </div>
          <p className="text-center text-sm font-medium text-[var(--color-premium-ink)]">
            {submitting ? 'Submitting enrollment...' : (cameraReady ? 'Follow the prompt above the camera.' : 'Waiting for camera access...')}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
