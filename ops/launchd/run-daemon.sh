#!/usr/bin/env bash
# Launch Fluxa sovereign daemon (palier 2.0)
set -euo pipefail
ROOT="/Users/memo/projects/fluxa"
cd "$ROOT"
export FLUXA_COGNITION_URL="${FLUXA_COGNITION_URL:-http://127.0.0.1:8787}"
export FLUXA_OLLAMA_BASE="${FLUXA_OLLAMA_BASE:-http://127.0.0.1:11434}"
export FLUXA_PREFER_OLLAMA_LOCAL="${FLUXA_PREFER_OLLAMA_LOCAL:-1}"
export PATH="/Users/memo/Library/pnpm/.bin:/Users/memo/Library/pnpm/.tools/pnpm/10.14.0/node_modules/pnpm/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
exec "/Users/memo/Library/pnpm/.tools/pnpm/10.14.0/node_modules/pnpm/bin/pnpm.cjs" --filter @fluxa/anima-runtime start
