import { Router } from 'express';

// Camera-based face enrollment (POST /api/kyc, /api/kyc/verify-step) and the
// daily liveness-challenge issuer (GET /api/attendance/challenge) have been
// removed along with the rest of the face-recognition system. Device
// registration and identity verification now live entirely under
// /api/webauthn/* (see routes/webauthn.routes.ts) — a WebAuthn credential
// registration replaces camera KYC, and a WebAuthn assertion replaces the
// daily face challenge.
export const router = Router();
