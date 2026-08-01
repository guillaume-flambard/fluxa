export interface HomeostasisOptions {
  /** Baseline stress while fully idle. Default 0.08 */
  sBase?: number;
  /** Hard cap on stress. Default 1 */
  sMax?: number;
  /** Idle decay rate λ (1/s). Default 0.85 */
  lambda?: number;
  /** Stress added per excite(). Default 0.22 */
  delta?: number;
  /** Base breath frequency (Hz of phase cycles). Default 0.08 */
  f0?: number;
  /** Extra frequency per unit stress. Default 0.35 */
  fGain?: number;
  /** Stress threshold for fatigue. Default 0.85 */
  sFatigue?: number;
  /** Seconds above threshold before fatigued. Default 0.6 */
  fatigueHold?: number;
  /** AI stress chase rate (1/s). Default 3.5 */
  aiChase?: number;
  /** Seconds after human excite() before AI drive resumes. Default 0.45 */
  humanOverrideHold?: number;
}

export interface HomeostasisSnapshot {
  /** Excitation S ∈ [0, sMax] → u_stress */
  stress: number;
  /** Vital pulse P ∈ [-1, 1] → u_breath */
  breath: number;
  /** Derived metabolic energy → u_energy */
  energy: number;
  /** True when stressed too long — sim should throttle */
  fatigued: boolean;
  /** Seconds since last excite() */
  tIdle: number;
  /** AI energy bias from visceral energy_level */
  energyBias: number;
  /** Whether AI target stress is active */
  aiDriven: boolean;
}

type Listener = () => void;

/**
 * Level-4 metabolism: stress decay + phase-integral breath + AI chase.
 */
export class HomeostasisEngine {
  private sBase: number;
  private sMax: number;
  private lambda: number;
  private delta: number;
  private f0: number;
  private fGain: number;
  private sFatigue: number;
  private fatigueHold: number;
  private aiChase: number;
  private humanOverrideHold: number;

  private S: number;
  private phase = 0;
  private tIdle = 0;
  private tAbove = 0;
  private fatigued = false;
  private breath = 0;
  private energy = 0.5;
  private energyBias = 0;
  private targetStress: number | null = null;
  private humanOverrideLeft = 0;

  private listeners = new Set<Listener>();
  private snapshot: HomeostasisSnapshot;

  constructor(options: HomeostasisOptions = {}) {
    this.sBase = options.sBase ?? 0.08;
    this.sMax = options.sMax ?? 1;
    this.lambda = options.lambda ?? 0.85;
    this.delta = options.delta ?? 0.22;
    this.f0 = options.f0 ?? 0.08;
    this.fGain = options.fGain ?? 0.35;
    this.sFatigue = options.sFatigue ?? 0.85;
    this.fatigueHold = options.fatigueHold ?? 0.6;
    this.aiChase = options.aiChase ?? 3.5;
    this.humanOverrideHold = options.humanOverrideHold ?? 0.45;
    this.S = this.sBase;
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): HomeostasisSnapshot => this.snapshot;

  /** Spike excitation (click). Human wins briefly over AI drive. */
  excite(amount?: number): void {
    const d = amount ?? this.delta;
    this.tIdle = 0;
    this.S = Math.min(this.sMax, this.S + d);
    this.humanOverrideLeft = this.humanOverrideHold;
    this.publish();
  }

  /** AI visceral stress_level — smooth chase each tick while set. */
  setTargetStress(s: number): void {
    this.targetStress = Math.min(this.sMax, Math.max(0, s));
    this.publish();
  }

  clearTargetStress(): void {
    this.targetStress = null;
    this.publish();
  }

  /** AI visceral energy_level bias ∈ [0,1]. */
  setEnergyBias(e: number): void {
    this.energyBias = Math.min(1, Math.max(0, e));
    this.publish();
  }

  /** Advance metabolism by dt seconds. Call once per rAF. */
  tick(dt: number): HomeostasisSnapshot {
    const clamped = Math.min(Math.max(dt, 0), 0.1);
    this.tIdle += clamped;
    this.humanOverrideLeft = Math.max(0, this.humanOverrideLeft - clamped);

    const aiActive =
      this.targetStress != null && this.humanOverrideLeft <= 0;

    if (aiActive && this.targetStress != null) {
      const k = 1 - Math.exp(-this.aiChase * clamped);
      this.S += (this.targetStress - this.S) * k;
    } else {
      this.S +=
        (this.sBase - this.S) * (1 - Math.exp(-this.lambda * clamped));
    }
    this.S = Math.min(this.sMax, Math.max(0, this.S));

    const fS = this.f0 + this.fGain * this.S;
    this.phase += fS * clamped;
    this.breath = Math.sin(2 * Math.PI * this.phase);
    const breathEnergy =
      0.5 + 0.5 * this.breath * (1 - 0.4 * this.S) + 0.15 * this.S;
    this.energy = breathEnergy * 0.5 + this.energyBias * 0.5;

    if (this.S > this.sFatigue) {
      this.tAbove += clamped;
    } else {
      this.tAbove = Math.max(0, this.tAbove - clamped * 0.5);
    }
    this.fatigued = this.tAbove > this.fatigueHold;

    this.publish();
    return this.snapshot;
  }

  private buildSnapshot(): HomeostasisSnapshot {
    return {
      stress: this.S,
      breath: this.breath,
      energy: this.energy,
      fatigued: this.fatigued,
      tIdle: this.tIdle,
      energyBias: this.energyBias,
      aiDriven: this.targetStress != null && this.humanOverrideLeft <= 0,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }
}
