import { Router } from 'express';

// The old camera-based endpoints that used to live here (POST /api/kyc,
// /api/kyc/verify-step, GET /api/attendance/challenge) are gone for good —
// device/identity verification now lives under /api/webauthn/* (see
// routes/webauthn.routes.ts) by default, with camera-based face
// enrollment/check-in available as an opt-in alternative under
// /api/face/enroll, /api/face/verify, /api/face/challenge (see
// routes/face.routes.ts) for tenants with the 'face_recognition' platform
// feature enabled.
export const router = Router();
