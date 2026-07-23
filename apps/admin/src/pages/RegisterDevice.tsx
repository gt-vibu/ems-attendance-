import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { User } from '../lib/auth';
import FloatingOrbs from '../components/FloatingOrbs';
import { registerThisDevice, describeWebAuthnError, browserSupportsWebAuthn } from '../lib/webauthnClient';
import FaceEnrollment from './FaceEnrollment';

export default function RegisterDevice({ user, updateSession }: { user: User, updateSession: (u: User) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Tenants that opted into face_recognition use it as the default/required
  // identity check for new users — WebAuthn is offered only as an explicit
  // rescue if the camera doesn't work (see FaceEnrollment's
  // onUseDeviceInstead), never as a competing chooser shown upfront.
  const [forceDeviceVerification, setForceDeviceVerification] = useState(false);
  const navigate = useNavigate();

  const supported = browserSupportsWebAuthn();

  if (user.faceRecognitionEnabled && !forceDeviceVerification) {
    return (
      <FaceEnrollment
        user={user}
        updateSession={updateSession}
        onUseDeviceInstead={() => setForceDeviceVerification(true)}
      />
    );
  }

  const handleRegister = async () => {
    setSubmitting(true);
    setError('');
    try {
      const deviceName = navigator.platform || navigator.userAgent.slice(0, 40);
      const data = await registerThisDevice(deviceName);
      setDone(true);
      updateSession(data.user);
      setTimeout(() => {
        navigate('/employee/attendance');
      }, 800);
    } catch (err) {
      setError(describeWebAuthnError(err));
      setSubmitting(false);
    }
  };

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
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-[var(--color-nexus-ink)]">Register This Device</h1>
          <p className="text-sm text-[var(--color-nexus-muted)] mt-2 font-medium">
            One-time setup. Attendance uses your device's own security — Windows Hello,
            Touch ID, fingerprint, or your device PIN — instead of a camera. Nothing about
            your face or fingerprint is ever sent to or stored on our servers.
          </p>
        </div>

        {!supported && (
          <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-nexus-error)]/20 font-medium">
            This browser doesn't support device-based verification. Please use a recent version of Chrome, Edge, Safari, or Firefox.
          </div>
        )}

        {error && (
          <div className="bg-[var(--color-nexus-error-soft)] text-[var(--color-nexus-error)] text-xs p-3 rounded-lg mb-6 border border-[var(--color-nexus-error)]/20 font-medium">
            {error}
          </div>
        )}

        <div className="mb-6 rounded-2xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)] p-6 text-center">
          <p className="text-[10px] tracking-widest uppercase font-extrabold text-[var(--color-nexus-secondary)] mb-1">
            {done ? 'All set' : submitting ? 'Waiting for your device' : 'Before you start'}
          </p>
          <h5 className="font-sans font-bold text-lg tracking-tight text-[var(--color-nexus-ink)]">
            {done
              ? 'Device registered successfully'
              : submitting
                ? 'Follow the prompt shown by your device'
                : "You'll be asked to verify with your device's lock screen"}
          </h5>
          <p className="text-[12px] text-[var(--color-nexus-muted)] mt-1">
            {done
              ? 'Taking you to attendance...'
              : submitting
                ? 'A system prompt should appear now — approve it with your fingerprint, face, or PIN.'
                : 'This device becomes your registered check-in device, same as before.'}
          </p>
        </div>

        <button
          onClick={handleRegister}
          disabled={!supported || submitting || done}
          className="w-full bg-[var(--color-nexus-primary)] hover:bg-[var(--color-nexus-primary-hover)] text-white rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {done ? 'Registered' : submitting ? 'Verifying...' : 'Register This Device'}
        </button>
      </motion.div>
    </div>
  );
}
