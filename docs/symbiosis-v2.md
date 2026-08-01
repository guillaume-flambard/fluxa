# Fluxa v2 — Symbiosis Architecture

Blueprint pour interface biologique. Quatre couches du macro au micro.

## Hiérarchie

1. **Macro — Slime Mold Routing** (React state & layout) — deferred
2. **Meso — Soft-Body & Metaballs** (SDF geometry) — deferred
3. **Micro — Reaction-Diffusion & Ricochets** (ping-pong fragment) — waves live; Gray-Scott deferred
4. **Temps — Homeostasis Engine** (rAF / uniforms) — **implemented first**

## Pipeline DOM → GPU

1. React / pointer events inject impulses + excite stress
2. Homeostasis updates `u_stress`, `u_breath`, `u_energy`
3. Wave + render shaders consume uniforms
4. Semantic DOM stays for a11y (invisible overlay)

## Math

See [formules-math.md](./formules-math.md).
