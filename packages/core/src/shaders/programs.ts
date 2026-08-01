export const FULLSCREEN_VERT = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * FTCS discretisation of the damped 2D wave equation:
 *   ∂²h/∂t² + 2γ ∂h/∂t = c² ∇²h
 *
 * h^{n+1} = (2 h^n − (1−γ) h^{n−1} + r² ∇²h^n) / (1+γ)
 * with r² = (c Δt / Δx)² ≤ 0.5 for 2D CFL stability.
 *
 * State texture: R = h(t), G = h(t−1).
 */
export const WAVE_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_r2;      // Courant² (wave speed), keep ≤ 0.5
uniform float u_gamma;   // viscous damping γ (small, e.g. 0.01–0.04)
uniform float u_sponge;  // edge sponge width in UV (0 = off)

void main() {
  vec2 state = texture(u_state, v_uv).rg;
  float h = state.r;
  float hPrev = state.g;

  float hL = texture(u_state, v_uv + vec2(-u_texel.x, 0.0)).r;
  float hR = texture(u_state, v_uv + vec2( u_texel.x, 0.0)).r;
  float hD = texture(u_state, v_uv + vec2(0.0, -u_texel.y)).r;
  float hU = texture(u_state, v_uv + vec2(0.0,  u_texel.y)).r;

  float laplacian = hL + hR + hD + hU - 4.0 * h;

  // Viscous FTCS (mysimulator.uk / damped wave equation)
  float hNew = (2.0 * h - (1.0 - u_gamma) * hPrev + u_r2 * laplacian)
             / (1.0 + u_gamma);

  // Absorbing sponge near borders — open-water feel, less hard reflections
  if (u_sponge > 1e-5) {
    float edge = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
    float t = clamp(edge / u_sponge, 0.0, 1.0);
    float sponge = t * t * (3.0 - 2.0 * t); // smoothstep
    hNew *= sponge;
  }

  fragColor = vec4(hNew, h, 0.0, 1.0);
}
`;

/**
 * Gaussian cavity (Bocquet-style impact crater).
 * E = A · exp(−r² / (2σ²)) applied as a *depression* on height only;
 * leaving h(t−1) untouched births the outward ring.
 */
export const DROP_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_drop;
uniform float u_sigma;    // σ in UV space
uniform float u_amplitude; // signed: negative = cavity

void main() {
  vec2 state = texture(u_state, v_uv).rg;
  vec2 d = v_uv - u_drop;
  float r2 = dot(d, d);
  float sigma2 = max(u_sigma * u_sigma, 1e-8);
  float amp = u_amplitude * exp(-r2 / (2.0 * sigma2));
  fragColor = vec4(state.r + amp, state.g, 0.0, 1.0);
}
`;

export const RENDER_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_texel;
uniform vec3 u_baseColor;
uniform vec3 u_highlight;
uniform vec3 u_warmColor;   // stress palette (rose→orange intent)
uniform float u_stress;     // S ∈ [0,1]
uniform float u_breath;     // P ∈ [-1,1]
uniform float u_energy;     // derived metabolic energy
// Stub for future Gray-Scott mix (unused)
uniform float u_rdMix;
uniform float u_attraction; // affinity ∈ [0,1] — pull highlight toward pointer
uniform vec2 u_pointerUv;   // last pointer UV

void main() {
  float h = texture(u_state, v_uv).r;

  float hL = texture(u_state, v_uv + vec2(-u_texel.x, 0.0)).r;
  float hR = texture(u_state, v_uv + vec2( u_texel.x, 0.0)).r;
  float hD = texture(u_state, v_uv + vec2(0.0, -u_texel.y)).r;
  float hU = texture(u_state, v_uv + vec2(0.0,  u_texel.y)).r;

  vec3 n = normalize(vec3(hL - hR, hD - hU, 0.08));
  vec3 light = normalize(vec3(0.35, 0.55, 1.0));
  float diff = clamp(dot(n, light), 0.0, 1.0);
  vec3 halfV = normalize(light + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n, halfV), 0.0, 1.0), 48.0);

  vec3 cool = mix(u_baseColor, u_highlight, diff * 0.5);
  vec3 warm = mix(u_warmColor, u_highlight, diff * 0.45);
  vec3 color = mix(cool, warm, clamp(u_stress, 0.0, 1.0));
  color += cool * (h * 1.8);
  color += vec3(spec) * (0.45 + 0.25 * u_energy);
  float lum = 0.88 + 0.12 * u_breath + 0.05 * u_energy;
  color *= lum;
  color = mix(color, color, u_rdMix);

  // Affinity stub: soft glow toward pointer (future metaball attractor)
  float d = distance(v_uv, u_pointerUv);
  float pull = exp(-d * d * 18.0) * u_attraction;
  color = mix(color, u_highlight, pull * 0.55);

  fragColor = vec4(color, 1.0);
}
`;
