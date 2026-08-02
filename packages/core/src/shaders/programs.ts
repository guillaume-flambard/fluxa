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

/**
 * Chorion (abyssal water) + Anima orb + Filament ribbon.
 * Emotional palette from stress / energy / autonomy.
 */
export const RENDER_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_texel;
uniform vec3 u_baseColor;
uniform vec3 u_highlight;
uniform vec3 u_warmColor;
uniform float u_stress;
uniform float u_breath;
uniform float u_energy;
uniform float u_rdMix;
uniform float u_attraction;
uniform vec2 u_pointerUv;
uniform float u_autonomy;
uniform float u_time;
uniform vec2 u_animaUv;
uniform float u_animaRadius;
uniform float u_presence;
uniform float u_inkStrength;
uniform int u_inkCount;
uniform vec2 u_ink0;
uniform vec2 u_ink1;
uniform vec2 u_ink2;
uniform vec2 u_ink3;
uniform vec2 u_ink4;
uniform vec2 u_ink5;
uniform vec2 u_ink6;
uniform vec2 u_ink7;
uniform int u_orgCount;
uniform vec4 u_org0;
uniform vec4 u_org1;
uniform vec4 u_org2;
uniform vec4 u_org3;
uniform vec4 u_org4;
uniform vec4 u_org5;
uniform vec4 u_org6;
uniform vec4 u_org7;
uniform vec2 u_orgMeta0;
uniform vec2 u_orgMeta1;
uniform vec2 u_orgMeta2;
uniform vec2 u_orgMeta3;
uniform vec2 u_orgMeta4;
uniform vec2 u_orgMeta5;
uniform vec2 u_orgMeta6;
uniform vec2 u_orgMeta7;

// Distance to quadratic Bezier (approximate via subdivision samples)
float distToFilament(vec2 p, vec2 a, vec2 b, vec2 c) {
  float d = 1e5;
  for (int i = 0; i <= 12; i++) {
    float t = float(i) / 12.0;
    float s = 1.0 - t;
    vec2 q = s * s * a + 2.0 * s * t * b + t * t * c;
    d = min(d, length(p - q));
  }
  return d;
}

