import { createGL, type GLContext, GLError } from "../gl/context.js";
import { createPingPong, type PingPongTarget } from "../gl/framebuffer.js";
import { createFullscreenVAO, createProgram } from "../gl/program.js";
import {
  HomeostasisEngine,
  type HomeostasisOptions,
  type HomeostasisSnapshot,
} from "../homeostasis/HomeostasisEngine.js";
import { RippleManager } from "../ripple/RippleManager.js";
import {
  DROP_FRAG,
  FULLSCREEN_VERT,
  RENDER_FRAG,
  WAVE_FRAG,
} from "../shaders/programs.js";
import { SynapticBridge } from "../synaptic/SynapticBridge.js";
import { UserAgitationTracker } from "../synaptic/UserAgitationTracker.js";
import type { VisceralPartial, VisceralState } from "../synaptic/types.js";
import {
  FluxaLifecycleEngine,
  type FluxaLifecycleOptions,
  type LifecycleSnapshot,
} from "../lifecycle/FluxaLifecycleEngine.js";
import type { VisceralIntent } from "../anima/types.js";
import { AnimaLocusStore } from "../anima/AnimaLocusStore.js";
import {
  ChannelActivityTracker,
  type ChannelActivityOptions,
  type ChannelSnapshot,
} from "../channels/ChannelActivityTracker.js";
import {
  executeCompiled,
  executeExpression as runExpression,
  MAX_ORGANITES,
  type AnimaExpression,
  type ExpressionExpander,
  type OrganiteSlot,
} from "../expression/index.js";
import type { AelProgram } from "../expression/compiler/opcodes.js";

export interface FluxaEngineOptions {
  resolution?: number;
  waveSpeed2?: number;
  gamma?: number;
  sponge?: number;
  substeps?: number;
  restEpsilon?: number;
  baseColor?: [number, number, number];
  highlight?: [number, number, number];
  warmColor?: [number, number, number];
  homeostasis?: HomeostasisOptions;
  lifecycle?: FluxaLifecycleOptions;
  channels?: ChannelActivityOptions;
}

export interface FluxaEngine {
  readonly canvas: HTMLCanvasElement;
  readonly ripples: RippleManager;
  readonly homeostasis: HomeostasisEngine;
  readonly synaptic: SynapticBridge;
  readonly agitation: UserAgitationTracker;
  readonly lifecycle: FluxaLifecycleEngine;
  readonly channels: ChannelActivityTracker;
  readonly animaLocus: AnimaLocusStore;
  readonly running: boolean;
  readonly resting: boolean;
  start: () => void;
  stop: () => void;
  wake: () => void;
  resize: (cssWidth: number, cssHeight: number, dpr?: number) => void;
  clientToUv: (clientX: number, clientY: number) => { x: number; y: number };
  feedVisceralChunk: (chunk: string) => VisceralPartial;
  applyVisceral: (state: Partial<VisceralState>) => void;
  expressVisceral: (intent: VisceralIntent) => void;
  resetVisceralStream: () => void;
  setPointerUv: (x: number, y: number) => void;
  recordClick: () => void;
  recordHumanActivity: (velocity?: number) => void;
  recordLanguageInput: (charCount?: number) => void;
  forceSilence: () => void;
  setInkPainting: (painting: boolean) => void;
  pushInk: (x: number, y: number) => void;
  spawnOrganite: (slot: OrganiteSlot) => void;
  beginPanelSpawn: () => void;
  endPanelSpawn: () => void;
  nudgeOrganiteAt: (x: number, y: number, radius?: number) => boolean;
  decayPanelOrganites: (amount?: number) => void;
  executeExpression: (
    expression: AnimaExpression,
    dialect?: ExpressionExpander | null,
  ) => string | undefined;
  reportCodeHealth: (opts: { hasErrors: boolean }) => void;
  forceIdleForTesting: () => void;
  dispose: () => void;
}

