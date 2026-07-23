// Client for the camera-based face identity check — the alternative to
// webauthnClient.ts's device verification. Mirrors its shape (an
// ensureXReady() readiness check, and an orchestrator that returns the same
// short-lived identity-pass token the final /api/attendance submit expects
// as `token`) so EmployeeAttendance.tsx can treat the two as interchangeable.

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export async function ensureFaceServiceReady(): Promise<void> {
  const res = await fetch('/api/health/face');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Face verification service is unavailable right now.');
  }
  if (!data.modelLoaded) {
    throw new Error('Face verification model is still loading. Please try again in a moment.');
  }
}

// Captures `frameCount` JPEG frames from a live <video>, spaced `intervalMs`
// apart, via an offscreen <canvas>. This is the one place frame timing is
// defined — both the passive check (no on-screen instruction) and the
// single-action fallback challenge use it with the same cadence, so a
// capture always takes a predictable, short amount of time.
export async function captureBurst(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  frameCount: number,
  intervalMs: number,
): Promise<string[]> {
  const frames: string[] = [];
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not access the camera canvas.');

  while (frames.length < frameCount) {
    if (video.videoWidth && video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.85));
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return frames;
}

// Passive burst: ~5 frames over ~2.5s — long enough for the server's
// landmark-movement liveness check to have something to compare across
// frames, short enough to land inside the "2-3 seconds" this flow is
// designed around. No on-screen instruction is shown for this capture.
const PASSIVE_FRAME_COUNT = 5;
const PASSIVE_INTERVAL_MS = 500;

// The single fallback-action burst, only captured if the passive check
// wasn't convincing. Same cadence as enrollment's per-action bursts.
const CHALLENGE_FRAME_COUNT = 5;
const CHALLENGE_INTERVAL_MS = 500;

export interface FaceVerifyOutcome {
  token: string;
  usedFallbackAction: string | null;
}

// Progress callback so the UI can show "checking..." vs "one more
// check — turn_left" without this module reaching into React state itself.
export type FaceVerifyProgress =
  | { phase: 'passive' }
  | { phase: 'fallback'; action: string };

export async function verifyFace(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  onProgress?: (progress: FaceVerifyProgress) => void,
): Promise<FaceVerifyOutcome> {
  onProgress?.({ phase: 'passive' });
  const passiveFrames = await captureBurst(video, canvas, PASSIVE_FRAME_COUNT, PASSIVE_INTERVAL_MS);

  const passiveRes = await fetch('/api/face/verify', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ images: passiveFrames, mode: 'photo' }),
  });
  const passiveData = await passiveRes.json().catch(() => ({}));

  if (passiveRes.ok && passiveData.passed) {
    return { token: passiveData.token, usedFallbackAction: null };
  }
  if (!passiveData.needsFallback) {
    throw new Error(passiveData.error || 'Face verification failed. Please try again.');
  }

  // Fast path wasn't convincing (poor lighting, motion blur, angle) — fall
  // back to exactly one challenge action instead of failing outright.
  const challengeRes = await fetch('/api/face/challenge', { headers: authHeaders() });
  const challengeData = await challengeRes.json().catch(() => ({}));
  if (!challengeRes.ok || !Array.isArray(challengeData.challenge) || challengeData.challenge.length === 0) {
    throw new Error(challengeData.error || 'Could not start the fallback check. Please try again.');
  }
  const action = challengeData.challenge[0] as string;
  onProgress?.({ phase: 'fallback', action });

  const actionFrames = await captureBurst(video, canvas, CHALLENGE_FRAME_COUNT, CHALLENGE_INTERVAL_MS);
  const challengeVerifyRes = await fetch('/api/face/verify', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ images: actionFrames, mode: 'challenge' }),
  });
  const challengeVerifyData = await challengeVerifyRes.json().catch(() => ({}));
  if (!challengeVerifyRes.ok || !challengeVerifyData.passed) {
    throw new Error(challengeVerifyData.error || 'Face verification failed. Please try again.');
  }

  return { token: challengeVerifyData.token, usedFallbackAction: action };
}

export function describeFaceActionInstruction(action: string): string {
  const labels: Record<string, string> = {
    turn_left: 'Slowly turn your head to your left',
    turn_right: 'Slowly turn your head to your right',
    look_up: 'Tilt your head up slightly',
    smile: 'Give a natural smile',
    open_mouth: 'Open your mouth like you are about to say "ah"',
    blink: 'Blink naturally a couple of times',
  };
  return labels[action] || 'Follow the on-screen instruction';
}
