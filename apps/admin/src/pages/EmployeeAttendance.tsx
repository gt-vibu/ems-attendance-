import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { User } from '../lib/auth';
import PageChrome from '../components/PageChrome';
import FloatingOrbs from '../components/FloatingOrbs';
import { verifyThisDevice, registerThisDevice, describeWebAuthnError } from '../lib/webauthnClient';
import { verifyFace, describeFaceActionInstruction, FaceVerifyProgress } from '../lib/faceClient';
import { describeCameraError } from '../lib/cameraError';
import { queueAttendanceSubmit, flushAttendanceQueue, getQueuedAttendance } from '../lib/offlineQueue';
// Lazy so Leaflet is code-split out of the main bundle.
const LocationPicker = lazy(() => import('../components/LocationPicker'));

type Step = 'ready' | 'mode_select' | 'home_registration' | 'wfh_reason' | 'identity' | 'gps' | 'wifi' | 'submitting' | 'late_reason';
type TodayState = 'not_started' | 'checked_in' | 'checked_out';
type AttendanceMode = 'office' | 'wfh';

interface WfhEligibility {
  eligible: boolean;
  reason?: string;
  needsHomeRegistration: boolean;
  policy: { radiusMeters: number; requireReason: boolean; allowedWeekdays: string[]; maxDaysPerMonth: number | null; wfhCheckInsThisMonth: number };
  homeLocation: { latitude: number; longitude: number; address: string | null } | null;
}