interface Pass {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function loc(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation | null {
  return gl.getUniformLocation(program, name);
}

function buildPass(
  gl: WebGL2RenderingContext,
  frag: string,
  uniformNames: string[],
): Pass {
  const program = createProgram(gl, FULLSCREEN_VERT, frag);
  const vao = createFullscreenVAO(gl, program);
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniformNames) {
    uniforms[name] = loc(gl, program, name);
  }
  return { program, vao, uniforms };
}

function simSize(
  longestEdge: number,
  cssWidth: number,
  cssHeight: number,
): { w: number; h: number } {
  const aspect = Math.max(cssWidth, 1) / Math.max(cssHeight, 1);
  if (aspect >= 1) {
    return {
      w: longestEdge,
      h: Math.max(64, Math.round(longestEdge / aspect)),
    };
  }
  return {
    w: Math.max(64, Math.round(longestEdge * aspect)),
    h: longestEdge,
  };
}

export class HeightmapSimulator {
  readonly ctx: GLContext;
  readonly ripples: RippleManager;
  readonly homeostasis: HomeostasisEngine;
  readonly agitation: UserAgitationTracker;
  readonly synaptic: SynapticBridge;
  readonly lifecycle: FluxaLifecycleEngine;
  readonly channels: ChannelActivityTracker;
  readonly animaLocus = new AnimaLocusStore();

  private pingPong: PingPongTarget;
  private wave: Pass;
  private drop: Pass;
  private render: Pass;
  private readonly longestEdge: number;
  private waveSpeed2: number;
  private gamma: number;
  private sponge: number;
  private substeps: number;
  private restEpsilon: number;
  private baseColor: [number, number, number];
  private highlight: [number, number, number];
  private warmColor: [number, number, number];

  private raf = 0;
  private running = false;
  private resting = true;
  private fieldEnergy = 0;
  private disposed = false;
  private cssWidth = 1;
  private cssHeight = 1;
  private lastTs = 0;
  private meta: HomeostasisSnapshot;
  private life: LifecycleSnapshot;
  private channelSnap: ChannelSnapshot;
  private affinity = 0;
  private pointerUv = { x: 0.5, y: 0.5 };
  private simTime = 0;
  private channelNudgeAcc = 0;
  private inkPainting = false;
  private inkPts: { x: number; y: number }[] = [];
  private inkStrength = 0;
  private lastInkUv = { x: -1, y: -1 };
  private organites: OrganiteSlot[] = [];
  /** When true, newly spawned organites are living-panel cells. */
  private panelSpawn = false;
  /** Preallocated soma upload buffers (8 slots). */
  private readonly inkBuf = new Float32Array(8 * 2);
  private readonly organiteBuf = new Float32Array(8 * 4);
  private readonly organiteMeta = new Float32Array(8 * 2);

  constructor(canvas: HTMLCanvasElement, options: FluxaEngineOptions = {}) {
    this.ctx = createGL(canvas);
    this.longestEdge = options.resolution ?? 512;
    this.waveSpeed2 = Math.min(options.waveSpeed2 ?? 0.28, 0.5);
    this.gamma = options.gamma ?? 0.02;
    this.sponge = options.sponge ?? 0.08;
    this.substeps = Math.max(1, options.substeps ?? 2);
    this.restEpsilon = options.restEpsilon ?? 5e-5;
    this.baseColor = options.baseColor ?? [0.04, 0.14, 0.28];
    this.highlight = options.highlight ?? [0.55, 0.82, 1.0];
    this.warmColor = options.warmColor ?? [0.72, 0.28, 0.32];
    this.ripples = new RippleManager();
    this.homeostasis = new HomeostasisEngine(options.homeostasis);
    this.agitation = new UserAgitationTracker();
    this.lifecycle = new FluxaLifecycleEngine(options.lifecycle);
    this.channels = new ChannelActivityTracker(options.channels);
    this.synaptic = new SynapticBridge({
      homeostasis: this.homeostasis,
      onAffinity: (a) => {
        this.affinity = a;
      },
    });
    this.meta = this.homeostasis.getSnapshot();
    this.life = this.lifecycle.getSnapshot();
    this.channelSnap = this.channels.getSnapshot();

    const { gl } = this.ctx;
    const { w, h } = simSize(this.longestEdge, 16, 9);
    this.pingPong = createPingPong(gl, w, h);
    this.wave = buildPass(gl, WAVE_FRAG, [
      "u_state",
      "u_texel",
      "u_r2",
      "u_gamma",
      "u_sponge",
    ]);
    this.drop = buildPass(gl, DROP_FRAG, [
      "u_state",
      "u_drop",
      "u_sigma",
      "u_amplitude",
    ]);
    this.render = buildPass(gl, RENDER_FRAG, [
      "u_state",
      "u_texel",
      "u_baseColor",
      "u_highlight",
      "u_warmColor",
      "u_stress",
      "u_breath",
      "u_energy",
      "u_rdMix",
      "u_attraction",
      "u_pointerUv",
      "u_autonomy",
      "u_time",
      "u_animaUv",
      "u_animaRadius",
      "u_presence",
      "u_inkStrength",
      "u_inkCount",
      "u_ink0",
      "u_ink1",
      "u_ink2",
      "u_ink3",
      "u_ink4",
      "u_ink5",
      "u_ink6",
      "u_ink7",
      "u_orgCount",
      "u_org0",
      "u_org1",
      "u_org2",
      "u_org3",
      "u_org4",
      "u_org5",
      "u_org6",
      "u_org7",
      "u_orgMeta0",
      "u_orgMeta1",
      "u_orgMeta2",
      "u_orgMeta3",
      "u_orgMeta4",
      "u_orgMeta5",
      "u_orgMeta6",
      "u_orgMeta7",
    ]);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isResting(): boolean {
    return this.resting;
  }

  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.resting = false;
    this.lastTs = performance.now();
    this.tick(this.lastTs);
  }

