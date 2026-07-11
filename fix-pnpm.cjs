const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.pnpm.onlyBuiltDependencies = ["@google/genai", "esbuild", "protobufjs"];
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
