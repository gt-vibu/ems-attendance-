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

// Cosine similarity between two face embeddings. InsightFace's ArcFace
// embeddings (buffalo_l) are meant to be compared this way — a value near 1
// means "almost certainly the same person", near 0 (or negative) means
// unrelated. 0.36 is a commonly-cited InsightFace starting threshold; tune
// this per-deployment once you have real match/mismatch data.
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
