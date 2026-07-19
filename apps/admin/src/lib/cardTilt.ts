// Drives the real (subtle) 3D hover tilt for every `.card-3d` element
// app-wide via a single document-level listener, rather than requiring each
// page to wire its own mousemove handler — see the `.card-3d` rule in
// index.css, which reads the --tilt-x/--tilt-y custom properties this sets.
const MAX_TILT_DEG = 5;

let attached = false;

export function initCardTilt() {
  if (attached || typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  attached = true;

  let activeCard: HTMLElement | null = null;

  const clearTilt = (card: HTMLElement) => {
    card.style.removeProperty('--tilt-x');
    card.style.removeProperty('--tilt-y');
  };

  document.addEventListener('pointermove', (event) => {
    const target = event.target as HTMLElement | null;
    const card = target?.closest<HTMLElement>('.card-3d') ?? null;

    if (card !== activeCard && activeCard) {
      clearTilt(activeCard);
    }
    activeCard = card;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty('--tilt-y', `${(px * MAX_TILT_DEG * 2).toFixed(2)}deg`);
    card.style.setProperty('--tilt-x', `${(-py * MAX_TILT_DEG * 2).toFixed(2)}deg`);
  }, { passive: true });

  document.addEventListener('pointerleave', () => {
    if (activeCard) clearTilt(activeCard);
    activeCard = null;
  }, true);
}
