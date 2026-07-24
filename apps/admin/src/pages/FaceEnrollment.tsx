import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { User } from '../lib/auth';
import FloatingOrbs from '../components/FloatingOrbs';
import { ensureFaceServiceReady } from '../lib/faceClient';
import { describeCameraError } from '../lib/cameraError';

// Each phase's duration is implicitly frameCount * CAPTURE_INTERVAL_MS — kept
// in lockstep with the frame counts the face-service's geometry thresholds
// (blink EAR dip, yaw turn detection — see services/face-service/main.py)
// were calibrated against, so this only changes how the recording feels,
// not what's actually captured per action.
// Cut down to 4 actions (was 7) at 5 frames/2.5s each — 20 frames total,
// sent as ONE request to the face-service, which runs 3 model inferences
// (detect + recognize + landmarks) per frame. On the free-tier's 0.1
// shared vCPU, the original 7-action/36-frame burst routinely took long
// enough for Render's gateway to time the request out (502) before it
// finished, on every attempt regardless of lighting/angle; even a smaller
// 7-action/18-frame version was still cutting it close. 4 actions keeps
// enough real signal (a baseline pose, both turn directions, and a
// liveness blink) while meaningfully lowering the odds of hitting that
// timeout again — each action's own detection only needs ANY one frame in
// its burst to cross the pose/action threshold (see
// actions_detected_in_burst() in services/face-service/main.py), so more
// frames per action only adds redundancy margin, not stricter passing.
const KYC_STEPS: { key: string; title: string; instruction: string; frameCount: number }[] = [
  { key: 'look_center', title: 'Look straight ahead', instruction: 'Center your face in the frame and look directly at the camera.', frameCount: 5 },
  { key: 'turn_left', title: 'Turn left', instruction: 'Slowly turn your head to your left.', frameCount: 5 },
  { key: 'turn_right', title: 'Turn right', instruction: 'Slowly turn your head to your right.', frameCount: 5 },
  { key: 'blink', title: 'Blink', instruction: 'Blink naturally a couple of times.', frameCount: 5 },
];

type KycStep = (typeof KYC_STEPS)[number];

