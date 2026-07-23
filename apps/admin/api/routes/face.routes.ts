import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { signToken, signShortLivedToken } from '../../jwt';
import { authenticate } from '../middleware/authenticate';
import { isPlatformFeatureAllowedForTenant } from '../auth/rbac';
import { logToAuditLedger } from '../services/audit';
import { IDENTITY_PASS_PURPOSE, IDENTITY_PASS_TTL } from '../services/webauthn';
import {
  callFaceService,
  cosineSimilarity,
  FACE_MATCH_THRESHOLD,
  KYC_ACTIONS,
  DAILY_CHALLENGE_ACTIONS,
  DAILY_CHALLENGE_ACTION_COUNT,
  LIVENESS_MIN,
  pendingChallenges,
  CHALLENGE_TTL_MS,
} from '../services/face';

export const router = Router();

// Gate: a tenant must opt into the 'face_recognition' platform feature
// before any of these routes do anything — consistent with every other
// module in this app (device_identity, wfh, qr_attendance, ...) being an
// explicit super-admin whitelist entry, never a hardcoded default.
async function ensureFaceFeatureEnabled(req: any, res: any): Promise<boolean> {
  const tenantId = req.user?.tenantId;
  if (!tenantId || !(await isPlatformFeatureAllowedForTenant(tenantId, 'face_recognition'))) {
    res.status(403).json({ error: 'Face recognition is not enabled for your organization.' });
    return false;
  }
  return true;
}

// KYC FACE ENROLLMENT: guided per-action capture (look_center, turn_left,
// turn_right, look_up, smile, open_mouth, blink). Each action
// must actually be detected in its own burst — this is the same
// pose/EAR/MAR geometry the daily challenge is verified against, so
// enrollment can't be satisfied by 8 copies of the same neutral frame.
router.post('/api/face/enroll', authenticate, async (req: any, res: any) => {
  try {
    if (!(await ensureFaceFeatureEnabled(req, res))) return;

    const { actions, deviceId } = req.body;
    if (!actions || typeof actions !== 'object' || !deviceId) {
      return res.status(400).json({ error: 'actions (a burst of photos per guided pose) and deviceId are required' });
    }

    const missing = KYC_ACTIONS.filter(a => !Array.isArray(actions[a]) || actions[a].length === 0);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing capture for: ${missing.join(', ')}`, missingActions: missing });
    }

    // SECURITY: always enroll biometrics for the authenticated caller
    // (req.user, derived from the verified JWT) — never for a uid taken
    // from the request body. Trusting a client-supplied uid here would let
    // any logged-in user overwrite another employee's face embeddings and
    // registered device, i.e. impersonate them at every future check-in.
    const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
    if (usersList.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = usersList[0];

    // All actual face detection/embedding/pose extraction happens in the
    // Python face service — this Node process never runs an ML model
    // itself. See services/face-service/README.md.
    let enrollResult: any;
    try {
      enrollResult = await callFaceService('/enroll', { actions });
    } catch (faceErr: any) {
      return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
    }

    if (Array.isArray(enrollResult.failedActions) && enrollResult.failedActions.length > 0) {
      return res.status(422).json({
        error: `We couldn't confirm: ${enrollResult.failedActions.join(', ')}. Please redo ${enrollResult.failedActions.length === 1 ? 'that step' : 'those steps'} with good lighting, looking directly at the camera.`,
        failedActions: enrollResult.failedActions,
      });
    }

    await db.update(schema.users)
      .set({
        faceEmbeddings: enrollResult.embeddings,
        kycActionLog: enrollResult.actionLog,
        registeredDeviceId: deviceId,
        isKycCompleted: true,
        deviceApprovalPending: false,
        verificationMethod: 'face',
      })
      .where(eq(schema.users.id, user.id));

    await logToAuditLedger({
      tenantId: user.tenantId,
      actorId: user.id,
      actorName: user.name,
      action: 'FACE_ENROLLED',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      deviceInfo: req.headers['user-agent'] || '',
      details: { deviceId },
    });

    // Return fresh token with updated KYC status — mirrors what
    // /api/webauthn/register/verify does on success.
    const updatedUser = {
      id: user.id,
      uid: user.uid,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      isKycCompleted: true,
      verificationMethod: 'face' as const,
    };
    const token = signToken(updatedUser);

    res.json({ success: true, token, user: updatedUser });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Per-action redo during enrollment (e.g. only 'blink' failed) — lets the