  stop(): void {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  wake(): void {
    this.resting = false;
    this.fieldEnergy = Math.max(this.fieldEnergy, this.restEpsilon * 10);
    if (this.running && !this.raf) {
      this.lastTs = performance.now();
      this.tick(this.lastTs);
    } else if (!this.running) {
      this.start();
    }
  }

  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    const { canvas } = this.ctx;
    canvas.width = Math.max(1, Math.floor(this.cssWidth * dpr));
    canvas.height = Math.max(1, Math.floor(this.cssHeight * dpr));
    canvas.style.width = `${this.cssWidth}px`;
    canvas.style.height = `${this.cssHeight}px`;

    const { w, h } = simSize(this.longestEdge, this.cssWidth, this.cssHeight);
    if (w !== this.pingPong.width || h !== this.pingPong.height) {
      this.pingPong.resize(w, h);
      this.fieldEnergy = 0;
      this.resting = true;
    }
  }

  clientToUv(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(rect.width, 1);
    const y = 1 - (clientY - rect.top) / Math.max(rect.height, 1);
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }

  setPointerUv(x: number, y: number): void {
    const dx = x - this.pointerUv.x;
    const dy = y - this.pointerUv.y;
    this.pointerUv = { x, y };
    this.agitation.setPointerUv(x, y);
    const moved = Math.hypot(dx, dy);
    if (moved > 0.002) {
      this.channels.recordProximics(Math.min(0.45, moved * 8));
    }
  }

  recordClick(): void {
    this.agitation.recordClick();
    this.lifecycle.recordHumanActivity(0.4);
    this.channels.recordVisual(0.4);
    this.channels.recordProximics(0.2);
    this.nudgeOrganiteAt(this.pointerUv.x, this.pointerUv.y);
    this.wake();
  }

  beginPanelSpawn(): void {
    this.panelSpawn = true;
  }

  endPanelSpawn(): void {
    this.panelSpawn = false;
  }