const CAPTURE_INTERVAL_MS = 500;
const GET_READY_MS = 1500;
const MAX_REDO_ATTEMPTS = 3;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function FaceEnrollment({ user, updateSession, onUseDeviceInstead }: { user: User, updateSession: (u: User) => void, onUseDeviceInstead: () => void }) {
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [subPhase, setSubPhase] = useState<'get_ready' | 'capturing'>('get_ready');
  const [activePhases, setActivePhases] = useState<KycStep[]>(KYC_STEPS);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [phaseFrameCount, setPhaseFrameCount] = useState(0);
  const [redoActions, setRedoActions] = useState<string[]>([]);
  const [redoAttempts, setRedoAttempts] = useState(0);
  const [isRedo, setIsRedo] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const actionsRef = useRef<Record<string, string[]>>({});
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    ensureFaceServiceReady()
      .then(() => startCamera())
      .catch((err: any) => {
        setError(err.message || 'Face verification is unavailable right now.');
      });
    return () => {
      cancelledRef.current = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraReady(true);
    } catch (err) {
      console.error(err);
      setError(describeCameraError(err));
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

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

  // Runs `phases` as ONE continuous recording — a single "get ready" pause,
  // then back-to-back per-phase capture bursts with no stop-and-wait, no
  // server round-trip between phases. Used both for the initial full
  // enrollment (all 8 phases) and for a redo (just the phases that failed).
  // Always ends by submitting whatever's in actionsRef.current, since a redo
  // only ever touches the specific action keys that failed — everything else
  // already captured stays untouched.
  const runRecording = async (phases: KycStep[]) => {
    setActivePhases(phases);
    setRecording(true);
    setHasStarted(true);
    setError('');
    setSubPhase('get_ready');
    setCurrentPhaseIndex(0);
    setPhaseFrameCount(0);

    await delay(GET_READY_MS);
    if (cancelledRef.current) return;

    for (let i = 0; i < phases.length; i++) {
      if (cancelledRef.current) return;
      setCurrentPhaseIndex(i);
      setSubPhase('capturing');
      setPhaseFrameCount(0);

      const phase = phases[i];
      const frames: string[] = [];
      while (frames.length < phase.frameCount) {
        if (cancelledRef.current) return;
        const frame = captureFrame();
        if (frame) {
          frames.push(frame);
          setPhaseFrameCount(frames.length);
        }
        await delay(CAPTURE_INTERVAL_MS);
      }
      actionsRef.current[phase.key] = frames;
    }

    if (cancelledRef.current) return;
    setRecording(false);
    await submitEnrollment();
  };

  const submitEnrollment = async () => {
    if (submitting) return;
    const missing = KYC_STEPS.filter(step => !actionsRef.current[step.key] || actionsRef.current[step.key].length === 0);
    if (missing.length > 0) {
      setError('Finish recording every action before submitting enrollment.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const deviceId = localStorage.getItem('device_fingerprint') || globalThis.crypto.randomUUID();
      localStorage.setItem('device_fingerprint', deviceId);

      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/face/enroll', {
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
          setError(data.error || 'A few actions could not be confirmed. Please redo them.');
          setRedoActions(data.failedActions);
          setIsRedo(true);
          setSubmitting(false);
          return;
        }
        throw new Error(data.error || 'Failed to submit enrollment. Please try again.');
      }

      // Merge into the existing cached user rather than replace it — the
      // enroll response only carries identity/KYC fields, not tenant-wide
      // flags like faceRecognitionEnabled that were set at login.
      updateSession({ ...user, ...data.user });
      // Release the camera NOW rather than waiting for this component to
      // unmount 800ms later — on mobile Chrome, track.stop() doesn't
      // synchronously free the hardware, and the attendance page's own
      // getUserMedia() call (fired right after navigate()) can race ahead
      // of that release and fail with "camera already in use". Stopping
      // here gives the OS a full 800ms head start instead of ~0ms.
      stopCamera();
      setTimeout(() => {
        navigate('/employee/attendance');
      }, 800);
    } catch (err: any) {
      setError(err.message || 'Failed to submit enrollment. Please try again.');
      setSubmitting(false);
    }
  };

  const redoFailedSteps = () => {
    if (redoAttempts >= MAX_REDO_ATTEMPTS) {
      setError('We were unable to confirm these actions after several attempts. Please contact your admin for help.');
      return;
    }
    const failedSet = new Set(redoActions);
    Object.keys(actionsRef.current).forEach((key) => {
      if (failedSet.has(key)) delete actionsRef.current[key];
    });
    const phasesToRedo = KYC_STEPS.filter(step => failedSet.has(step.key));
    setRedoAttempts(prev => prev + 1);
    setRedoActions([]);
    runRecording(phasesToRedo);
  };

  const currentPhase = activePhases[currentPhaseIndex];
  const totalFrames = activePhases.reduce((sum, p) => sum + p.frameCount, 0);
  const framesSoFar = activePhases.slice(0, currentPhaseIndex).reduce((sum, p) => sum + p.frameCount, 0) + phaseFrameCount;
  const overallProgress = recording ? Math.round((framesSoFar / Math.max(1, totalFrames)) * 100) : (hasStarted && !submitting ? 100 : 0);

  return (
    <div className="min-h-screen premium-mesh-bg flex items-center justify-center p-6 font-sans relative overflow-hidden">
      <FloatingOrbs />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-xl w-full nexus-card rounded-3xl p-8 relative z-10"
      >
        <div className="text-center mb-6">
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-[var(--color-nexus-ink)]">Face Enrollment</h1>
          <p className="text-sm text-[var(--color-nexus-muted)] mt-2 font-medium">
            {isRedo
              ? "Just the actions we couldn't confirm — follow the prompts below."
              : 'One short recording — just follow the prompts as they change. Takes about 20 seconds.'}
          </p>
        </div>

        {error && (
          <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-nexus-error)]/20 font-medium">
            {error}
            {redoActions.length > 0 && (
              <button
                onClick={redoFailedSteps}
                className="block mt-2 font-semibold underline underline-offset-2"
              >
                Redo {redoActions.length === 1 ? 'that action' : 'those actions'}
              </button>
            )}
          </div>
        )}

        <div className="relative rounded-2xl overflow-hidden bg-[var(--color-nexus-ink)] aspect-video mb-4 flex items-center justify-center border-4 border-[var(--color-nexus-border)]">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-48 h-64 border-2 border-dashed border-[var(--color-nexus-secondary)]/60 rounded-[40px]"></div>
          </div>

          {!cameraReady && !error && (
            <div className="absolute inset-0 bg-[var(--color-nexus-ink)]/80 flex items-center justify-center text-white/70 text-xs font-medium">
              Starting camera...
            </div>
          )}

          {recording && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-[var(--color-nexus-error)] text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white pulse-ring" />
              Recording
            </div>
          )}
        </div>

        <div className="mb-4 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-4 text-center">
          {recording ? (
            <>
              <p className="text-[10px] tracking-widest uppercase font-extrabold text-[var(--color-nexus-secondary)] mb-1">
                {subPhase === 'get_ready' ? 'Get ready' : `Step ${currentPhaseIndex + 1} of ${activePhases.length}`}
              </p>
              <h5 className="font-sans font-bold text-lg tracking-tight text-[var(--color-nexus-ink)]">
                {subPhase === 'get_ready' ? 'Recording starts in a moment...' : currentPhase.title}
              </h5>
              {subPhase === 'capturing' && (
                <p className="text-[12px] text-[var(--color-nexus-muted)] mt-1">{currentPhase.instruction}</p>
              )}
            </>
          ) : submitting ? (
            <>
              <p className="text-[10px] tracking-widest uppercase font-extrabold text-[var(--color-nexus-secondary)] mb-1">Almost done</p>
              <h5 className="font-sans font-bold text-lg tracking-tight text-[var(--color-nexus-ink)]">Checking your recording...</h5>
            </>
          ) : (
            <>
              <p className="text-[10px] tracking-widest uppercase font-extrabold text-[var(--color-nexus-secondary)] mb-1">Before you start</p>
              <h5 className="font-sans font-bold text-lg tracking-tight text-[var(--color-nexus-ink)]">
                {isRedo ? 'Ready to redo those actions?' : "We'll ask you to look straight, turn your head, and blink"}
              </h5>
              <p className="text-[12px] text-[var(--color-nexus-muted)] mt-1">Keep your face inside the frame the whole time.</p>
            </>
          )}
        </div>

        {/* Phase timeline — a moving playhead across every phase in this
            recording, replacing a per-step dot indicator that only ever
            showed one step "active" at a time behind a blocking button. */}
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {activePhases.map((step, i) => (
            <div
              key={step.key}
              title={step.title}
              className={`h-2 rounded-full transition-all duration-300 ${
                recording && i < currentPhaseIndex
                  ? 'w-2 bg-[var(--color-nexus-secondary)]'
                  : recording && i === currentPhaseIndex
                    ? 'w-6 bg-[var(--color-nexus-primary)]'
                    : 'w-2 bg-[var(--color-nexus-border)]'
              }`}
            />
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex justify-between text-xs font-semibold text-[var(--color-nexus-muted)] uppercase tracking-wider">
            <span>Progress</span>
            <span>{recording ? `${framesSoFar}/${totalFrames} frames` : hasStarted ? 'Recording complete' : `~${Math.round((KYC_STEPS.reduce((s, p) => s + p.frameCount, 0) * CAPTURE_INTERVAL_MS + GET_READY_MS) / 1000)}s total`}</span>
          </div>
          <div className="w-full bg-[var(--color-nexus-surface-alt)] rounded-full h-2">
            <div
              className="bg-[var(--color-nexus-secondary)] h-2 rounded-full transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
          {/* Camera never started (denied, dismissed, or revoked) — the
              Start button below stays disabled forever without this, since
              cameraReady never flips true on its own. Retrying calls
              getUserMedia again: a browser only ever suppresses its own
              prompt once the user has permanently blocked this site from
              its own settings UI — every other denial re-prompts on a
              fresh call, so this doubles as the retry path. */}
          {!recording && !hasStarted && !cameraReady && error && (
            <>
              <button
                onClick={() => { setError(''); startCamera(); }}
                className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider transition-all"
              >
                Enable Camera Access
              </button>
              <button
                onClick={onUseDeviceInstead}
                className="w-full text-center text-xs font-semibold text-[var(--color-nexus-secondary)] underline underline-offset-2 py-1"
              >
                Camera not working? Use device verification instead
              </button>
            </>
          )}
          {!recording && !hasStarted && (cameraReady || !error) && (
            <button
              onClick={() => runRecording(KYC_STEPS)}
              disabled={!cameraReady || submitting}
              className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Recording
            </button>
          )}
          {!recording && hasStarted && submitting && (
            <button
              disabled
              className="w-full bg-[var(--color-nexus-primary)] text-white rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider opacity-50 cursor-not-allowed"
            >
              Submitting Enrollment...
            </button>
          )}
          {!recording && hasStarted && !submitting && error && redoActions.length === 0 && (
            <button
              onClick={() => runRecording(KYC_STEPS)}
              className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider transition-all"
            >
              Try Again
            </button>
          )}
          <p className="text-center text-sm font-medium text-[var(--color-nexus-ink)]">
            {submitting
              ? 'Submitting enrollment...'
              : recording
                ? 'Keep following the prompts — this only takes a few more seconds.'
                : cameraReady
                  ? 'Tap the button above when you\'re ready to begin.'
                  : 'Waiting for camera access...'}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
