#!/usr/bin/env bash
ROOT="/Users/memo/projects/fluxa"
cd "$ROOT"
export FLUXA_COGNITION_URL="${FLUXA_COGNITION_URL:-http://127.0.0.1:8787}"
export FLUXA_OLLAMA_BASE="${FLUXA_OLLAMA_BASE:-http://127.0.0.1:11434}"
export FLUXA_PREFER_OLLAMA_LOCAL="${FLUXA_PREFER_OLLAMA_LOCAL:-1}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/memo/.local/bin:/Users/memo/Library/pnpm/.bin:/Users/memo/Library/pnpm/.tools/pnpm/10.14.0/node_modules/pnpm/bin:$PATH"
PNPM_BIN="$(command -v pnpm || true)"
if [ -z "$PNPM_BIN" ]; then
  PNPM_BIN="/Users/memo/Library/pnpm/.tools/pnpm/10.14.0/node_modules/pnpm/bin/pnpm.cjs"
fi
exec "$PNPM_BIN" --filter @fluxa/anima-runtime start
