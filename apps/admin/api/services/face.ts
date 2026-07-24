// All face detection/recognition/liveness scoring happens in a separate
// Python microservice (services/face-service) — this Node process never runs
// an ML model itself, which is exactly why it can't crash the way an
// in-process TensorFlow native-addon attempt did before. This module is the
// only place that talks to it; everything else only ever deals with
// embeddings (arrays of numbers) and scores.
export async function callFaceService(endpoint: string, payload: any): Promise<any> {
  const baseUrl = process.env.FACE_SERVICE_URL || 'http://127.0.0.1:8001';
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (networkErr: any) {
    throw new Error(`Could not reach the face service at ${baseUrl} — is it running? (services/face-service)`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // On a free-tier host, 502/503/504 almost always means the face service
    // had spun down from inactivity and hasn't finished cold-booting (it has
    // ML models to load, not just a process to start) — not a real failure.
    // Surfacing that distinction here means the frontend can show "try again
    // in a bit" instead of a bare "HTTP 502", which otherwise reads as a
    // broken feature every time it's been idle for a while.
    if ([502, 503, 504].includes(response.status)) {
      throw new Error('The face verification service is still starting up (it was idle and had to reload its models) — please wait about a minute and try again.');
    }
    throw new Error(body.detail || `Face service returned HTTP ${response.status}`);
  }
  return body;
}

export async function getFaceServiceHealth(): Promise<{ status: string; modelLoaded: boolean }> {
  const baseUrl = process.env.FACE_SERVICE_URL || 'http://127.0.0.1:8001';
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`);
  } catch (_networkErr: any) {
    throw new Error(`Could not reach the face service at ${baseUrl} — is it running? (services/face-service)`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Same cold-start reality as callFaceService above — this health check
    // is what runs first, on page load, so it's actually the MOST likely
    // place to catch the service still waking up from Render's free-tier
    // idle spin-down. Same friendly message instead of a bare "HTTP 502".
    if ([502, 503, 504].includes(response.status)) {
      throw new Error('The face verification service is still starting up (it was idle and had to reload its models) — please wait about a minute and try again.');
    }
    throw new Error(body.detail || `Face service returned HTTP ${response.status}`);
  }
  return {
    status: body.status === 'ok' ? 'ok' : 'degraded',
    modelLoaded: body.modelLoaded === true,
  };
}

// Cosine similarity between two face embeddings. InsightFace's ArcFace
// embeddings are meant to be compared this way — a value near 1 means
// "almost certainly the same person", near 0 (or negative) means unrelated.
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Identity-match threshold for cosineSimilarity() — the single source of
// truth every attendance/face-verify call site imports this from, instead of
// each repeating its own literal.
//
// Raised from an initial 0.36 ("a commonly-cited InsightFace starting
// point", never actually calibrated) to 0.5 after a real false-accept was
// reported and confirmed against a real deployment's own enrolled data:
//   - Legitimate distinct-person pairs in production data: 0.15-0.234 (5 pairs)
//   - One distinct-person pair scored 0.886 — see note below, no threshold fixes this one
//   - Genuine same-person (multiple embeddings per user) pairs: 0.532-0.995, avg ~0.83
// 0.5 sits with wide margin above every normal distinct-person score (0.234)
// and below the observed same-person floor (0.532) — meaningfully harder to
// false-accept than 0.36 was, without meaningfully increasing false-rejects
// for genuine users.
//
// IMPORTANT — this does NOT fully solve the reported bug: one real pair in
// that deployment's data scored 0.886 between two different, fully-completed
// KYC enrollments. That's inside the same-person range (0.532+), so
// literally no similarity threshold can separate it from a genuine match —
// raising this constant further would just start rejecting real users too.
// That specific pair needs a different remedy: re-enrolling one or both
// accounts with a fresh, more varied capture burst (poor lighting/a single
// dominant angle can make ArcFace embeddings unusually close even between
// different people), and in the meantime leaning on this app's other
// independent checks (device pinning, geofencing, liveness/challenge-
// response) as the actual backstop for that specific pair rather than the
// face match alone.
export const FACE_MATCH_THRESHOLD = 0.5;

// The 8 guided poses captured during enrollment. 'look_center' is the
// neutral baseline; the other 7 are also the vocabulary the daily liveness
// fallback challenge is randomly drawn from.
// 'look_down' was dropped from this list — its pose threshold never
// reliably passed against a real camera regardless of lighting/angle (same
// class of miscalibration look_center had before it was simplified to just
// require a detected face; look_down's actual direction made that same fix
// not apply, since the whole point is checking a specific head angle).
// Rather than keep guessing at an uncalibrated threshold, it's removed from
// the enrollment/challenge vocabulary entirely.
//
// Cut down further from 7 actions to 4 (look_up/smile/open_mouth dropped):
// the whole enrollment burst is one request to the free-tier face-service,
// and fewer actions means fewer total frames means less risk of Render's
// gateway timing the request out (502) before the (0.1 shared vCPU) service
// finishes processing it — see FaceEnrollment.tsx's KYC_STEPS for the full
// story. turn_left/turn_right/blink still give real directional + liveness
// coverage; must stay in sync with that file's KYC_STEPS list.
export const KYC_ACTIONS = ['look_center', 'turn_left', 'turn_right', 'blink'];
export const DAILY_CHALLENGE_ACTIONS = KYC_ACTIONS.filter(a => a !== 'look_center');

// Server-side record of exactly which liveness challenge was issued to which
// user, so /api/face/verify has something authoritative to check the capture
// burst against — the client can no longer just ignore whatever instruction
// was shown on screen. Single-process in-memory store (same tradeoff as the
// express-rate-limit windows); a short expiry keeps stale/abandoned entries
// from lingering. Exported as a module singleton so the challenge-issue and
// verify routes share one Map instance.
export const pendingChallenges = new Map<number, { actions: string[]; issuedAt: number }>();
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

// How many fallback actions the daily challenge asks for when the fast
// passive check isn't convincing — deliberately just 1 (the old face-service
// era used 3 with a majority-required rule). One action, fully confirmed, is
// enough to prove the person is live and responding to a randomly-chosen
// on-screen instruction in real time; asking for more only slows down a
// legitimate employee's check-in without meaningfully raising the bar for a
// spoof (a static photo/video replay still can't perform any requested
// action on demand).
export const DAILY_CHALLENGE_ACTION_COUNT = 1;

// Passive (no on-screen action) liveness threshold for the fast path — same
// value the old challenge-mode path used, from landmark micro-movement
// across the capture burst. See services/face-service/main.py's `/verify`
// liveness_score computation.
export const LIVENESS_MIN = 0.6;
