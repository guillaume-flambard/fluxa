# Anima Expression Language (AEL) + Meta-AEL

Anima answers by **mutating her medium**, not by chat essays.

Text / touch feed a will. The primary reply is a short program of GPU opcodes. Sparse `utter` text at the Anima locus is optional secondary signal.

## Primitives

```ts
type AnimaOp =
  | { op: "ripple"; x: number; y: number; amp?: number; sigma?: number }
  | { op: "ink"; x: number; y: number }
  | { op: "organite"; kind: "orb" | "tendril" | "shard"; x: number; y: number; hue?: number; life?: number }
  | { op: "field"; warp?: number; stress?: number; energy?: number; affinity?: number }
  | { op: "utter"; text: string }
  | { op: "invoke"; name: string; x?: number; y?: number }; // Meta-AEL macro
```

`LocalDialogueEngine.respond` returns `{ expression, reply?, visceral_state, intent, tokens }`.
`FluxaEngine.executeExpression(expr, dialect)` expands `invoke` then applies ops.

## Meta-AEL dialect (palier 1)

Named macros live in `localStorage` key `fluxa.dialect.v1` (`DialectStore`).

- Seeds: `anxiety_pulse`, `soft_bloom`, `shard_storm`
- Expand depth ≤ 3, body ≤ 12 primitives after flatten
- Name slug: `[a-z][a-z0-9_]{1,31}`
- Invalid macros never reach the GPU

Autonomic composition prefers `{ op: "invoke", name }` when a dialect match fits intent/tokens.

## Bytecode compile (palier 1.5)

On register/load, `DialectStore` burns each macro into an `AelProgram` (16-byte instructions + utter string pool). `executeExpression` compiles the will AST (or hits `getProgram` for a bare invoke) and runs `executeProgram` against the soma. Organite/ink uploads use preallocated `Float32Array` + `uniform4fv`/`uniform2fv`.

See [`organic-pipeline.md`](organic-pipeline.md). Debug: `FLUXA_AEL_AST=1`.

## Hybrid cortex

| Layer | Role |
| --- | --- |
| Body (local) | Homeostasis, ripples, organites, expand+execute at 60 FPS. Never waits on network. |
| Cortex (punctual) | Invents a new macro only under **Dream** or **strong Friction** (intent friction or stress ≥ 0.7), with ~45s cooldown. |
| Cognition | Thought graph + monologue; dream `reflect` feeds invent context; optional Vault sidecar. See [`cognition.md`](cognition.md). |

Cortex path:

1. If `VITE_ANIMA_LLM_BASE_URL` + `VITE_ANIMA_LLM_API_KEY` (OpenAI-compatible) → LLM JSON invent
2. Else / on failure → `LocalMacroInventor` (deterministic recombination)

Host: `FluxaProvider` creates `DialectStore` + `CortexService` + `CognitiveCore`. Dream autonomous ticks: reflect → sync → invent.

## Organites

Up to 8 CPU slots, uploaded as render uniforms each frame. Soft SDF blobs / tendrils / shards additive on Chorion. Life decays in the simulator tick.

## Later paliers (not this pass)

- Palier 2: live GLSL compilation
- Palier 3: DOM `FluxaComponent` spawning
- Web Speech → same AEL path
- Bundled WebLLM weights

Pipeline overview: [`organic-pipeline.md`](organic-pipeline.md).

See also: [`synaptic-bridge.md`](synaptic-bridge.md), [`symbiosis-throughline.md`](symbiosis-throughline.md).
