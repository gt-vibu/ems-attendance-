export async function ensureFaceServiceReady(): Promise<void> {
  const res = await fetch('/api/health/face');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Face verification service is unavailable right now.');
  }
  if (!data.modelLoaded) {
    throw new Error('Face verification model is still loading. Please try again in a moment.');
  }
}