export default function EmployeeAttendance({ user, onLogout }: { user: User, onLogout: () => void }) {
  const [step, setStep] = useState<Step>('ready');
  const [loading, setLoading] = useState(true);
  // What "Mark Attendance" should do once pressed on the 'ready' screen —
  // resolved during initToday() from the ?mode= deep link (or WFH
  // eligibility), but not acted on until the employee actually clicks,
  // since acting on it immediately is exactly the auto-camera-prompt bug
  // this step exists to avoid.
  const [pendingMode, setPendingMode] = useState<'office' | 'wfh'>('office');
  const [status, setStatus] = useState('Starting camera...');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [wifiCheckEnabled, setWifiCheckEnabled] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  // Surfaced once a verify attempt fails — WebAuthn credentials are scoped to
  // the exact device/browser they were created on, so a lost phone, a new
  // phone, or a browser reinstall all look identical to the server (the
  // account still has a credential on file) but this device simply doesn't
  // have it. Rather than leaving the employee stuck on a dead-end error,
  // offer to register this device as an *additional* one — this reuses the
  // same registration endpoint the very first device used, which never
  // requires clearing the existing registration.
  const [showNewDeviceOption, setShowNewDeviceOption] = useState(false);
  const [newDeviceBusy, setNewDeviceBusy] = useState(false);

  // --- Face recognition identity check (used instead of the WebAuthn block
  // above when user.verificationMethod === 'face') ---
  const [faceBusy, setFaceBusy] = useState(false);
  const [faceProgress, setFaceProgress] = useState<FaceVerifyProgress>({ phase: 'passive' });
  // Set once the camera fails outright or the passive+fallback attempt
  // doesn't pass — switches this step over to the existing WebAuthn UI
  // below as a one-off rescue, without touching the employee's stored
  // verificationMethod (they're back on Face automatically next time).
  const [faceCameraBroken, setFaceCameraBroken] = useState(false);
  const faceVideoRef = useRef<HTMLVideoElement>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement>(null);
  const faceStreamRef = useRef<MediaStream | null>(null);

  // Wi-Fi simulation context input — DEV ONLY, never rendered in production
  // builds. Lives on its own Wi-Fi step now, not inline with the camera.
  const [simulatedIp, setSimulatedIp] = useState('');

  // --- Work From Home (WFH) — additive attendance mode, selected via a
  // toggle shown above the face-verification step whenever the tenant makes
  // WFH available to this employee. Entirely opt-in: attendanceMode stays
  // 'office' and every WFH-only state below stays unused unless the
  // employee explicitly picks Work From Home. ---
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>('office');
  const [wfhEligibility, setWfhEligibility] = useState<WfhEligibility | null>(null);
  const [wfhReasonText, setWfhReasonText] = useState('');
  const [homeRegCoords, setHomeRegCoords] = useState<{ lat: number, lng: number, accuracy?: number } | null>(null);
  const [homeRegSubmitting, setHomeRegSubmitting] = useState(false);

  // Today's attendance state — drives whether the camera flow and the
  // "already completed" locked card are shown. Break Management, hours
  // worked, and checkout live on EmployeeHome.tsx once checked in — this
  // page redirects there rather than handling that state itself.
  const [todayState, setTodayState] = useState<TodayState>('not_started');

  // Late-arrival explanation step
  const [lateExplanation, setLateExplanation] = useState('');
  const [lateSubmitting, setLateSubmitting] = useState(false);

  // Attendance correction request modal
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionType, setCorrectionType] = useState('missed_checkin');
  const [correctionDate, setCorrectionDate] = useState('');
  const [correctionTime, setCorrectionTime] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionSubmitted, setCorrectionSubmitted] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = localStorage.getItem('auth_token');
  const identityTokenRef = useRef<string | null>(null);
  // Mirrors `location` state, but readable synchronously — `checkNetwork`
  // can run in the same tick as `setLocation`, before React re-renders and
  // the `location` state closure updates, so the async chain threads
  // through this ref instead of relying on stale state reads.
  const locationRef = useRef<{ lat: number, lng: number } | null>(null);
  // Last IP override used for the final submit — kept so the late-reason
  // resubmit can reuse it without repeating the Wi-Fi step.
  const ipOverrideRef = useRef<string>('');

  // Device fingerprint helper
  const getDeviceFingerprint = () => {
    let deviceId = localStorage.getItem('device_fingerprint');
    if (!deviceId) {
      deviceId = 'device_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('device_fingerprint', deviceId);
    }
    return deviceId;
  };

  const [queuedCount, setQueuedCount] = useState(0);

  const attemptQueueFlush = async () => {
    const pending = await getQueuedAttendance();
    if (pending.length === 0) { setQueuedCount(0); return; }
    const result = await flushAttendanceQueue();
    const remaining = await getQueuedAttendance();
    setQueuedCount(remaining.length);
    if (result.succeeded > 0) {
      setSuccess(`${result.succeeded} saved check-in(s) submitted successfully.`);
      initToday();
    }
    if (result.failedMessages.length > 0) {
      setError(result.failedMessages[0]);
    }
  };

  useEffect(() => {
    fetchTenantConfig();
    initToday();
    attemptQueueFlush();
    window.addEventListener('online', attemptQueueFlush);
    return () => {
      window.removeEventListener('online', attemptQueueFlush);
      // Stop the camera if the employee navigates away mid face-verification
      // — otherwise the tab keeps the camera light on after leaving the page.
      faceStreamRef.current?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort — if this fails (network, tenant has no WFH policy at all,
  // etc.) treat WFH as simply unavailable and fall straight through to the
  // existing office-only flow, exactly as before this feature existed.
  const fetchWfhEligibility = async (): Promise<WfhEligibility | null> => {
    try {
      const res = await fetch('/api/attendance/wfh/eligibility', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      setWfhEligibility(data);
      return data;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  // Check where the employee stands today before deciding whether to open
  // the camera at all — someone already checked in belongs on the Employee
  // Home page instead, and someone already checked out shouldn't be shown
  // the scan flow again until tomorrow.
  const initToday = async () => {
    try {
      const res = await fetch('/api/attendance/today', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      const state: TodayState = data.state || 'not_started';
      if (state === 'checked_in') {
        navigate('/employee/dashboard');
        return;
      }
      setTodayState(state);
      if (state === 'checked_out') {
        setLoading(false);
        return;
      }

      const wfhData = await fetchWfhEligibility();

      // The /employee/dashboard landing page sends the employee here with a
      // pre-made choice (?mode=office|wfh). Either way, land on the 'ready'
      // gate below rather than opening the camera/GPS immediately — the
      // camera must only ever start from an explicit tap on THIS page's
      // "Mark Attendance" button, not just because the page finished
      // loading. Falls back to today's behavior (conditional mode_select)
      // for anyone with no eligible WFH option.
      const requestedMode = searchParams.get('mode');
      if (requestedMode === 'wfh' && wfhData?.eligible) {
        setPendingMode('wfh');
        setStep('ready');
        setLoading(false);
        return;
      }
      if (requestedMode === 'office' || !wfhData?.eligible) {
        setPendingMode('office');
        setStep('ready');
        setLoading(false);
        return;
      }

      // Only reachable when WFH is available and no mode was pre-selected —
      // let the employee choose Office vs. Work From Home; each option
      // itself still requires a further explicit tap before the camera
      // starts (chooseOfficeMode / enterWfhFlow).
      setStep('mode_select');
      setLoading(false);
    } catch (err) {
      console.error(err);
      // Fail open — don't block attendance if this status check itself
      // fails, but still land on the 'ready' gate rather than auto-opening
      // the camera.
      setPendingMode('office');
      setStep('ready');
      setLoading(false);
    }
  };

  // The 'ready' screen's single "Mark Attendance" button — the only place
  // that's allowed to trigger the camera/GPS permission prompts, per
  // pendingMode resolved earlier in initToday().
  const startAttendance = () => {
    if (pendingMode === 'wfh' && wfhEligibility) {
      enterWfhFlow(wfhEligibility);
    } else {
      chooseOfficeMode();
    }
  };

  // --- Work From Home (WFH) mode-selection handlers ---

  const chooseOfficeMode = () => {
    setAttendanceMode('office');
    enterFaceStep();
  };

  // Shared WFH entry. Takes the eligibility object explicitly rather than
  // reading `wfhEligibility` state, so it works both from the in-page
  // chooser (state already set) AND directly from the mount effect where the
  // freshly-fetched data hasn't been committed to state yet (?mode=wfh deep
  // link from the /employee/dashboard landing page).
  const enterWfhFlow = (elig: WfhEligibility) => {
    setAttendanceMode('wfh');
    setError('');
    if (elig.needsHomeRegistration) {
      setStep('home_registration');
      setLoading(false);
    } else if (elig.policy.requireReason) {
      setStep('wfh_reason');
      setLoading(false);
    } else {
      enterFaceStep();
    }
  };

  const chooseWfhMode = () => {
    if (wfhEligibility) enterWfhFlow(wfhEligibility);
  };

  // First-time home location registration — captures a fresh GPS fix and
  // registers it as this employee's home for all future WFH distance checks.
  const captureHomeLocation = () => {
    setError('');
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setHomeRegCoords({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
      },
      (err) => setError(err.code === err.TIMEOUT
        ? 'Could not get a GPS fix in time. Move somewhere with a clearer signal and try again.'
        : 'GPS location permission is required to register your home location.'),
      // timeout so it can't hang forever on a weak signal; maximumAge lets a
      // recent fix return instantly instead of forcing a slow high-accuracy one.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  const confirmHomeRegistration = async () => {
    if (!homeRegCoords) return;
    setHomeRegSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/attendance/wfh/register-home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(homeRegCoords)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register home location.');

      if (wfhEligibility?.policy.requireReason) {
        setStep('wfh_reason');
      } else {
        enterFaceStep();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to register home location.');
    } finally {
      setHomeRegSubmitting(false);
    }
  };

  const confirmWfhReason = () => {
    if (wfhEligibility?.policy.requireReason && !wfhReasonText.trim()) {
      setError('Please provide a reason for working from home.');
      return;
    }
    setError('');
    enterFaceStep();
  };

  const fetchTenantConfig = async () => {
    try {
      const res = await fetch('/api/tenant/config', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.tenant) {
        setWifiCheckEnabled(!!data.tenant.wifiCheckEnabled);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ==========================================
  // STEP 1 — WebAuthn device identity check
  // ==========================================

  const enterFaceStep = async () => {
    setStep('identity');
    setError('');
    identityTokenRef.current = null;
    setIdentityVerified(false);
    setShowNewDeviceOption(false);
    setFaceCameraBroken(false);
    setStatus('Ready to verify');
    setLoading(false);
    // Entering this step already followed an explicit "Mark Attendance" tap
    // earlier in the flow, so starting the camera immediately here doesn't
    // violate the "camera only opens from an explicit tap" rule — it's the
    // face equivalent of the WebAuthn block below requiring its own tap.
    if (user.verificationMethod === 'face') {
      startFaceVerification();
    }
  };

  const stopFaceCamera = () => {
    faceStreamRef.current?.getTracks().forEach(t => t.stop());
    faceStreamRef.current = null;
  };

  const startFaceVerification = async () => {
    setFaceBusy(true);
    setError('');
    setFaceProgress({ phase: 'passive' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 360 } });
      faceStreamRef.current = stream;
      if (faceVideoRef.current) faceVideoRef.current.srcObject = stream;
    } catch (err) {
      setError(describeCameraError(err));
      setFaceBusy(false);
      return;
    }
    // Give the <video> element a beat to actually start producing frames
    // (videoWidth/videoHeight are 0 until the first frame decodes).
    await new Promise(resolve => setTimeout(resolve, 400));
    try {
      if (!faceVideoRef.current || !faceCanvasRef.current) {
        throw new Error('Camera not ready. Please try again.');
      }
      const outcome = await verifyFace(faceVideoRef.current, faceCanvasRef.current, setFaceProgress);
      identityTokenRef.current = outcome.token;
      setIdentityVerified(true);
      stopFaceCamera();
      enterGpsStep();
    } catch (err: any) {
      stopFaceCamera();
      setError(err.message || 'Face verification failed. Please try again.');
      setFaceBusy(false);
    }
  };

  // "Camera not working?" rescue — hands off to the existing WebAuthn UI for
  // this one check-in only. Doesn't change the employee's stored
  // verificationMethod, so they're back on Face automatically next time.
  const useDeviceInsteadOfFace = () => {
    stopFaceCamera();
    setFaceBusy(false);
    setFaceCameraBroken(true);
    setError('');
    setStatus('Ready to verify');
  };

  const handleVerifyIdentity = async () => {
    if (identityBusy) return;
    setError('');
    setShowNewDeviceOption(false);
    setIdentityBusy(true);
    setStatus('Waiting for your device...');
    try {
      const identityToken = await verifyThisDevice();
      identityTokenRef.current = identityToken;
      setIdentityVerified(true);
      enterGpsStep();
    } catch (err) {
      setError(describeWebAuthnError(err));
      setStatus('Ready to verify');
      // Any failed verify attempt could mean this device simply never had a
      // passkey to begin with (new phone, reinstalled browser, cleared site
      // data) — offer the escape hatch rather than making the employee find
      // an admin. Harmless to show even when the real cause was a plain
      // cancel/timeout: registering a device the user already controls the
      // credential for is a no-op risk-wise.
      setShowNewDeviceOption(true);
    } finally {
      setIdentityBusy(false);
    }
  };

  const handleRegisterNewDevice = async () => {
    if (newDeviceBusy) return;
    setError('');
    setNewDeviceBusy(true);
    setStatus('Registering this device...');
    try {
      await registerThisDevice();
      setShowNewDeviceOption(false);
      setStatus('Device registered — verifying...');
      const identityToken = await verifyThisDevice();
      identityTokenRef.current = identityToken;
      setIdentityVerified(true);
      enterGpsStep();
    } catch (err) {
      setError(describeWebAuthnError(err));
      setStatus('Ready to verify');
      setShowNewDeviceOption(true);
    } finally {
      setNewDeviceBusy(false);
    }
  };

  // ==========================================
  // STEP 2 — GPS geofence
  // ==========================================

  const enterGpsStep = () => {
    setStep('gps');
    setError('');
    setStatus('Requesting GPS lock...');
    setLoading(true);

    if (!navigator.geolocation) {
      setError('Geolocation not supported.');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        locationRef.current = coords;
        setLocation(coords);

        // Work From Home never checks the office geofence (there's no
        // office-boundary preview endpoint for a home location — the
        // authoritative distance-from-home check happens server-side in the
        // final submit below, same as every other WFH validation) and never
        // goes through the Wi-Fi step, which only makes sense on-site.
        if (attendanceMode === 'wfh') {
          setLoading(false);
          return doFinalSubmit(coords, '');
        }

        setStatus('Checking office boundary...');
        try {
          const res = await fetch('/api/attendance/verify-location', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ lat: coords.lat, lng: coords.lng, token: identityTokenRef.current })
          });
          const data = await res.json();
          if (!res.ok || !data.passed) {
            if (data.expired) {
              setLoading(false);
              return enterFaceStep();
            }
            throw new Error(data.error || 'Location verification failed.');
          }
          setLoading(false);
          if (wifiCheckEnabled) {
            enterWifiStep();
          } else {
            doFinalSubmit(coords, '');
          }
        } catch (err: any) {
          setError(err.message || 'Location verification failed.');
          setLoading(false);
        }
      },
      (err) => {
        setError(err.code === err.TIMEOUT
          ? 'Could not get a GPS fix in time. Move somewhere with a clearer signal and try again.'
          : 'GPS location access is required to log attendance.');
        setLoading(false);
      },
      // timeout so it can't hang forever on a weak signal; maximumAge lets a
      // recent fix return instantly instead of forcing a slow high-accuracy one.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  // ==========================================
  // STEP 3 — Wi-Fi / corporate network (only if enabled by the tenant admin)
  // ==========================================

  const enterWifiStep = () => {
    setStep('wifi');
    setError('');
    checkNetwork('');
  };

  const checkNetwork = async (ipOverride: string) => {
    setStatus('Checking corporate network...');
    setLoading(true);
    try {
      const res = await fetch('/api/attendance/verify-network', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ simulatedIp: ipOverride, token: identityTokenRef.current })
      });
      const data = await res.json();
      if (!res.ok || !data.passed) {
        if (data.expired) {
          setLoading(false);
          return enterFaceStep();
        }
        throw new Error(data.error || 'Network verification failed.');
      }
      setLoading(false);
      doFinalSubmit(locationRef.current!, ipOverride);
    } catch (err: any) {
      setError(err.message || 'Network verification failed.');
      setLoading(false);
    }
  };

  // ==========================================
  // FINAL SUBMIT — records the log; re-validates everything server-side
  // (nothing about "step N passed" is trusted from this client).
  // ==========================================

  const doFinalSubmit = async (coords: { lat: number, lng: number }, ipOverride: string, explanation?: string) => {
    setStep('submitting');
    setStatus('Recording attendance...');
    setLoading(true);
    setError('');
    ipOverrideRef.current = ipOverride;

    // Determined from today's state *before* this call — whether this scan
    // will resolve to a check-in or a check-out on the server.
    const isCheckIn = todayState !== 'checked_in';

    const deviceId = getDeviceFingerprint();
    const requestBody = {
      token: identityTokenRef.current,
      deviceId,
      lat: coords.lat,
      lng: coords.lng,
      simulatedIp: ipOverride,
      clientTimestamp: new Date().toISOString(),
      explanation,
      mode: attendanceMode,
      wfhReason: attendanceMode === 'wfh' ? wfhReasonText.trim() : undefined
    };

    // The submit call itself is isolated in its own try/catch so a network
    // failure here (identity + location already verified, just this last
    // round-trip dropped) can be queued for automatic retry instead of
    // being treated the same as a real validation failure below, which
    // would otherwise throw the employee all the way back to the
    // verification step for no reason.
    let res: Response;
    try {
      res = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });
    } catch {
      await queueAttendanceSubmit(token || '', requestBody);
      setQueuedCount((c) => c + 1);
      setLoading(false);
      setStep('ready');
      setSuccess('');
      setError('You appear to be offline. This check-in is saved and will submit automatically once you\'re back online.');
      return;
    }

    try {
      const data = await res.json();

      if (!res.ok) {
        // Late check-in — show the one-time explanation step instead of
        // treating this as a failure; the camera/GPS/Wi-Fi results already
        // captured are reused when it resubmits.
        if (data.requiresExplanation) {
          setStep('late_reason');
          setLoading(false);
          return;
        }
        // Edge cases only reachable via a race (e.g. policy changed or the
        // home-location request was rejected between eligibility check and
        // submit) — send the employee back to the relevant WFH step rather
        // than a dead-end error.
        if (data.needsHomeRegistration) {
          await fetchWfhEligibility();
          setStep('home_registration');
          setLoading(false);
          return;
        }
        if (data.requiresWfhReason) {
          setStep('wfh_reason');
          setLoading(false);
          return;
        }
        // Day already completed (e.g. a second tab) — lock the UI instead
        // of restarting the flow.
        if (data.locked) {
          setTodayState('checked_out');
          setError(data.error || 'Attendance already completed for today.');
          setLoading(false);
          return;
        }
        throw new Error(data.error || 'Verification failed.');
      }

      setTodayState(isCheckIn ? 'checked_in' : 'checked_out');
      setSuccess(
        isCheckIn
          ? (data.pendingApproval ? 'Checked in — pending manager approval.' : 'Checked in successfully!')
          : 'Checked out successfully!'
      );
      setLoading(false);

      // Everything after check-in (breaks, hours worked, checkout) lives on
      // Employee Home now — hand off there once they've had a moment to see
      // the confirmation, rather than parking them on this page.
      if (isCheckIn) {
        setTimeout(() => navigate('/employee/home'), 1200);
      }
    } catch (err: any) {
      // Only if all three gates verified does attendance get recorded — any
      // failure at this final, authoritative step resets all the way back
      // to the camera step rather than carrying partial state forward.
      // enterFaceStep() itself clears `error` (and everything else) as part
      // of resetting the camera, so the real message must be set AFTER that
      // reset finishes — setting it before, like this used to, gets
      // silently wiped out in the same tick and the employee never sees why
      // they were sent back to the camera step.
      setLoading(false);
      await enterFaceStep();
      setError(err.message || 'Verification failed.');
    }
  };

  // Resubmit the final attendance call with the employee's explanation for
  // a late check-in — reuses the face token / GPS / Wi-Fi already captured.
  const submitLateExplanation = async () => {
    if (!lateExplanation.trim() || !locationRef.current) return;
    setLateSubmitting(true);
    await doFinalSubmit(locationRef.current, ipOverrideRef.current, lateExplanation.trim());
    setLateSubmitting(false);
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionDate || !correctionReason) return;
    setCorrectionSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          requestType: correctionType,
          requestedDate: correctionDate,
          requestedTime: correctionTime || undefined,
          reason: correctionReason
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit request');
      setCorrectionSubmitted(true);
      setCorrectionDate('');
      setCorrectionTime('');
      setCorrectionReason('');
      setTimeout(() => {
        setShowCorrectionModal(false);
        setCorrectionSubmitted(false);
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  const STEP_LABELS: Record<Step, string> = {
    ready: 'Mark Attendance',
    mode_select: 'Attendance Mode',
    home_registration: 'Register Home Location',
    wfh_reason: 'Reason for WFH',
    identity: '1. Device Verification',
    gps: attendanceMode === 'wfh' ? '2. Home Location' : '2. Location',
    wifi: '3. Corporate Network',
    submitting: 'Recording',
    late_reason: 'Explain Late Arrival',
  };
  const stepOrder: Step[] = wifiCheckEnabled ? ['identity', 'gps', 'wifi'] : ['identity', 'gps'];

  return (
    <div className="min-h-screen premium-mesh-bg flex items-center justify-center p-6 font-sans text-[var(--color-nexus-ink)] selection:bg-[var(--color-nexus-primary)] selection:text-white relative overflow-hidden">
      {/* No WebGL AuroraField here, deliberately: the face-verification
          step runs a live camera feed, and on lower-end phones a
          simultaneous Three.js/WebGL canvas would compete with it for
          GPU/CPU/battery. FloatingOrbs (pure CSS) gives the same vibrant
          floating ambience for near-zero cost. */}
      <FloatingOrbs />
      <PageChrome fallbackHref="/employee/dashboard" />

      {/* Sign Out Button — positioned independently of PageChrome's
          top-left Back/Landing Page pair, so it shrinks its own padding on
          narrow screens (matching PageChrome's icon-only collapse) rather
          than relying on exact width math between two unrelated elements. */}
      <div className="absolute top-4 sm:top-6 right-4 sm:right-6 z-40">
        <button
          onClick={onLogout}
          className="text-[10px] sm:text-xs font-bold text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] transition-colors uppercase tracking-widest bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] hover:border-[var(--color-nexus-primary)] px-3 sm:px-5 py-2 sm:py-2.5 rounded-full shadow-sm whitespace-nowrap"
        >
          Sign Out
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full nexus-card rounded-3xl p-8 relative z-10"
      >

        {/* Header */}
        <div className="text-center mb-6">
          <span className="px-3 py-1 bg-[var(--color-nexus-primary-fixed)] border border-[var(--color-nexus-border)] text-[var(--color-nexus-primary)] rounded-full text-[9px] font-mono tracking-widest uppercase">
            Portal: {user.role}
          </span>
          {attendanceMode === 'wfh' && step !== 'mode_select' && (
            <span className="ml-2 px-3 py-1 bg-[var(--color-nexus-secondary-container)] border border-[var(--color-nexus-secondary)]/30 text-[var(--color-nexus-secondary)] rounded-full text-[9px] font-mono tracking-widest uppercase">
              🏠 Work From Home
            </span>
          )}
          {queuedCount > 0 && (
            <span className="ml-2 px-3 py-1 bg-[var(--color-nexus-warning-soft)] border border-[var(--color-nexus-warning)]/30 text-[var(--color-nexus-warning)] rounded-full text-[9px] font-mono tracking-widest uppercase">
              {queuedCount} check-in{queuedCount > 1 ? 's' : ''} pending sync
            </span>
          )}
          <h1 className="font-sans text-3xl font-extrabold tracking-tight text-[var(--color-nexus-ink)] mt-4">
            Clock In / Out
          </h1>
          <p className="text-xs text-[var(--color-nexus-muted)] mt-2 font-mono break-all px-4">
            {user.email}
          </p>
        </div>

        {todayState === 'checked_out' ? (
          <div className="bg-[var(--color-nexus-secondary-container)] border border-[var(--color-nexus-secondary)]/30 p-8 rounded-2xl text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-secondary)] rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(34,199,184,0.25)] pulse-ring">
              <svg className="w-8 h-8 text-[var(--color-nexus-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-sans font-bold text-[var(--color-nexus-ink)]">Attendance completed for today</h2>
            <p className="text-xs text-[var(--color-nexus-muted)]">You've already checked in and checked out today. Come back tomorrow!</p>
            <button
              onClick={() => setShowCorrectionModal(true)}
              className="w-full text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] text-xs font-bold uppercase tracking-wider py-2 transition-colors cursor-pointer"
            >
              Missed a check-in/out? Request a correction
            </button>
          </div>
        ) : (
          <>
        {!success && stepOrder.includes(step) && (
          <div className="flex items-center justify-center gap-2 mb-6">
            {stepOrder.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${
                  step === s ? 'bg-[var(--color-nexus-primary)] text-white' : stepOrder.indexOf(step) > i || step === 'submitting' ? 'bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-secondary)] border border-[var(--color-nexus-secondary)]/30' : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)]'
                }`}>
                  {i + 1}
                </span>
                {i < stepOrder.length - 1 && <span className="w-6 h-px bg-[var(--color-nexus-border)]" />}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-4 rounded-xl mb-6 border border-[var(--color-nexus-error)]/20 font-medium text-center">
            ⚠️ {error}
          </div>
        )}

        {success ? (
          <div className="bg-[var(--color-nexus-secondary-container)] border border-[var(--color-nexus-secondary)]/30 p-8 rounded-2xl text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-secondary)] rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(34,199,184,0.25)] pulse-ring">
              <svg className="w-8 h-8 text-[var(--color-nexus-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-sans font-bold text-[var(--color-nexus-ink)]">Identity Verified</h2>
            <p className="text-sm font-medium text-[var(--color-nexus-secondary)]">{success}</p>
            <button
              onClick={() => {
                setSuccess('');
                setError('');
                enterFaceStep();
              }}
              className="mt-6 w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white text-xs font-bold uppercase tracking-wider py-3.5 px-6 rounded-xl transition-all"
            >
              Scan Again / Clock Out
            </button>
          </div>
        ) : (
          <>
            {/* Landing gate — camera/GPS permission prompts must only ever
                fire from this explicit tap, never just because the page
                loaded. Every entry path (direct visit, ?mode= deep link,
                WFH eligible or not) lands here first. */}
            {step === 'ready' && (
              <div className="py-6 space-y-5 text-center">
                <div className="w-16 h-16 mx-auto bg-[var(--color-nexus-primary-fixed)] rounded-full flex items-center justify-center">
                  <span className="text-2xl">{pendingMode === 'wfh' ? '🏠' : '🏢'}</span>
                </div>
                <div>
                  <h2 className="text-lg font-sans font-bold text-[var(--color-nexus-ink)]">Ready to mark attendance?</h2>
                  <p className="text-xs text-[var(--color-nexus-muted)] mt-1.5">
                    You'll be asked to verify with your device (fingerprint, face, or PIN){pendingMode === 'office' ? ' and allow location access' : ''} for identity and {pendingMode === 'wfh' ? 'home-location' : 'geofence'} verification.
                  </p>
                </div>
                <button
                  onClick={startAttendance}
                  className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-4 font-bold text-sm uppercase tracking-wider transition-all shadow-[0_4px_15px_rgba(37,99,235,0.3)]"
                >
                  Mark Attendance
                </button>
              </div>
            )}

            {/* Attendance Mode selection — Office vs. Work From Home. Only
                reachable when the tenant has WFH enabled and this employee
                is eligible with no mode pre-selected via the ?mode= deep
                link. */}
            {step === 'mode_select' && (
              <div className="py-4 space-y-4">
                <p className="text-center text-xs font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-2">Attendance Mode</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={chooseOfficeMode}
                    className=" flex flex-col items-center gap-2 py-6 rounded-2xl border-2 border-[var(--color-nexus-border)] hover:border-[var(--color-nexus-primary)] transition-colors"
                  >
                    <span className="text-2xl float-c">🏢</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)]">Office</span>
                  </button>
                  <button
                    onClick={chooseWfhMode}
                    className=" flex flex-col items-center gap-2 py-6 rounded-2xl border-2 border-[var(--color-nexus-border)] hover:border-[var(--color-nexus-primary)] transition-colors"
                  >
                    <span className="text-2xl float-b">🏠</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-nexus-ink)]">Work From Home</span>
                  </button>
                </div>
                {wfhEligibility?.policy.maxDaysPerMonth != null && (
                  <p className="text-center text-[11px] text-[var(--color-nexus-muted)]">
                    {wfhEligibility.policy.wfhCheckInsThisMonth}/{wfhEligibility.policy.maxDaysPerMonth} Work From Home days used this month
                  </p>
                )}
              </div>
            )}

            {/* First-time home location registration — required once before
                Work From Home can be used; every later WFH check-in
                validates against this registered point. */}
            {step === 'home_registration' && (
              <div className="py-4 space-y-4 text-center">
                <p className="text-xs font-bold text-[var(--color-nexus-primary)] uppercase tracking-widest">Register Your Home Location</p>
                <p className="text-xs text-[var(--color-nexus-muted)]">
                  This is a one-time step. Your Work From Home attendance will be checked against this location going forward — future changes require your manager's approval.
                </p>
                {!homeRegCoords ? (
                  <button
                    onClick={captureHomeLocation}
                    className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-all"
                  >
                    Capture Current Location
                  </button>
                ) : (
                  <>
                    <div className="p-3 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-[11px] font-mono text-[var(--color-nexus-muted)]">
                      {homeRegCoords.lat.toFixed(5)}, {homeRegCoords.lng.toFixed(5)}
                      {homeRegCoords.accuracy && <span> (±{Math.round(homeRegCoords.accuracy)}m)</span>}
                    </div>
                    {/* Confirm/adjust the captured home location on a map before
                        registering — drag the pin or click to fine-tune. Same
                        coordinates are submitted; lazy-loaded. */}
                    <Suspense fallback={<div className="h-[220px] rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] flex items-center justify-center text-[11px] text-[var(--color-nexus-muted)]">Loading map…</div>}>
                      <LocationPicker
                        lat={homeRegCoords.lat}
                        lng={homeRegCoords.lng}
                        accuracy={homeRegCoords.accuracy}
                        height={220}
                        onChange={(la, ln, acc) => setHomeRegCoords({ lat: la, lng: ln, accuracy: acc ?? homeRegCoords.accuracy })}
                      />
                    </Suspense>
                    <button
                      onClick={confirmHomeRegistration}
                      disabled={homeRegSubmitting}
                      className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                      {homeRegSubmitting ? 'Registering...' : 'Confirm This Is My Home Location'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Reason for working from home today — only shown when the
                tenant's policy requires it. */}
            {step === 'wfh_reason' && (
              <div className="py-4 space-y-4">
                <p className="text-center text-xs font-bold text-[var(--color-nexus-primary)] uppercase tracking-widest">Reason for Working From Home</p>
                <textarea
                  value={wfhReasonText}
                  onChange={e => setWfhReasonText(e.target.value)}
                  rows={3}
                  placeholder="e.g. Focus work, waiting for a delivery, doctor's appointment nearby, etc."
                  className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)] resize-none"
                />
                <button
                  onClick={confirmWfhReason}
                  className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-all"
                >
                  Continue to Device Verification
                </button>
              </div>
            )}

            {/* STEP 1 — Face recognition identity check (primary when
                verificationMethod === 'face'), with a "camera not working"
                rescue that falls through to the WebAuthn block below. */}
            {step === 'identity' && user.verificationMethod === 'face' && !faceCameraBroken && (
              <div className="py-6 text-center space-y-5">
                <div className="relative w-40 h-40 mx-auto rounded-full overflow-hidden bg-[var(--color-nexus-ink)] border-2 border-[var(--color-nexus-border)]">
                  <video
                    ref={faceVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover opacity-90 scale-x-[-1]"
                  />
                  <canvas ref={faceCanvasRef} className="hidden" />
                  {faceBusy && (
                    <div className="absolute inset-0 border-2 border-[var(--color-nexus-secondary)] rounded-full animate-pulse" />
                  )}
                </div>

                <p className="text-xs font-bold text-[var(--color-nexus-secondary)] font-mono uppercase tracking-wider h-6">
                  {!faceBusy
                    ? '● Ready to verify'
                    : faceProgress.phase === 'passive'
                      ? '● Checking...'
                      : `● One more check — ${describeFaceActionInstruction(faceProgress.action)}`}
                </p>

                <div className="space-y-4">
                  {!faceBusy && (
                    <button
                      onClick={startFaceVerification}
                      className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-4 font-bold text-sm uppercase tracking-wider transition-all duration-200 shadow-[0_4px_15px_rgba(37,99,235,0.3)] cursor-pointer"
                    >
                      {error ? 'Try Again' : 'Start Verification'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={useDeviceInsteadOfFace}
                    className="w-full text-center text-xs font-semibold text-[var(--color-nexus-secondary)] underline underline-offset-2 py-1"
                  >
                    Camera not working? Verify with your device instead
                  </button>
                </div>
              </div>
            )}

            {/* STEP 1 — WebAuthn device identity (default, or the face
                camera-broken rescue path above) */}
            {step === 'identity' && (user.verificationMethod !== 'face' || faceCameraBroken) && (
              <div className="py-8 text-center space-y-5">
                <div className="w-16 h-16 mx-auto bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-full flex items-center justify-center">
                  <div className={`w-8 h-8 border-2 ${identityBusy ? 'border-[var(--color-nexus-secondary)]/20 border-t-[var(--color-nexus-secondary)] animate-spin' : 'border-[var(--color-nexus-secondary)]'} rounded-full`} />
                </div>
                <p className="text-xs font-bold text-[var(--color-nexus-secondary)] font-mono uppercase tracking-wider h-6">● {status}</p>

                <div className="space-y-4">
                  <button
                    onClick={handleVerifyIdentity}
                    disabled={identityBusy || newDeviceBusy}
                    className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-4 font-bold text-sm uppercase tracking-wider transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_15px_rgba(37,99,235,0.3)] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {identityBusy ? 'Verifying...' : 'Verify With This Device'}
                  </button>

                  {/* Escape hatch for "this device doesn't have my passkey" —
                      a lost/new phone or a reinstalled browser looks exactly
                      like that to the user, with no way to tell it apart from
                      a plain cancel. Registering here adds this device as an
                      additional credential without touching the old one. */}
                  {showNewDeviceOption && (
                    <button
                      type="button"
                      onClick={handleRegisterNewDevice}
                      disabled={identityBusy || newDeviceBusy}
                      className="w-full bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] border border-[var(--color-nexus-border)] rounded-xl py-3 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {newDeviceBusy ? 'Registering...' : 'Using a New Device? Register It'}
                    </button>
                  )}

                  {/* Dynamic QR Attendance — alternative entry point; a
                      receptionist/security desk displaying a QR code is a
                      separate way to reach the same verification engine,
                      not a replacement for this direct flow. */}
                  <button
                    type="button"
                    onClick={() => navigate('/employee/qr-scan')}
                    className="w-full text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] text-xs font-bold uppercase tracking-wider py-2 transition-colors cursor-pointer"
                  >
                    Scan QR Code Instead
                  </button>

                  {/* Self-service opt-in for employees who registered a
                      device before their tenant turned Face Recognition on
                      (or who just prefer it) — RegisterDevice.tsx routes
                      here straight to FaceEnrollment since
                      faceRecognitionEnabled is a tenant-wide flag, not
                      conditioned on isKycCompleted. Hidden during the
                      camera-broken rescue path (faceCameraBroken) since
                      re-inviting them back into Face right after it just
                      failed would be confusing. */}
                  {user.faceRecognitionEnabled && user.verificationMethod !== 'face' && !faceCameraBroken && (
                    <button
                      type="button"
                      onClick={() => navigate('/employee/register-device')}
                      className="w-full text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] text-xs font-bold uppercase tracking-wider py-2 transition-colors cursor-pointer"
                    >
                      Switch to Face Recognition
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* STEP 2 — GPS */}
            {step === 'gps' && (
              <div className="py-10 text-center space-y-5">
                <div className="w-16 h-16 mx-auto bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-full flex items-center justify-center">
                  <div className={`w-8 h-8 border-2 ${loading ? 'border-[var(--color-nexus-secondary)]/20 border-t-[var(--color-nexus-secondary)] animate-spin' : 'border-[var(--color-nexus-secondary)]'} rounded-full`} />
                </div>
                <p className="text-xs font-bold text-[var(--color-nexus-secondary)] font-mono uppercase tracking-wider">● {status}</p>
                {!loading && error && (
                  <button
                    onClick={enterGpsStep}
                    className="w-full bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all border border-[var(--color-nexus-border)]"
                  >
                    Retry Location
                  </button>
                )}
              </div>
            )}

            {/* STEP 3 — Wi-Fi (only if enabled by the tenant admin) */}
            {step === 'wifi' && (
              <div className="py-8 text-center space-y-5">
                <div className="w-16 h-16 mx-auto bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-full flex items-center justify-center">
                  <div className={`w-8 h-8 border-2 ${loading ? 'border-[var(--color-nexus-secondary)]/20 border-t-[var(--color-nexus-secondary)] animate-spin' : 'border-[var(--color-nexus-secondary)]'} rounded-full`} />
                </div>
                <p className="text-xs font-bold text-[var(--color-nexus-secondary)] font-mono uppercase tracking-wider">● {status}</p>

                {/* Network Override — DEV ONLY. Letting any employee type an
                    arbitrary IP to claim to be on corporate Wi-Fi would
                    defeat network verification entirely, so this never
                    renders in a production build. Lives only on this
                    dedicated Wi-Fi step now, not inline with the camera. */}
                {import.meta.env.DEV && (
                  <div className="p-4 bg-[var(--color-nexus-secondary-container)] border border-[var(--color-nexus-secondary)]/40 rounded-2xl text-left">
                    <label className="block text-[9px] font-bold text-[var(--color-nexus-secondary)] uppercase tracking-widest mb-2 font-mono">Network Context Simulator (Dev Only)</label>
                    <input
                      type="text"
                      value={simulatedIp}
                      onChange={e => setSimulatedIp(e.target.value)}
                      placeholder="e.g. 192.168.1.50 (Corporate Wi-Fi IP)"
                      className="w-full bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-secondary)] placeholder:text-[var(--color-nexus-muted)]"
                    />
                    <button
                      type="button"
                      onClick={() => checkNetwork(simulatedIp)}
                      className="w-full mt-2 bg-[var(--color-nexus-surface)] hover:bg-[var(--color-nexus-secondary-container)] text-[var(--color-nexus-ink)] border border-[var(--color-nexus-secondary)]/60 hover:border-[var(--color-nexus-secondary)] rounded-xl py-2.5 px-4 text-xs font-bold uppercase tracking-wider transition-all"
                    >
                      Recheck With Simulated IP
                    </button>
                  </div>
                )}

                {!loading && error && (
                  <button
                    onClick={() => checkNetwork(simulatedIp)}
                    className="w-full bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all border border-[var(--color-nexus-border)]"
                  >
                    Retry Network Check
                  </button>
                )}
              </div>
            )}

            {/* Submitting */}
            {step === 'submitting' && (
              <div className="py-10 text-center space-y-5">
                <div className="w-10 h-10 mx-auto border-4 border-[var(--color-nexus-secondary)]/20 border-t-[var(--color-nexus-secondary)] rounded-full animate-spin"></div>
                <p className="text-xs font-bold text-[var(--color-nexus-secondary)] font-mono uppercase tracking-wider">● {status}</p>
              </div>
            )}

            {/* Late-arrival explanation — shown when the server flags this
                check-in as late; resubmits with the already-captured face
                token/GPS/Wi-Fi plus this explanation. */}
            {step === 'late_reason' && (
              <div className="py-4 space-y-5">
                <div className="p-4 bg-[var(--color-nexus-secondary-container)] border border-[var(--color-nexus-secondary)]/40 rounded-2xl text-center">
                  <p className="text-[9px] font-bold text-[var(--color-nexus-secondary)] uppercase tracking-widest mb-1 font-mono">Late Arrival</p>
                  <p className="text-xs text-[var(--color-nexus-ink)] font-medium">
                    You're checking in after the shift start time. Please explain why — your manager will review it, and you can keep working while it's pending.
                  </p>
                </div>
                <textarea
                  value={lateExplanation}
                  onChange={e => setLateExplanation(e.target.value)}
                  rows={4}
                  placeholder="e.g. Traffic delay, family emergency, etc."
                  className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)] resize-none"
                />
                <button
                  onClick={submitLateExplanation}
                  disabled={lateSubmitting || !lateExplanation.trim()}
                  className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-4 font-bold text-sm uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {lateSubmitting ? 'Submitting...' : 'Submit Explanation'}
                </button>
              </div>
            )}

            {identityVerified && step !== 'identity' && (
              <div className="mt-4 p-3.5 rounded-xl bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] text-[11px] font-mono flex justify-between items-center text-[var(--color-nexus-muted)]">
                <span>Device Identity</span>
                <span className="text-[var(--color-nexus-secondary)] font-semibold">Verified</span>
              </div>
            )}

            {/* Attendance correction request */}
            <div className="mt-6 pt-6 border-t border-[var(--color-nexus-border)]">
              <button
                onClick={() => setShowCorrectionModal(true)}
                className="w-full text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-primary)] text-xs font-bold uppercase tracking-wider py-2 transition-colors cursor-pointer"
              >
                Missed a check-in/out? Request a correction
              </button>
            </div>
          </>
        )}
          </>
        )}
      </motion.div>

      {/* Correction request modal */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
          <div className="max-w-md w-full bg-[var(--color-nexus-surface)] rounded-3xl p-8 shadow-[0_20px_60px_rgba(37,99,235,0.2)] border border-[var(--color-nexus-border)]">
            {correctionSubmitted ? (
              <div className="text-center py-6">
                <p className="text-[var(--color-nexus-secondary)] font-bold text-sm uppercase tracking-wider">Request submitted</p>
                <p className="text-[var(--color-nexus-muted)] text-xs mt-2">Your manager or admin will review it shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitCorrection}>
                <h3 className="text-[var(--color-nexus-ink)] font-bold text-sm uppercase tracking-wider mb-5">Request Attendance Correction</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-1.5">Issue Type</label>
                    <select
                      value={correctionType}
                      onChange={e => setCorrectionType(e.target.value)}
                      className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
                    >
                      <option value="missed_checkin">Missed Check-In</option>
                      <option value="missed_checkout">Missed Check-Out</option>
                      <option value="wrong_location">Wrong Location Flagged</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-1.5">Date</label>
                    <input
                      type="date"
                      value={correctionDate}
                      onChange={e => setCorrectionDate(e.target.value)}
                      className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-1.5">Time (optional)</label>
                    <input
                      type="time"
                      value={correctionTime}
                      onChange={e => setCorrectionTime(e.target.value)}
                      className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--color-nexus-muted)] uppercase tracking-widest mb-1.5">Explanation</label>
                    <textarea
                      value={correctionReason}
                      onChange={e => setCorrectionReason(e.target.value)}
                      rows={3}
                      className="w-full bg-[var(--color-nexus-surface-alt)] border border-[var(--color-nexus-border)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--color-nexus-ink)] focus:outline-none focus:border-[var(--color-nexus-primary)] resize-none"
                      placeholder="e.g. Phone died at 9am, couldn't check in until I found a charger."
                      required
                    />
                  </div>
                </div>
                {error && <p className="text-[var(--color-nexus-error)] text-[10px] mt-3">{error}</p>}
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowCorrectionModal(false)}
                    className="flex-1 bg-[var(--color-nexus-surface-alt)] hover:bg-[var(--color-nexus-border)] text-[var(--color-nexus-ink)] rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={correctionSubmitting}
                    className="flex-1 bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    {correctionSubmitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