// frontend re-record just the failed step instead of the whole 8-action
// burst.
router.post('/api/face/verify-step', authenticate, async (req: any, res: any) => {
  try {
    if (!(await ensureFaceFeatureEnabled(req, res))) return;

    const { action, images } = req.body || {};
    if (!action || !KYC_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'A valid enrollment action is required.' });
    }
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'images are required.' });
    }

    let enrollResult: any;
    try {
      enrollResult = await callFaceService('/enroll', { actions: { [action]: images } });
    } catch (faceErr: any) {
      return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
    }

    if (Array.isArray(enrollResult.failedActions) && enrollResult.failedActions.includes(action)) {
      return res.status(422).json({
        passed: false,
        error: `We couldn't confirm ${action.replace('_', ' ')}. Please keep your face visible and repeat the action more clearly.`,
      });
    }

    res.json({
      passed: true,
      action,
      actionLog: enrollResult.actionLog?.[action] || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback-challenge issuer — used only when the fast passive check in
// POST /api/face/verify isn't convincing. Issues exactly ONE action (not the
// old 3-action challenge), drawn preferentially from actions this specific
// employee actually verified during their own enrollment, and remembers it
// server-side (keyed by user) so /api/face/verify has something
// authoritative to check the capture burst against.
router.get('/api/face/challenge', authenticate, async (req: any, res: any) => {
  if (!(await ensureFaceFeatureEnabled(req, res))) return;

  const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
  const user = usersList[0];

  let pool = [...DAILY_CHALLENGE_ACTIONS];
  if (user?.kycActionLog && typeof user.kycActionLog === 'object') {
    const actionLog = user.kycActionLog as Record<string, any>;
    const verifiedOnly = DAILY_CHALLENGE_ACTIONS.filter(a => actionLog[a]?.verified === true);
    if (verifiedOnly.length > 0) pool = verifiedOnly;
  }

  const selected: string[] = [];
  for (let i = 0; i < DAILY_CHALLENGE_ACTION_COUNT && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool.splice(idx, 1)[0]);
  }
  pendingChallenges.set(req.user.userId, { actions: selected, issuedAt: Date.now() });
  res.json({ challenge: selected });
});

// Daily attendance identity check. Two modes:
//   mode: 'photo'  — fast passive check, no on-screen instruction. A short
//                     (~2-3s) capture burst is enough: liveness (landmark
//                     micro-movement) + identity match both need to clear
//                     their thresholds. This is the common case.
//   (anything else) — the 1-action fallback challenge issued by
//                     GET /api/face/challenge above, used only when the
//                     passive check wasn't convincing.
// On success either way, mints the same identity-pass token WebAuthn's
// authenticate/verify mints — the final POST /api/attendance submit doesn't
// know or care which method produced it.
router.post('/api/face/verify', authenticate, async (req: any, res: any) => {
  try {
    if (!(await ensureFaceFeatureEnabled(req, res))) return;

    const { images, mode } = req.body;
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'images (a short camera burst) are required.' });
    }

    const usersList = await db.select().from(schema.users).where(eq(schema.users.id, req.user.userId));
    if (usersList.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = usersList[0];
    if (!user.isKycCompleted) {
      return res.status(400).json({ error: 'Face enrollment not completed yet.' });
    }

    const mintIdentityPass = () => signShortLivedToken({
      purpose: IDENTITY_PASS_PURPOSE,
      userId: user.id,
    }, IDENTITY_PASS_TTL);

    if (mode === 'photo') {
      let faceResult: any;
      try {
        faceResult = await callFaceService('/verify', { images, challengeActions: [] });
      } catch (faceErr: any) {
        return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
      }

      const livenessScore = faceResult.faceDetected ? (faceResult.livenessScore ?? 0) : 0;

      let bestSimilarity = -1;
      const enrolledEmbeddings = user.faceEmbeddings as number[][];
      if (faceResult.faceDetected && enrolledEmbeddings && enrolledEmbeddings.length > 0) {
        for (const enrolled of enrolledEmbeddings) {
          const sim = cosineSimilarity(enrolled, faceResult.embedding);
          if (sim > bestSimilarity) bestSimilarity = sim;
        }
      }

      const identityEnrolled = !!(enrolledEmbeddings && enrolledEmbeddings.length > 0);
      const isLivenessConvincing = faceResult.faceDetected && livenessScore >= LIVENESS_MIN;
      const isIdentityMatched = faceResult.faceDetected && identityEnrolled && bestSimilarity >= FACE_MATCH_THRESHOLD;

      // Diagnostics-only screen-replay signal — logged on every attempt
      // (pass or fail) but never gates anything; see services/face-service's
      // moire_score().
      const moireScore = typeof faceResult.moireScore === 'number' ? faceResult.moireScore : 0;
      console.log(`[face/verify] user=${user.id} mode=photo moireScore=${moireScore.toFixed(3)} (diagnostics-only) liveness=${livenessScore.toFixed(3)} bestMatch=${bestSimilarity.toFixed(3)}`);

      if (isLivenessConvincing && isIdentityMatched) {
        return res.json({ passed: true, token: mintIdentityPass(), faceMatchScore: bestSimilarity, livenessScore });
      }

      return res.status(403).json({
        passed: false,
        needsFallback: true,
        error: 'Initial photo check was not convincing (liveness or identity mismatch). One more quick check is needed.',
        diagnostics: {
          faceDetected: faceResult.faceDetected,
          liveness: Number(livenessScore.toFixed(3)),
          livenessMin: LIVENESS_MIN,
          bestMatch: Number(bestSimilarity.toFixed(3)),
          matchMin: FACE_MATCH_THRESHOLD,
        },
      });
    }

    // --- Fallback challenge mode: exactly 1 action, issued by GET /api/face/challenge ---
    const pending = pendingChallenges.get(user.id);
    if (!pending || Date.now() - pending.issuedAt > CHALLENGE_TTL_MS) {
      pendingChallenges.delete(user.id);
      return res.status(400).json({ error: 'Your liveness challenge expired. Please try again.', expired: true });
    }

    let faceResult: any;
    try {
      faceResult = await callFaceService('/verify', { images, challengeActions: pending.actions });
    } catch (faceErr: any) {
      return res.status(503).json({ error: `Face verification service unavailable: ${faceErr.message}` });
    }

    const errors: string[] = [];

    if (!faceResult.faceDetected) {
      errors.push('No face detected. Look directly at the camera with good lighting and try again.');
    }

    const livenessScore = faceResult.faceDetected ? (faceResult.livenessScore ?? 0) : 0;
    if (faceResult.faceDetected && livenessScore < LIVENESS_MIN) {
      errors.push('Liveness verification failed (possible spoofing attempt).');
    }

    // Exactly DAILY_CHALLENGE_ACTION_COUNT (1) action was requested — all of
    // it must be confirmed, unlike the old 3-action "majority" rule (which
    // only existed to tolerate one flaky detection across multiple asks;
    // with just one ask there's nothing to average over).
    const confirmedActions = pending.actions.filter(a => faceResult.actionResults?.[a]);
    const unconfirmed = pending.actions.filter(a => !faceResult.actionResults?.[a]);
    if (faceResult.faceDetected && confirmedActions.length < pending.actions.length) {
      errors.push(`We couldn't confirm the requested movement (${unconfirmed.map(a => a.replace('_', ' ')).join(', ')}). Please try again, following the on-screen instruction.`);
    }

    let bestSimilarity = -1;
    const enrolledEmbeddings = user.faceEmbeddings as number[][];
    if (faceResult.faceDetected && enrolledEmbeddings && enrolledEmbeddings.length > 0) {
      for (const enrolled of enrolledEmbeddings) {
        const sim = cosineSimilarity(enrolled, faceResult.embedding);
        if (sim > bestSimilarity) bestSimilarity = sim;
      }
    }
    const identityEnrolled = !!(enrolledEmbeddings && enrolledEmbeddings.length > 0);
    if (faceResult.faceDetected && !identityEnrolled) {
      errors.push('No enrolled face on file — please complete face enrollment before checking in.');
    } else if (faceResult.faceDetected && bestSimilarity < FACE_MATCH_THRESHOLD) {
      errors.push('Facial biometrics verification failed (identity mismatch).');
    }

    const moireScore = typeof faceResult.moireScore === 'number' ? faceResult.moireScore : 0;

    if (errors.length > 0) {
      console.warn(`[face/verify] user=${user.id} REJECTED — faceDetected=${faceResult.faceDetected} liveness=${livenessScore.toFixed(3)} (min ${LIVENESS_MIN}) confirmedActions=${confirmedActions.length}/${pending.actions.length} bestMatch=${bestSimilarity.toFixed(3)} (min ${FACE_MATCH_THRESHOLD}) moireScore=${moireScore.toFixed(3)} (diagnostics-only) framesWithFace=${faceResult.framesWithFace}/${faceResult.framesSubmitted}`);
      return res.status(403).json({
        passed: false,
        error: errors.join(' | '),
        diagnostics: {
          liveness: Number(livenessScore.toFixed(3)),
          livenessMin: LIVENESS_MIN,
          actionsConfirmed: confirmedActions.length,
          actionsRequested: pending.actions.length,
          bestMatch: Number(bestSimilarity.toFixed(3)),
          matchMin: FACE_MATCH_THRESHOLD,
          moireScore: Number(moireScore.toFixed(3)),
        },
      });
    }

    // Single-use: this specific challenge has now been satisfied.
    pendingChallenges.delete(user.id);
    console.log(`[face/verify] user=${user.id} PASSED (challenge mode) moireScore=${moireScore.toFixed(3)} (diagnostics-only) liveness=${livenessScore.toFixed(3)} bestMatch=${bestSimilarity.toFixed(3)}`);

    res.json({ passed: true, token: mintIdentityPass(), faceMatchScore: bestSimilarity, livenessScore });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
