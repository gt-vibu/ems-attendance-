#!/bin/bash
set -e

# Create directories
mkdir -p apps/mobile apps/admin apps/backend apps/docs
mkdir -p packages/ui packages/auth packages/database packages/api packages/shared packages/types packages/validation packages/utils packages/config packages/hooks packages/constants packages/theme packages/eslint-config packages/tsconfig

# Create pnpm-workspace.yaml
cat << 'YAML' > pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
YAML

# Create turbo.json
cat << 'JSON' > turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!-node_modules"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
JSON

# Setup packages/tsconfig
cat << 'JSON' > packages/tsconfig/package.json
{
  "name": "@company/tsconfig",
  "version": "0.0.0",
  "private": true
}
JSON

cat << 'JSON' > packages/tsconfig/base.json
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
JSON

cat << 'JSON' > packages/tsconfig/react-library.json
{
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "emitDeclarationOnly": true
  }
}
JSON

# Move current app into apps/admin
# Note: we need to adapt package.json of apps/admin
mv src apps/admin/
mv index.html apps/admin/
mv vite.config.ts apps/admin/
mv tsconfig.json apps/admin/
# Copy the original package.json to apps/admin and modify it
cp package.json apps/admin/package.json

echo "Monorepo structure created."
