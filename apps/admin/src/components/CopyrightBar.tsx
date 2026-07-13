/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export default function CopyrightBar() {
  return (
    <div className="w-full bg-slate-50 border-t border-slate-200 py-6 px-6 select-none">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-mono text-slate-500">
        <span>© {new Date().getFullYear()} Smart Teams, Inc. All rights reserved.</span>
        <span className="font-sans font-medium text-slate-400">
          Made for distributed field-services & retail operators.
        </span>
      </div>
    </div>
  );
}
