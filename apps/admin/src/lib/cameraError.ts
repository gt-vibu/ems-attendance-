// Turns a getUserMedia() rejection into an actionable message. Browsers
// intentionally refuse to re-show their own permission dialog once a user
// has explicitly clicked "Block" for an origin — no amount of retrying
// getUserMedia() from app code can bring it back, by design (otherwise a
// site could spam the prompt until someone accidentally allowed it). Once
// that's happened, the ONLY way to see the prompt again is for the user to
// reset the site's camera permission from the browser's own UI, so that's
// what this message walks them through instead of just repeating "denied".
export function describeCameraError(err: unknown): string {
  const name = (err as any)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera access is blocked for this site. Click the camera icon (or the padlock) in your browser\'s address bar, allow Camera, then reload this page.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. Connect a camera and try again.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is already in use by another app or browser tab. Close it and try again.';
  }
  return 'Camera access denied.';
}
