const fs = require('fs');
const path = require('path');

const packages = [
  'ui', 'auth', 'database', 'api', 'shared', 'types', 'validation', 'utils', 'config', 'hooks', 'constants', 'theme', 'eslint-config'
];

packages.forEach(pkg => {
  const dir = path.join('packages', pkg);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const pkgJson = {
    name: `@company/${pkg}`,
    version: "0.0.0",
    private: true,
    main: "src/index.ts",
    types: "src/index.ts",
    scripts: {
      lint: "tsc --noEmit"
    }
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  
  const srcDir = path.join(dir, 'src');
  if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'index.ts'), `export const ${pkg.replace(/-/g, '')} = "${pkg}";\n`);
});

const apps = ['mobile', 'backend', 'docs'];
apps.forEach(app => {
  const dir = path.join('apps', app);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const pkgJson = {
    name: `@company/${app}`,
    version: "0.0.0",
    private: true,
    scripts: {}
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
});
