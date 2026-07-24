/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Static replacement for the previous 3D bezier-path "flight path" scene —
// same five real steps of a shift's lifecycle, presented as a plain
// numbered flow instead of an animated WebGL curve.
const STEPS = [
  { label: 'Check-In', caption: 'Face and device checks begin.' },
  { label: 'Verification', caption: 'Liveness and location are confirmed.' },
  { label: 'Active Duty', caption: 'Location is actively tracked.' },
  { label: 'Break', caption: 'Time away is reconciled.' },
  { label: 'Check-Out', caption: 'The record is sealed and versioned.' },
];

export default function ProcessSteps() {
  return (
    <div className="max-w-5xl mx-auto px-6">
      <div className="text-center mb-10 space-y-2">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--color-premium-accent)]">How it works</span>
        <h2 className="font-display font-semibold text-2xl md:text-3xl text-[var(--color-premium-ink)] tracking-tight">
          One shift, five verified steps
        </h2>
      </div>
      <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-0">
        {STEPS.map((step, i) => (
          <div key={step.label} className="flex-1 flex md:flex-col items-start md:items-center gap-4 md:gap-0 relative">
            {i > 0 && (
              <div className="hidden md:block absolute top-5 right-1/2 w-full h-px bg-[var(--color-premium-border)] -z-10" />
            )}
            <span className="shrink-0 w-10 h-10 rounded-full bg-[var(--color-premium-accent)] text-white font-bold text-sm flex items-center justify-center">
              {i + 1}
            </span>
            <div className="md:mt-4 md:text-center">
              <p className="text-sm font-bold text-[var(--color-premium-ink)]">{step.label}</p>
              <p className="text-[12px] text-[var(--color-premium-muted)] mt-0.5 md:max-w-[160px]">{step.caption}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
