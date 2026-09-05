#!/usr/bin/env bash
set -euo pipefail
npm run db:migration:build
npm run validate:static
npm run typecheck
npm run test
npm run lint
npm run build
