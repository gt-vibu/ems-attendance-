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
    throw new Error(body.detail || `Face service returned HTTP ${response.status}`);
  }
  return {
    status: body.status === 'ok' ? 'ok' : 'degraded',
    modelLoaded: body.modelLoaded === true,
  };
}

// Cosine similarity between two face embeddings. InsightFace's ArcFace
// embeddings (buffalo_l) are meant to be compared this way — a value near 1
// means "almost certainly the same person", near 0 (or negative) means
// unrelated.
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
// truth every attendance/QR/verify-face call site imports this from,
// instead of each repeating its own literal (which is how the old value
// silently drifted across 6+ call sites with zero risk of ever being kept
// in sync).
//
// Raised from an initial 0.36 ("a commonly-cited InsightFace starting
// point", never actually calibrated) to 0.5 after a real false-accept was
// reported and confirmed against this deployment's own enrolled data:
//   - Legitimate distinct-person pairs in production data: 0.15-0.234 (5 pairs)
//   - One distinct-person pair scored 0.886 — see note below, no threshold fixes this one
//   - Genuine same-person (multiple embeddings per user) pairs: 0.532-0.995, avg ~0.83
// 0.5 sits with wide margin above every normal distinct-person score (0.234)
// and below the observed same-person floor (0.532) — meaningfully harder to
// false-accept than 0.36 was, without meaningfully increasing false-rejects
// for genuine users.
//
// IMPORTANT — this does NOT fully solve the reported bug: one real pair in
// this deployment's data scored 0.886 between two different, fully-
// completed KYC enrollments. That's inside the same-person range (0.532+),
// so literally no similarity threshold can separate it from a genuine
// match — raising this constant further would just start rejecting real
// users too. That specific pair needs a different remedy: re-enrolling one
// or both accounts with a fresh, more varied capture burst (poor lighting/
// a single dominant angle can make ArcFace embeddings unusually close even
// between different people), and in the meantime leaning on this app's
// other independent checks (device pinning, geofencing, liveness/challenge-
// response) as the actual backstop for that specific pair rather than the
// face match alone.
export const FACE_MATCH_THRESHOLD = 0.5;

// The 8 guided poses captured during KYC enrollment. 'look_center' is the
// neutral baseline; the other 7 are also the vocabulary the daily liveness
// challenge is randomly drawn from.
export const KYC_ACTIONS = ['look_center', 'turn_left', 'turn_right', 'look_up', 'look_down', 'smile', 'open_mouth', 'blink'];
export const DAILY_CHALLENGE_ACTIONS = KYC_ACTIONS.filter(a => a !== 'look_center');

// Server-side record of exactly which liveness challenge was issued to which
// user, so /verify-face has something authoritative to check the capture
// burst against — the client can no longer just ignore whatever instruction
// was shown on screen. Single-process in-memory store (same tradeoff as the
// express-rate-limit windows); a short expiry keeps stale/abandoned entries
// from lingering. Exported as a module singleton so the challenge-issue and
// verify-face routes share one Map instance.
export const pendingChallenges = new Map<number, { actions: string[]; issuedAt: number }>();
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;
export const FACE_TOKEN_TTL = '3m';
