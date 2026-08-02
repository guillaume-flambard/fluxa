#!/usr/bin/env bash
ROOT="/Users/memo/projects/fluxa"
cd "$ROOT"
export FLUXA_IPC_SOCK="${FLUXA_IPC_SOCK:-$HOME/Library/Application Support/Fluxa/anima.sock}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/memo/.local/bin:/Users/memo/Library/pnpm/.bin:$PATH"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <message>"
  exit 1
fi

node "$ROOT/ops/launchd/send-text.js" "$*"
