#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/core"
npm test
node --check "$ROOT/apps/api/src/server.js"
node --check "$ROOT/apps/web/app.js"
echo "REGRESSION_OK"
