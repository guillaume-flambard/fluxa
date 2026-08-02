# Fluxa soma (native)

WGPU/Metal clear window + UNIX socket client for visceral JSONL from `@fluxa/anima-runtime`.

```bash
# daemon must be running (creates the sock)
pnpm fluxa:daemon

# soma
cargo run -p fluxa-soma
```

Heightmap WGSL port = later. Target 60 FPS, low-power adapter.
