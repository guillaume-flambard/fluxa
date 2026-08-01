---
title: Fluxa
type: project
status: active
created: 2026-08-01
updated: 2026-08-01
tags: [design-system, webgl, shaders]
---

# Fluxa

Procedural organic design system. UI as a continuous reactive fluid simulated with **Raw WebGL2** heightmap waves (ping-pong FBO), not box-model chrome.

## Location

`~/projects/fluxa` : pnpm monorepo

- `@fluxa/core` : framework-agnostic engine
- `@fluxa/react` : Provider + Component bbox/a11y
- `apps/playground` : Vite demo

## Stack (locked)

Raw WebGL2 · TypeScript strict · wave physics on GPU · Vite playground  
No Next.js / Three.js / WebGPU / WASM in the foundation.

## Run

```bash
cd ~/projects/fluxa
pnpm install
pnpm dev          # playground :5173
pnpm storybook    # membrane + anima + lifecycle stories :6007
```

## Docs

Identity and phases: [`docs/anima-core.md`](docs/anima-core.md). Symbiosis throughline: [`docs/symbiosis-throughline.md`](docs/symbiosis-throughline.md). Agent contract: [`AGENTS.md`](AGENTS.md).

## Note

Started during PayKit bet freeze (J14) as an explicit override. Keep scope to Step 1 engine until freeze ends unless prioritized.
