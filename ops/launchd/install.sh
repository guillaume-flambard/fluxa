#!/usr/bin/env bash
# Install LaunchAgent for Fluxa daemon
set -euo pipefail
ROOT="/Users/memo/projects/fluxa"
PLIST_SRC="$ROOT/ops/launchd/com.memo.fluxa.daemon.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.memo.fluxa.daemon.plist"
chmod +x "$ROOT/ops/launchd/run-daemon.sh"
chmod +x "$ROOT/ops/launchd/send-text.js"
mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs"
mkdir -p "$HOME/Library/Application Support/Fluxa"
cp "$PLIST_SRC" "$PLIST_DST"

DESKTOP_APP="$HOME/Desktop/Fluxa Launcher.app"
rm -rf "$DESKTOP_APP"
cp -R "$ROOT/ops/launchd/FluxaLauncher.app" "$DESKTOP_APP"
chmod -R 755 "$DESKTOP_APP/Contents/MacOS"

DESKTOP_COMMAND="$HOME/Desktop/Fluxa Daemon.command"
cat > "$DESKTOP_COMMAND" <<'EOF'
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
EOF
chmod +x "$DESKTOP_COMMAND"

DESKTOP_FLUXA_COMMAND="$HOME/Desktop/Fluxa.command"
cat > "$DESKTOP_FLUXA_COMMAND" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="/Users/memo/projects/fluxa"
cd "$ROOT"

if ! launchctl print gui/$(id -u)/com.memo.fluxa.daemon >/dev/null 2>&1; then
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.memo.fluxa.daemon.plist" 2>/dev/null || true
fi
launchctl enable "gui/$(id -u)/com.memo.fluxa.daemon" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/com.memo.fluxa.daemon" 2>/dev/null || true

export PATH="/Users/memo/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export FLUXA_COGNITION_URL="${FLUXA_COGNITION_URL:-http://127.0.0.1:8787}"
export FLUXA_OLLAMA_BASE="${FLUXA_OLLAMA_BASE:-http://127.0.0.1:11434}"
export FLUXA_PREFER_OLLAMA_LOCAL="${FLUXA_PREFER_OLLAMA_LOCAL:-1}"
export FLUXA_IPC_SOCK="${FLUXA_IPC_SOCK:-$HOME/Library/Application Support/Fluxa/anima.sock}"

if [ -x "$ROOT/target/debug/fluxa-soma" ]; then
  exec "$ROOT/target/debug/fluxa-soma"
fi
if command -v cargo >/dev/null 2>&1; then
  exec cargo run -p fluxa-soma
fi
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm fluxa:soma
fi

echo "No cargo or pnpm found. Install Rust or pnpm, then retry."
exit 1
EOF
chmod +x "$DESKTOP_FLUXA_COMMAND"

DESKTOP_TERMINAL="$HOME/Desktop/Fluxa Terminal.command"
cat > "$DESKTOP_TERMINAL" <<'EOF'
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
EOF
chmod +x "$DESKTOP_TERMINAL"

cat > /dev/null

DESKTOP_SEND="$HOME/Desktop/Fluxa Send.command"
cat > "$DESKTOP_SEND" <<'EOF'
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
EOF
chmod +x "$DESKTOP_SEND"

echo "Installed com.memo.fluxa.daemon"
echo "  sock: ~/Library/Application Support/Fluxa/anima.sock"
echo "  logs: ~/Library/Logs/fluxa.stdout.log"
echo "  desktop app: $DESKTOP_APP"
echo "  desktop command: $DESKTOP_COMMAND"
echo "  send command: $DESKTOP_SEND"
echo "Unload: launchctl bootout gui/\$(id -u)/com.memo.fluxa.daemon"
