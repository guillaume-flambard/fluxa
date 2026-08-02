#!/usr/bin/env bash
ROOT="/Users/memo/projects/fluxa"
cd "$ROOT"
export FLUXA_COGNITION_URL="${FLUXA_COGNITION_URL:-http://127.0.0.1:8787}"
export FLUXA_OLLAMA_BASE="${FLUXA_OLLAMA_BASE:-http://127.0.0.1:11434}"
export FLUXA_PREFER_OLLAMA_LOCAL="${FLUXA_PREFER_OLLAMA_LOCAL:-1}"
export FLUXA_IPC_SOCK="${FLUXA_IPC_SOCK:-$HOME/Library/Application Support/Fluxa/anima.sock}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/memo/.local/bin:/Users/memo/Library/pnpm/.bin:/Users/memo/Library/pnpm/.tools/pnpm/10.14.0/node_modules/pnpm/bin:$PATH"

if [ -z "$(command -v pnpm)" ]; then
  PNPM_BIN="/Users/memo/Library/pnpm/.tools/pnpm/10.14.0/node_modules/pnpm/bin/pnpm.cjs"
else
  PNPM_BIN="$(command -v pnpm)"
fi

# Ensure daemon is started under launchd
if ! launchctl print gui/$(id -u)/com.memo.fluxa.daemon >/dev/null 2>&1; then
  launchctl bootstrap "gui/$(id -u)" "$ROOT/ops/launchd/com.memo.fluxa.daemon.plist" 2>/dev/null || true
fi

exec "$PNPM_BIN" fluxa:soma