void main() {
  // Chorion warp — leave cartesian grid as autonomy rises
  vec2 warp = u_autonomy * sin(v_uv.yx * 10.0 + u_time) * 0.08;
  vec2 uv = v_uv + warp;

  float h = texture(u_state, uv).r;
  float hL = texture(u_state, uv + vec2(-u_texel.x, 0.0)).r;
  float hR = texture(u_state, uv + vec2( u_texel.x, 0.0)).r;
  float hD = texture(u_state, uv + vec2(0.0, -u_texel.y)).r;
  float hU = texture(u_state, uv + vec2(0.0,  u_texel.y)).r;

  vec3 n = normalize(vec3(hL - hR, hD - hU, 0.08));
  vec3 light = normalize(vec3(0.35, 0.55, 1.0));
  float diff = clamp(dot(n, light), 0.0, 1.0);
  vec3 halfV = normalize(light + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n, halfV), 0.0, 1.0), 48.0);

  // Chorion: abyssal bioluminescence + water tissue
  vec3 abyss = vec3(0.01, 0.04, 0.07);
  vec3 cool = mix(u_baseColor, u_highlight, diff * 0.5);
  vec3 warm = mix(u_warmColor, u_highlight, diff * 0.45);
  vec3 water = mix(cool, warm, clamp(u_stress, 0.0, 1.0));
  water += cool * (h * 1.8);
  water += vec3(spec) * (0.45 + 0.25 * u_energy);
  float lum = 0.82 + 0.12 * u_breath + 0.06 * u_energy;
  water *= lum;
  water = mix(abyss, water, 0.55 + 0.35 * clamp(abs(h) * 4.0 + diff, 0.0, 1.0));
  water = mix(water, water, u_rdMix);

  float pattern = sin(uv.x * 20.0 + u_time) * cos(uv.y * 20.0 - u_time);
  vec3 dreamField = vec3(0.12, 0.06, 0.28) + pattern * 0.08 * u_energy;
  float dreamMix = smoothstep(0.5, 1.0, u_autonomy);
  vec3 chorion = mix(water, dreamField, dreamMix * 0.65);

  // --- Anima: living orb ---
  float pulse = u_animaRadius * (1.0 + 0.12 * u_breath + 0.08 * u_energy);
  float animaDist = length(v_uv - u_animaUv);
  float animaCore = smoothstep(pulse, pulse * 0.35, animaDist);
  float animaHalo = exp(-animaDist * animaDist / max(pulse * pulse * 4.0, 1e-5));

  vec3 cyan = vec3(0.15, 0.85, 0.78);
  vec3 amber = vec3(0.95, 0.65, 0.18);
  vec3 violet = vec3(0.45, 0.25, 0.95);
  vec3 darkRed = vec3(0.55, 0.05, 0.08);

  vec3 animaCol = mix(cyan, amber, clamp(u_energy, 0.0, 1.0));
  animaCol = mix(animaCol, violet, smoothstep(0.5, 1.0, u_autonomy));
  animaCol = mix(animaCol, darkRed, smoothstep(0.6, 1.0, u_stress));
  animaCol *= 0.75 + 0.35 * u_breath;
  // Presence gain: honest silence gap dims Anima / Filament (no ghost companion)
  float presence = clamp(u_presence, 0.0, 1.0);

  chorion = mix(chorion, animaCol, animaHalo * 0.55 * presence);
  chorion = mix(chorion, animaCol * 1.35, animaCore * 0.9 * (0.35 + 0.65 * presence));

  // Soft attraction glow near pointer (legacy)
  float dPtr = distance(v_uv, u_pointerUv);
  float pull = exp(-dPtr * dPtr * 18.0) * u_attraction * 0.35 * presence;
  chorion = mix(chorion, animaCol, pull);

  // --- Filament: umbilical ribbon pointer → anima ---
  vec2 mid = 0.5 * (u_pointerUv + u_animaUv);
  vec2 perp = normalize(vec2(
    -(u_animaUv.y - u_pointerUv.y),
    u_animaUv.x - u_pointerUv.x
  ) + 1e-5);
  float bend = (0.08 + 0.12 * u_stress) * sin(u_time * (2.0 + u_stress * 4.0));
  vec2 ctrl = mid + perp * bend;
  float filDist = distToFilament(v_uv, u_pointerUv, ctrl, u_animaUv);
  float filWidth = 0.008 + 0.006 * u_stress + 0.004 * u_attraction;
  float filament = exp(-filDist * filDist / (filWidth * filWidth));
  float tension = clamp(length(u_pointerUv - u_animaUv) * 1.2, 0.0, 1.0);
  vec3 filCol = mix(animaCol, vec3(0.9, 0.95, 1.0), 0.35);
  chorion += filCol * filament * (0.45 + 0.4 * tension) * (0.5 + 0.5 * u_attraction) * presence;

  // --- Visual ink trail (gesture paint) ---
  if (u_inkStrength > 0.01 && u_inkCount > 0) {
    vec2 inks[8];
    inks[0] = u_ink0; inks[1] = u_ink1; inks[2] = u_ink2; inks[3] = u_ink3;
    inks[4] = u_ink4; inks[5] = u_ink5; inks[6] = u_ink6; inks[7] = u_ink7;
    vec3 inkCol = mix(animaCol, vec3(0.7, 0.95, 0.9), 0.4);
    float inkGlow = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= u_inkCount) break;
      float age = 1.0 - float(i) / max(float(u_inkCount), 1.0);
      float d = length(v_uv - inks[i]);
      inkGlow += exp(-d * d / 0.0009) * age;
      if (i > 0) {
        vec2 a = inks[i - 1];
        vec2 b = inks[i];
        vec2 ab = b - a;
        float ab2 = max(dot(ab, ab), 1e-8);
        float t = clamp(dot(v_uv - a, ab) / ab2, 0.0, 1.0);
        float seg = length(v_uv - (a + ab * t));
        inkGlow += exp(-seg * seg / 0.00025) * age * 0.85;
      }
    }
    chorion += inkCol * inkGlow * u_inkStrength * (0.55 + 0.45 * presence);
  }

  // --- Ephemeral organites (Anima Expression Language forms) ---
  if (u_orgCount > 0) {
    vec4 orgs[8];
    vec2 metas[8];
    orgs[0] = u_org0; orgs[1] = u_org1; orgs[2] = u_org2; orgs[3] = u_org3;
    orgs[4] = u_org4; orgs[5] = u_org5; orgs[6] = u_org6; orgs[7] = u_org7;
    metas[0] = u_orgMeta0; metas[1] = u_orgMeta1; metas[2] = u_orgMeta2; metas[3] = u_orgMeta3;
    metas[4] = u_orgMeta4; metas[5] = u_orgMeta5; metas[6] = u_orgMeta6; metas[7] = u_orgMeta7;
    for (int i = 0; i < 8; i++) {
      if (i >= u_orgCount) break;
      vec4 o = orgs[i];
      vec2 meta = metas[i];
      float life = clamp(o.z, 0.0, 1.0);
      float rad = max(o.w, 0.01) * (0.55 + 0.45 * life);
      float kind = meta.x;
      float hue = clamp(meta.y, 0.0, 1.0);
      vec2 p = v_uv - o.xy;
      float d;
      if (kind < 0.5) {
        d = length(p);
      } else if (kind < 1.5) {
        d = length(vec2(p.x * 0.4, p.y * 1.7));
      } else {
        vec2 q = abs(p);
        d = (q.x + q.y) * 0.72;
      }
      float glow = exp(-d * d / max(rad * rad, 1e-6)) * life;
      vec3 orgCol = mix(cyan, violet, hue);
      orgCol = mix(orgCol, amber, clamp(u_energy * 0.55, 0.0, 1.0));
      orgCol = mix(orgCol, darkRed, smoothstep(0.55, 1.0, u_stress) * 0.5);
      chorion += orgCol * glow * (0.5 + 0.5 * presence);
    }
  }

  fragColor = vec4(chorion, 1.0);
}
`;