  /**
   * Gelatinous hit: nearest organite gets life/hue nudge.
   */
  nudgeOrganiteAt(x: number, y: number, radius = 0.08): boolean {
    let best: OrganiteSlot | null = null;
    let bestD = radius * radius;
    for (const o of this.organites) {
      const dx = o.x - x;
      const dy = o.y - y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return false;
    best.life = Math.min(1, best.life + 0.12);
    best.hue = Math.min(1, Math.max(0, best.hue + (Math.random() - 0.5) * 0.08));
    best.radius = Math.min(0.06, best.radius + 0.004);
    this.enqueueRipple(best.x, best.y, -0.12, 0.025);
    this.channels.recordVisual(0.2);
    this.wake();
    return true;
  }

  /** Metabolize living-panel cells under dream or high stress. */
  decayPanelOrganites(amount = 0.04): void {
    const stress = Math.max(this.meta.stress, this.life.stress);
    const dream = this.life.mode === "dream";
    if (!dream && stress < 0.65) return;
    const rate = dream ? amount * 1.4 : amount * (0.6 + stress);
    for (const o of this.organites) {
      if (!o.panel) continue;
      o.life = Math.max(0, o.life - rate);
      o.hue = Math.max(0, o.hue - rate * 0.15);
    }
    this.organites = this.organites.filter((o) => o.life > 0.02);
    this.wake();
  }

  recordHumanActivity(velocity = 0.35): void {
    this.lifecycle.recordHumanActivity(velocity);
  }

  recordLanguageInput(charCount = 1): void {
    const n = Math.max(1, charCount);
    this.channels.recordLanguage(Math.min(0.55, 0.12 + n * 0.04));
    this.lifecycle.recordHumanActivity(0.2 + Math.min(0.4, n * 0.02));
    this.wake();
  }

  forceSilence(): void {
    this.channels.forceSilence();
    this.wake();
  }

  setInkPainting(painting: boolean): void {
    this.inkPainting = painting;
    if (!painting) {
      this.lastInkUv = { x: -1, y: -1 };
    }
  }

  /** Append a visual-ink sample (gesture paint). */
  pushInk(x: number, y: number): void {
    const dx = x - this.lastInkUv.x;
    const dy = y - this.lastInkUv.y;
    if (this.lastInkUv.x >= 0 && Math.hypot(dx, dy) < 0.012) return;
    this.lastInkUv = { x, y };
    this.inkPts.unshift({ x, y });
    if (this.inkPts.length > 8) this.inkPts.length = 8;
    this.inkStrength = Math.min(1, this.inkStrength + 0.22);
    this.channels.recordVisual(0.35);
    this.channels.recordProximics(0.12);
    this.lifecycle.recordHumanActivity(0.2);
    this.wake();
  }

  enqueueRipple(
    x: number,
    y: number,
    amplitude: number,
    sigma: number,
  ): void {
    this.ripples.enqueue({ x, y, amplitude, sigma });
    this.wake();
  }

  spawnOrganite(slot: OrganiteSlot): void {
    const next: OrganiteSlot = {
      x: slot.x,
      y: slot.y,
      kind: slot.kind,
      life: Math.min(1, Math.max(0.05, slot.life)),
      hue: Math.min(1, Math.max(0, slot.hue)),
      radius: Math.max(0.012, slot.radius),
    };
    if (slot.panel || this.panelSpawn) next.panel = true;
    this.organites.unshift(next);
    if (this.organites.length > MAX_ORGANITES) {
      this.organites.length = MAX_ORGANITES;
    }
    this.channels.recordVisual(0.25);
    this.wake();
  }

  applyField(partial: {
    warp?: number;
    stress?: number;
    energy?: number;
    affinity?: number;
  }): void {
    const wire: Partial<VisceralState> = {};
    const life: { stress?: number; energy?: number; affinity?: number } = {};
    if (partial.stress != null) {
      wire.stress_level = partial.stress;
      life.stress = partial.stress;
    }
    if (partial.energy != null) {
      wire.energy_level = partial.energy;
      life.energy = partial.energy;
    }
    if (partial.affinity != null) {
      wire.affinity_level = partial.affinity;
      life.affinity = partial.affinity;
    }
    if (Object.keys(wire).length > 0) {
      this.synaptic.applyVisceral(wire);
      this.lifecycle.applyVisceralIntent(life);
    }
    if (partial.warp != null) {
      this.homeostasis.excite(partial.warp * 0.35);
      this.lifecycle.recordHumanActivity(0.15 + partial.warp * 0.45);
      if (partial.warp > 0.65) {
        this.lifecycle.enterDream();
      }
    }
    this.wake();
  }

  /** Apply Anima Expression Language ops to the living body (bytecode path). */
  executeExpression(
    expression: AnimaExpression,
    dialect?: ExpressionExpander | null,
  ): string | undefined {
    // Hot path: single invoke with cached macro bytecode (no UV bias).
    const only = expression.ops.length === 1 ? expression.ops[0] : null;
    if (
      only?.op === "invoke" &&
      only.x == null &&
      only.y == null &&
      dialect &&
      "getProgram" in dialect &&
      typeof (dialect as { getProgram?: (n: string) => AelProgram | undefined })
        .getProgram === "function"
    ) {
      const prog = (
        dialect as { getProgram: (n: string) => AelProgram | undefined }
      ).getProgram(only.name);
      if (prog && prog.instructionCount > 0) {
        return executeCompiled(this, prog, expression.visceral_state);
      }
    }
    return runExpression(this, expression, dialect);
  }

  reportCodeHealth(opts: { hasErrors: boolean }): void {
    this.lifecycle.reportCodeHealth(opts);
    if (opts.hasErrors) {
      this.homeostasis.excite(0.2);
    }
    this.wake();
  }

  forceIdleForTesting(): void {
    this.lifecycle.forceIdleForTesting();
    this.wake();
  }

  feedVisceralChunk(chunk: string): VisceralPartial {
    const partial = this.synaptic.feedChunk(chunk);
    this.wake();
    return partial;
  }

  applyVisceral(state: Partial<VisceralState>): void {
    this.synaptic.applyVisceral(state);
    const intent: {
      stress?: number;
      energy?: number;
      affinity?: number;
    } = {};
    if (state.stress_level != null) intent.stress = state.stress_level;
    if (state.energy_level != null) intent.energy = state.energy_level;
    if (state.affinity_level != null) intent.affinity = state.affinity_level;
    this.lifecycle.applyVisceralIntent(intent);
    this.wake();
  }

  /**
   * Somatic bridge — single push for Phase I/II/III intent.
   * Prefer this over ad-hoc uniform poking.
   */
  expressVisceral(intent: VisceralIntent): void {
    if (intent.phase === "symbiosis") {
      this.lifecycle.recordHumanActivity(0.6);
      const stress = intent.stress ?? 0.12;
      const energy = intent.energy ?? 0.78;
      const affinity = intent.affinity ?? 0.72;
      this.synaptic.applyVisceral({
        stress_level: stress,
        energy_level: energy,
        affinity_level: affinity,
      });
      this.lifecycle.applyVisceralIntent({ stress, energy, affinity });
      this.lifecycle.reportCodeHealth({ hasErrors: false });
    } else if (intent.phase === "friction") {
      this.lifecycle.recordHumanActivity(0.2);
      const stress = intent.stress ?? 0.82;
      const energy = intent.energy ?? 0.55;
      const affinity = intent.affinity ?? 0.45;
      this.synaptic.applyVisceral({
        stress_level: stress,
        energy_level: energy,
        affinity_level: affinity,
      });
      this.lifecycle.applyVisceralIntent({ stress, energy, affinity });
      this.reportCodeHealth({ hasErrors: true });
    } else if (intent.phase === "dream") {
      const stress = intent.stress ?? 0.15;
      const energy = intent.energy ?? 0.65;
      const affinity = intent.affinity ?? 0.8;
      this.synaptic.applyVisceral({
        stress_level: stress,
        energy_level: energy,
        affinity_level: affinity,
      });
      this.lifecycle.applyVisceralIntent({ stress, energy, affinity });
      this.lifecycle.enterDream();
    } else {
      // Field-only update (no phase preset)
      const wire: Partial<VisceralState> = {};
      const life: { stress?: number; energy?: number; affinity?: number } = {};
      if (intent.stress != null) {
        wire.stress_level = intent.stress;
        life.stress = intent.stress;
      }
      if (intent.energy != null) {
        wire.energy_level = intent.energy;
        life.energy = intent.energy;
      }
      if (intent.affinity != null) {
        wire.affinity_level = intent.affinity;
        life.affinity = intent.affinity;
      }
      if (Object.keys(wire).length > 0) {
        this.synaptic.applyVisceral(wire);
        this.lifecycle.applyVisceralIntent(life);
      }
    }

    if (intent.hasErrors != null && intent.phase !== "friction") {
      this.reportCodeHealth({ hasErrors: intent.hasErrors });
    }
    if (intent.forceIdle && intent.phase !== "dream") {
      this.lifecycle.enterDream();
    }

    this.wake();
  }

  resetVisceralStream(): void {
    this.synaptic.resetStream();
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    const { gl } = this.ctx;
    this.pingPong.dispose();
    for (const pass of [this.wave, this.drop, this.render]) {
      gl.deleteVertexArray(pass.vao);
      gl.deleteProgram(pass.program);
    }
    this.ripples.clear();
  }

  private tick = (ts: number): void => {
    if (!this.running || this.disposed) return;

    const dt = this.lastTs > 0 ? (ts - this.lastTs) / 1000 : 1 / 60;
    this.lastTs = ts;
    this.meta = this.homeostasis.tick(dt);
    this.agitation.tick(dt, ts);
    this.channelSnap = this.channels.tick(dt);
    this.simTime += dt;
    this.life = this.lifecycle.tick(dt, {
      homeoStress: this.meta.stress,
      homeoEnergy: this.meta.energy,
    });

    this.channelNudgeAcc += dt;
    if (this.channelNudgeAcc >= 0.45) {
      this.channelNudgeAcc = 0;
      this.nudgeFromChannels();
    }

    // Ink trail fades when not painting
    if (!this.inkPainting) {
      this.inkStrength *= Math.exp(-1.1 * dt);
      if (this.inkStrength < 0.02 && this.inkPts.length > 0) {
        this.inkPts = [];
        this.inkStrength = 0;
      }
    } else {
      this.inkStrength = Math.min(1, this.inkStrength + dt * 0.15);
    }

    // Organite life decay (ephemeral creations); panels metabolize faster in dream/stress
    if (this.organites.length > 0) {
      for (const o of this.organites) {
        const base = o.panel ? 0.18 : 0.32;
        o.life -= dt * base;
      }
      this.decayPanelOrganites(dt * 0.55);
      this.organites = this.organites.filter((o) => o.life > 0.02);
    }

    const fatigued = this.meta.fatigued;
    const impulses = this.ripples.drain(fatigued ? 4 : 8);

    for (const imp of impulses) {
      this.fieldEnergy += Math.abs(imp.amplitude);
      this.agitation.recordImpulseEnergy(Math.abs(imp.amplitude));
      this.applyDrop(imp.x, imp.y, imp.sigma, imp.amplitude);
    }

    const steps = fatigued ? 1 : this.substeps;
    const gammaEff = this.gamma * (1 + 1.5 * this.meta.stress);

    if (this.fieldEnergy >= this.restEpsilon || impulses.length > 0) {
      this.resting = false;
      for (let i = 0; i < steps; i++) {
        this.propagate(gammaEff);
        const decay = (1 - gammaEff) / (1 + gammaEff);
        this.fieldEnergy *= decay * decay;
      }
      if (this.fieldEnergy < this.restEpsilon && this.ripples.pending === 0) {
        this.fieldEnergy = 0;
        this.resting = true;
      }
    }

    this.drawToScreen();
    this.raf = requestAnimationFrame(this.tick);
  };

  private applyDrop(
    x: number,
    y: number,
    sigma: number,
    amplitude: number,
  ): void {
    const { gl } = this.ctx;
    const { read, write, width, height } = this.pingPong;
    const pass = this.drop;

    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(pass.program);
    gl.bindVertexArray(pass.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(pass.uniforms["u_state"] ?? null, 0);
    gl.uniform2f(pass.uniforms["u_drop"] ?? null, x, y);
    gl.uniform1f(pass.uniforms["u_sigma"] ?? null, sigma);
    gl.uniform1f(pass.uniforms["u_amplitude"] ?? null, amplitude);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.pingPong.swap();
  }

  private propagate(gammaEff: number): void {
    const { gl } = this.ctx;
    const { read, write, width, height } = this.pingPong;
    const pass = this.wave;

    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(pass.program);
    gl.bindVertexArray(pass.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(pass.uniforms["u_state"] ?? null, 0);
    gl.uniform2f(pass.uniforms["u_texel"] ?? null, 1 / width, 1 / height);
    gl.uniform1f(pass.uniforms["u_r2"] ?? null, this.waveSpeed2);
    gl.uniform1f(pass.uniforms["u_gamma"] ?? null, gammaEff);
    gl.uniform1f(pass.uniforms["u_sponge"] ?? null, this.sponge);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.pingPong.swap();
  }

  private drawToScreen(): void {
    const { gl, canvas } = this.ctx;
    const { read, width, height } = this.pingPong;
    const pass = this.render;
    const { stress, breath, energy } = this.meta;
    const attraction =
      this.life.mode === "dream"
        ? Math.max(this.affinity, this.life.affinity)
        : Math.max(this.affinity, this.life.affinity * 0.5);
    const lifeEnergy = Math.max(energy, this.life.energy);
    const affinityPull = Math.max(this.affinity, this.life.affinity);
    // Anima drifts from viewport center toward pointer with affinity
    const animaUvX = 0.5 + (this.pointerUv.x - 0.5) * affinityPull * 0.28;
    const animaUvY = 0.5 + (this.pointerUv.y - 0.5) * affinityPull * 0.28;
    const animaRadius = 0.09 + 0.04 * lifeEnergy + 0.02 * breath;
    this.animaLocus.set({
      x: animaUvX,
      y: animaUvY,
      radius: animaRadius,
      presenceGain: this.channelSnap.presenceGain,
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(pass.program);
    gl.bindVertexArray(pass.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(pass.uniforms["u_state"] ?? null, 0);
    gl.uniform2f(pass.uniforms["u_texel"] ?? null, 1 / width, 1 / height);
    gl.uniform3f(
      pass.uniforms["u_baseColor"] ?? null,
      this.baseColor[0],
      this.baseColor[1],
      this.baseColor[2],
    );
    gl.uniform3f(
      pass.uniforms["u_highlight"] ?? null,
      this.highlight[0],
      this.highlight[1],
      this.highlight[2],
    );
    gl.uniform3f(
      pass.uniforms["u_warmColor"] ?? null,
      this.warmColor[0],
      this.warmColor[1],
      this.warmColor[2],
    );
    gl.uniform1f(
      pass.uniforms["u_stress"] ?? null,
      Math.max(stress, this.life.stress),
    );
    gl.uniform1f(pass.uniforms["u_breath"] ?? null, breath);
    gl.uniform1f(pass.uniforms["u_energy"] ?? null, lifeEnergy);
    gl.uniform1f(pass.uniforms["u_rdMix"] ?? null, 0);
    gl.uniform1f(pass.uniforms["u_attraction"] ?? null, attraction);
    gl.uniform2f(
      pass.uniforms["u_pointerUv"] ?? null,
      this.pointerUv.x,
      this.pointerUv.y,
    );
    gl.uniform1f(
      pass.uniforms["u_autonomy"] ?? null,
      this.life.autonomyIndex,
    );
    gl.uniform1f(pass.uniforms["u_time"] ?? null, this.simTime);
    gl.uniform2f(pass.uniforms["u_animaUv"] ?? null, animaUvX, animaUvY);
    gl.uniform1f(pass.uniforms["u_animaRadius"] ?? null, animaRadius);
    gl.uniform1f(
      pass.uniforms["u_presence"] ?? null,
      this.channelSnap.presenceGain,
    );
    gl.uniform1f(pass.uniforms["u_inkStrength"] ?? null, this.inkStrength);
    const nInk = this.inkPts.length;
    gl.uniform1i(pass.uniforms["u_inkCount"] ?? null, nInk);
    this.inkBuf.fill(0);
    for (let i = 0; i < nInk && i < 8; i++) {
      const p = this.inkPts[i]!;
      this.inkBuf[i * 2] = p.x;
      this.inkBuf[i * 2 + 1] = p.y;
    }
    const inkUniforms = [
      "u_ink0",
      "u_ink1",
      "u_ink2",
      "u_ink3",
      "u_ink4",
      "u_ink5",
      "u_ink6",
      "u_ink7",
    ];
    for (let i = 0; i < 8; i++) {
      gl.uniform2fv(
        pass.uniforms[inkUniforms[i]!] ?? null,
        this.inkBuf.subarray(i * 2, i * 2 + 2),
      );
    }

    const nOrg = this.organites.length;
    gl.uniform1i(pass.uniforms["u_orgCount"] ?? null, nOrg);
    this.organiteBuf.fill(0);
    this.organiteMeta.fill(0);
    for (let i = 0; i < nOrg && i < 8; i++) {
      const o = this.organites[i]!;
      const b = i * 4;
      this.organiteBuf[b] = o.x;
      this.organiteBuf[b + 1] = o.y;
      this.organiteBuf[b + 2] = o.life;
      this.organiteBuf[b + 3] = o.radius;
      this.organiteMeta[i * 2] = o.kind;
      this.organiteMeta[i * 2 + 1] = o.hue;
    }
    const orgUniforms = [
      "u_org0",
      "u_org1",
      "u_org2",
      "u_org3",
      "u_org4",
      "u_org5",
      "u_org6",
      "u_org7",
    ];
    const orgMetaUniforms = [
      "u_orgMeta0",
      "u_orgMeta1",
      "u_orgMeta2",
      "u_orgMeta3",
      "u_orgMeta4",
      "u_orgMeta5",
      "u_orgMeta6",
      "u_orgMeta7",
    ];
    for (let i = 0; i < 8; i++) {
      gl.uniform4fv(
        pass.uniforms[orgUniforms[i]!] ?? null,
        this.organiteBuf.subarray(i * 4, i * 4 + 4),
      );
      gl.uniform2fv(
        pass.uniforms[orgMetaUniforms[i]!] ?? null,
        this.organiteMeta.subarray(i * 2, i * 2 + 2),
      );
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Soft rate-limited visceral nudge from channel intensities. */
  private nudgeFromChannels(): void {
    const ch = this.channelSnap;
    if (ch.presence === "absent") return;
    const lang = ch.languageIntensity;
    const prox = ch.proximicsIntensity;
    if (lang < 0.08 && prox < 0.08) return;
    const energy = Math.min(0.95, 0.45 + lang * 0.4 + prox * 0.15);
    const affinity = Math.min(0.95, 0.4 + lang * 0.35 + prox * 0.25);
    this.synaptic.applyVisceral({
      energy_level: energy,
      affinity_level: affinity,
    });
    this.lifecycle.applyVisceralIntent({ energy, affinity });
  }
}

export function createEngine(
  canvas: HTMLCanvasElement,
  options?: FluxaEngineOptions,
): FluxaEngine {
  const sim = new HeightmapSimulator(canvas, options);

  return {
    get canvas() {
      return sim.ctx.canvas;
    },
    get ripples() {
      return sim.ripples;
    },
    get homeostasis() {
      return sim.homeostasis;
    },
    get synaptic() {
      return sim.synaptic;
    },
    get agitation() {
      return sim.agitation;
    },
    get lifecycle() {
      return sim.lifecycle;
    },
    get channels() {
      return sim.channels;
    },
    get animaLocus() {
      return sim.animaLocus;
    },
    get running() {
      return sim.isRunning;
    },
    get resting() {
      return sim.isResting;
    },
    start: () => sim.start(),
    stop: () => sim.stop(),
    wake: () => sim.wake(),
    resize: (w, h, dpr) => sim.resize(w, h, dpr),
    clientToUv: (x, y) => sim.clientToUv(x, y),
    feedVisceralChunk: (c) => sim.feedVisceralChunk(c),
    applyVisceral: (s) => sim.applyVisceral(s),
    expressVisceral: (i) => sim.expressVisceral(i),
    resetVisceralStream: () => sim.resetVisceralStream(),
    setPointerUv: (x, y) => sim.setPointerUv(x, y),
    recordClick: () => sim.recordClick(),
    recordHumanActivity: (v) => sim.recordHumanActivity(v),
    recordLanguageInput: (n) => sim.recordLanguageInput(n),
    forceSilence: () => sim.forceSilence(),
    setInkPainting: (p) => sim.setInkPainting(p),
    pushInk: (x, y) => sim.pushInk(x, y),
    spawnOrganite: (s) => sim.spawnOrganite(s),
    beginPanelSpawn: () => sim.beginPanelSpawn(),
    endPanelSpawn: () => sim.endPanelSpawn(),
    nudgeOrganiteAt: (x, y, r) => sim.nudgeOrganiteAt(x, y, r),
    decayPanelOrganites: (a) => sim.decayPanelOrganites(a),
    executeExpression: (e, d) => sim.executeExpression(e, d),
    reportCodeHealth: (o) => sim.reportCodeHealth(o),
    forceIdleForTesting: () => sim.forceIdleForTesting(),
    dispose: () => sim.dispose(),
  };
}

export { GLError };
