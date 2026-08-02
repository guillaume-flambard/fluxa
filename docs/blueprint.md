===============================================================================
                          FLUXA DESIGN SYSTEM
                   ARCHITECTURE & TECHNICAL BLUEPRINT
===============================================================================

1. OVERVIEW & PHILOSOPHY
-------------------------------------------------------------------------------
Fluxa est un design system procédural et organique bas-niveau. Contrairement aux
design systems traditionnels basés sur des boîtes rigides (box-model/CSS) ou du
vectoriel statique, Fluxa traite l'UI comme un fluide réactif continu.

Chaque composant (bouton, champ de saisie, carte) est une perturbation locale
dans un champ scalaire simulé en temps réel via WebGL et Shaders GLSL.
Les interactions utilisateur (clics, mouvements de pointeur, frappe clavier)
agissent comme des forces physiques ("ricochets") générant des ondes de propagation.

-------------------------------------------------------------------------------
2. TECH STACK & ENGINE ARCHITECTURE (LOCKED v0.1)
-------------------------------------------------------------------------------
- Repo: pnpm monorepo — packages/core, packages/react, apps/playground
- Core Render Engine: Raw WebGL 2.0 (no Three.js / WebGPU in v1)
- Physics: wave equation 100% in fragment shaders (no WASM in v1)
- Events: JS RippleManager → GPU impulse uploads
- Meta-AEL: cortex AST → compiler bytecode → soma (see docs/organic-pipeline.md)
- React: thin @fluxa/react (DOM/A11y + bbox); playground = Vite
- Out of scope v1: Next.js, Three.js, WebGPU, WASM, Storybook (later)

+-----------------------------------------------------------------------------+
|                                DOM / REACT                                  |
|  - Layout invisible & Accessibilité (A11y ARIA Nodes)                        |
|  - Event Capturing Pipeline (Pointer, Touch, Audio)                         |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                           FLUXA CORE STATE & MATH                           |
|  - Ripple Data Queue (Position, Energy, Frequency, Decay)                   |
|  - Fluid Dynamics Simulation Grid / Heightmap Buffers                       |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                             WEBGL SHADER PIPELINE                           |
|  - Vertex Shader : Grid displacement & distortion                           |
|  - Fragment Shader : Refraction, SDF (Signed Distance Fields), Caustics     |
+-----------------------------------------------------------------------------+

-------------------------------------------------------------------------------
3. CORE MECHANICS & PHYSICS SIMULATION
-------------------------------------------------------------------------------
3.1. Wave Equation & Propagation
Ping-pong RG32F FBOs. R = height(t), G = height(t-1).

    H_new = (H_left + H_right + H_top + H_bottom) / 2 - H_prev
    H_new = H_new * Damping_Factor

3.2. Interaction Event Mapping ("The Ricochet Effect")
- Pointer Move : micro-waves (low amplitude)
- Pointer Click : Gaussian impulse
- Keypress / Audio : deferred (later)

-------------------------------------------------------------------------------
4. SHADER SPECIFICATIONS
-------------------------------------------------------------------------------
SDF smooth-union, refraction, caustics = Step 2+.
Step 1 ships wave + normal-shaded render passes only.

-------------------------------------------------------------------------------
5. COMPONENT SYSTEM
-------------------------------------------------------------------------------
- FluxaProvider: fullscreen canvas, rAF, ripple queue
- FluxaComponent: headless bbox registration + semantic DOM
- FluidButton / MorphCard / RippleInput: Step 4

-------------------------------------------------------------------------------
6. INTEGRATION ROADMAP
-------------------------------------------------------------------------------
[STEP 1] Engine base — DONE (this scaffold)
[STEP 2] Optical render (normals, refraction, liquid glass)
[STEP 3] Richer event engine (keydown, audio)
[STEP 4] Component abstraction + Storybook
[STEP 5] Rest detection (partially in Step 1) + CSS/Canvas2D fallback
===============================================================================
