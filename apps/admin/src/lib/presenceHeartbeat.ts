// ═══════════════════════════════════════════════════════════════════════
// PRESENCE HEARTBEAT WORKER — Client-side in-app activity & heartbeat module.
//
// PRIVACY GUARANTEE:
// Listens ONLY to DOM interaction events occurring WITHIN the EMS web application
// (mousemove, keydown, click, scroll, touchstart, visibilitychange).
// NEVER monitors external apps, background tabs, personal files, or external URLs.
// ═══════════════════════════════════════════════════════════════════════

let isStarted = false;
let heartbeatTimer: any = null;
let lastInteractionTs = Date.now();
let latestGpsCoords: { lat: number; lng: number } | null = null;

function handleInteraction() {
  lastInteractionTs = Date.now();
}

function handleVisibilityChange() {
  lastInteractionTs = Date.now();
}

export interface PresenceStatusUpdate {
  presenceState: string;
  confidenceScore: number;
  warning: {
    id: number;
    warnedAt: string;
    expiresAt: string;
    remainingMins: number;
  } | null;
  signals: Record<string, any>;
}

export function startPresenceHeartbeat(intervalSec = 60) {
  if (isStarted) return;
  isStarted = true;
  lastInteractionTs = Date.now();

  // Attach in-app DOM listeners
  window.addEventListener('mousemove', handleInteraction, { passive: true });
  window.addEventListener('keydown', handleInteraction, { passive: true });
  window.addEventListener('click', handleInteraction, { passive: true });
  window.addEventListener('scroll', handleInteraction, { passive: true });
  window.addEventListener('touchstart', handleInteraction, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Optional background GPS acquisition if available
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { latestGpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
      () => {},
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
    );
  }

  // Initial heartbeat send
  sendHeartbeat();

  // Start periodic timer
  heartbeatTimer = setInterval(sendHeartbeat, Math.max(15, intervalSec) * 1000);
}

export function stopPresenceHeartbeat() {
  if (!isStarted) return;
  isStarted = false;

  window.removeEventListener('mousemove', handleInteraction);
  window.removeEventListener('keydown', handleInteraction);
  window.removeEventListener('click', handleInteraction);
  window.removeEventListener('scroll', handleInteraction);
  window.removeEventListener('touchstart', handleInteraction);
  document.removeEventListener('visibilitychange', handleVisibilityChange);

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export async function sendHeartbeat(): Promise<PresenceStatusUpdate | null> {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;

  try {
    const body: any = {
      lastInteractionTs,
    };

    if (latestGpsCoords) {
      body.lat = latestGpsCoords.lat;
      body.lng = latestGpsCoords.lng;
    }

    const res = await fetch('/api/attendance/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;

    const data: PresenceStatusUpdate = await res.json();

    // Dispatch custom event for UI components to listen to
    window.dispatchEvent(
      new CustomEvent('presence-status-updated', { detail: data })
    );

    return data;
  } catch (err) {
    console.error('[presenceHeartbeat] heartbeat send error:', err);
    return null;
  }
}

export async function confirmWorking(): Promise<boolean> {
  const token = localStorage.getItem('auth_token');
  if (!token) return false;

  try {
    const res = await fetch('/api/attendance/presence/confirm-working', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return false;

    // Immediately trigger a fresh heartbeat
    sendHeartbeat();
    return true;
  } catch (err) {
    console.error('[presenceHeartbeat] confirmWorking error:', err);
    return false;
  }
}
