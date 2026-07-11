// Pure-CSS floating gradient orbs — the "floating objects" ambience without
// any WebGL, so it's safe to mount even on the live-camera pages (KYC /
// attendance) where a Three.js canvas would fight the camera for GPU on
// low-end phones. Decorative only: fixed, behind everything, non-interactive,
// and calmed automatically by the prefers-reduced-motion rules in index.css.
export default function FloatingOrbs() {
  return (
    <div className="fixed inset-0 -z-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="float-a absolute -top-10 -left-8 w-56 h-56 rounded-full blur-3xl opacity-40"
        style={{ background: 'radial-gradient(circle at 30% 30%, #7B5CFA, transparent 70%)' }} />
      <div className="float-b absolute top-1/3 -right-12 w-72 h-72 rounded-full blur-3xl opacity-35"
        style={{ background: 'radial-gradient(circle at 60% 40%, #22C7B8, transparent 70%)' }} />
      <div className="float-c absolute -bottom-16 left-1/4 w-64 h-64 rounded-full blur-3xl opacity-30"
        style={{ background: 'radial-gradient(circle at 50% 50%, #F5B94D, transparent 70%)' }} />
    </div>
  );
}
