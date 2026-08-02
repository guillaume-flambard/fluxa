# Fluxa LaunchAgent (palier 2.0)

## Install

```bash
# Terminal 1 — cognition sidecar (Vault / matter)
pnpm --filter @fluxa/cognition-sidecar start

# Install + start daemon under launchd
chmod +x ops/launchd/*.sh
./ops/launchd/install.sh
```

After install, the desktop launcher is available at `~/Desktop/Fluxa Launcher.app`, a desktop app script is available at `~/Desktop/Fluxa.command`, and a direct text-send helper is available at `~/Desktop/Fluxa Send.command`.

You can also run the native soma client with:

```bash
pnpm fluxa:soma
```

To send a text message directly to the daemon from terminal:

```bash
pnpm fluxa:send "Bonjour Fluxa"
```

## Manual (foreground)

```bash
pnpm fluxa:daemon
```

## Socket IPC

Path: `~/Library/Application Support/Fluxa/anima.sock`

JSON lines (one snapshot per sovereign pulse):

```json
{"ts":...,"thought":"...","action":"silence|speak|...","reason":"...","desires":{"silence":0.9,"speak":0.1,"create":0.2},"visceral":{"stress":0.3,"energy":0.5,"affinity":0.5}}
```

Listen:

```bash
nc -U "$HOME/Library/Application Support/Fluxa/anima.sock"
# or: cargo run -p fluxa-soma   (IPC client stub)
```

## Unload

```bash
launchctl bootout "gui/$(id -u)/com.memo.fluxa.daemon"
```
