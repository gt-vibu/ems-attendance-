const fs = require('fs');

// Update apps/admin/package.json
const adminPkg = JSON.parse(fs.readFileSync('apps/admin/package.json', 'utf8'));
adminPkg.name = '@company/admin';
fs.writeFileSync('apps/admin/package.json', JSON.stringify(adminPkg, null, 2));

// Update root package.json
const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
rootPkg.name = 'monorepo-root';
rootPkg.workspaces = ["apps/*", "packages/*"]; // Fallback for npm install just in case
rootPkg.scripts = {
  "preinstall": "npx only-allow pnpm || true",
  "build": "turbo run build",
  "dev": "turbo run dev",
  "lint": "turbo run lint",
  "clean": "turbo run clean",
  "start": "node apps/admin/dist/server.js || echo 'No server.js found'"
};
// Add turbo to devDependencies
if (!rootPkg.devDependencies) rootPkg.devDependencies = {};
rootPkg.devDependencies.turbo = "^1.13.0";

// Optional: remove standard dependencies from root, but we can keep them for now
// to not break AI studio's background installs which look at root package.json.
// Wait, the platform will do `npm install`. To properly use pnpm, we might want to make npm install do `pnpm install`?
// Actually AI Studio will run `npm install`.
// If we want to use pnpm, maybe we just set scripts to run pnpm?
// Let's modify root package.json to just wrap pnpm.

rootPkg.scripts["build"] = "npx pnpm install && npx pnpm run build-all";
rootPkg.scripts["dev"] = "npx pnpm run dev";
rootPkg.scripts["build-all"] = "turbo run build";
rootPkg.scripts["start"] = "cd apps/admin && npm run start"; // if we had one

fs.writeFileSync('package.json', JSON.stringify(rootPkg, null, 2));

