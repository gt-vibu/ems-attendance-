/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export default function CopyrightBar() {
  return (
    <div className="w-full bg-[var(--color-premium-surface-alt)] border-t border-[var(--color-premium-border)] py-6 px-6 select-none">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-[var(--color-premium-muted)] font-medium">
        <span>© {new Date().getFullYear()} Smart Teams, Inc. All rights reserved.</span>
        <span className="font-sans font-medium text-[var(--color-premium-muted)]/70">
          Made for distributed field-services & retail operators.
        </span>
      </div>
    </div>
  );
}
