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
}

export interface FluxaEngine {
  readonly canvas: HTMLCanvasElement;
  readonly ripples: RippleManager;
  readonly homeostasis: HomeostasisEngine;
  readonly synaptic: SynapticBridge;
  readonly agitation: UserAgitationTracker;
  readonly running: boolean;
  readonly resting: boolean;
  start: () => void;
  stop: () => void;
  wake: () => void;
  resize: (cssWidth: number, cssHeight: number, dpr?: number) => void;
  clientToUv: (clientX: number, clientY: number) => { x: number; y: number };
  /** Feed LLM / mock stream chunk into visceral parser. */
  feedVisceralChunk: (chunk: string) => VisceralPartial;
  applyVisceral: (state: Partial<VisceralState>) => void;
  resetVisceralStream: () => void;
  setPointerUv: (x: number, y: number) => void;
  recordClick: () => void;
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
  private affinity = 0;
  private pointerUv = { x: 0.5, y: 0.5 };

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
    this.synaptic = new SynapticBridge({
      homeostasis: this.homeostasis,
      onAffinity: (a) => {
        this.affinity = a;
      },
    });
    this.meta = this.homeostasis.getSnapshot();

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
    this.pointerUv = { x, y };
    this.agitation.setPointerUv(x, y);
  }

  recordClick(): void {
    this.agitation.recordClick();
  }

  feedVisceralChunk(chunk: string): VisceralPartial {
    const partial = this.synaptic.feedChunk(chunk);
    this.wake();
    return partial;
  }

  applyVisceral(state: Partial<VisceralState>): void {
    this.synaptic.applyVisceral(state);
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
    gl.uniform1f(pass.uniforms["u_stress"] ?? null, stress);
    gl.uniform1f(pass.uniforms["u_breath"] ?? null, breath);
    gl.uniform1f(pass.uniforms["u_energy"] ?? null, energy);
    gl.uniform1f(pass.uniforms["u_rdMix"] ?? null, 0);
    gl.uniform1f(pass.uniforms["u_attraction"] ?? null, this.affinity);
    gl.uniform2f(
      pass.uniforms["u_pointerUv"] ?? null,
      this.pointerUv.x,
      this.pointerUv.y,
    );

    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    resetVisceralStream: () => sim.resetVisceralStream(),
    setPointerUv: (x, y) => sim.setPointerUv(x, y),
    recordClick: () => sim.recordClick(),
    dispose: () => sim.dispose(),
  };
}

export { GLError };
