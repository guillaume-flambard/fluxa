# Formules mathématiques — Fluxa

Référence pour shaders GLSL et architecture TypeScript.

## 1. Gray-Scott (Reaction-Diffusion) — deferred

Pearson, J. E. (1993). *Complex patterns in a simple system*. Science.

$$
\frac{\partial u}{\partial t} = D_u \nabla^2 u - u v^2 + F(1 - u)
$$

$$
\frac{\partial v}{\partial t} = D_v \nabla^2 v + u v^2 - (F + k)v
$$

Stub uniforms (unused this pass): `u_feed` (F), `u_kill` (k).

## 2. SDF Smooth Minimum (Metaballs) — deferred

Blinn, J. F. (1982). *A generalization of algebraic surface drawing*.

$$
h = \mathrm{clamp}\bigl(0.5 + 0.5\cdot(d_2-d_1)/k,\ 0,\ 1\bigr)
$$

$$
\mathrm{smin}(d_1,d_2,k) = \mathrm{mix}(d_2,d_1,h) - k\cdot h\cdot(1-h)
$$

## 3. Wave / Ricochets

Historical Hugo Elias form (doc only):

$$
h^{t+1} = \frac{h_L+h_R+h_U+h_D}{2} - h^{t-1},\quad h^{t+1}\leftarrow \mu\, h^{t+1}
$$

**Production (Fluxa core):** damped FTCS

$$
h^{n+1} = \frac{2h^n - (1-\gamma)h^{n-1} + r^2\nabla^2 h^n}{1+\gamma}
\quad(r^2\le 0.5)
$$

Refs: Tessendorf (2001); mysimulator.uk wave equation notes.

## 4. Physarum tube adaptation — deferred

Tero et al. (2010). *Rules for biologically inspired adaptive network design*.

$$
\frac{d D_{ij}}{dt} = f(|Q_{ij}|) - \gamma D_{ij}
$$

## 5. Homeostasis (implemented)

Excitation decays toward baseline while idle:

$$
S(t) \rightarrow S_{\mathrm{base}}\ \text{via}\quad
S \mathrel{+}= (S_{\mathrm{base}}-S)\,(1-e^{-\lambda\,\Delta t})
$$

On event: `t_idle = 0`, `S = min(S_max, S + δ)`.

Vital pulse (phase-integral breath):

$$
P(t) = \sin\Bigl(2\pi \int_0^t f(S(\tau))\,d\tau\Bigr)
$$

Discrete: `phase += (f0 + fGain·S)·dt`, `breath = sin(2π·phase)`.

Uniforms: `u_stress = S`, `u_breath = P`, `u_energy` derived.
