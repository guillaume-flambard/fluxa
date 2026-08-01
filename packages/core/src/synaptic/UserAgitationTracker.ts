import {
  clamp01,
  formatPerceptionNote,
  type PerceptionSnapshot,
} from "./types.js";

export interface UserAgitationOptions {
  /** EMA half-life-ish decay rate (1/s). Default 1.2 */
  decay?: number;
  /** Click impulse strength. Default 0.28 */
  clickGain?: number;
  /** Ripple energy → agitation gain. Default 0.15 */
  impulseGain?: number;
}

/**
 * Ascendant perception: mechanical load from the human → user_agitation ∈ [0,1].
 */
export class UserAgitationTracker {
  private decay: number;
  private clickGain: number;
  private impulseGain: number;
  private agitation = 0;
  private clickTimes: number[] = [];
  private pointerUv = { x: 0.5, y: 0.5 };
  private listeners = new Set<() => void>();
  private snapshot: PerceptionSnapshot;

  constructor(options: UserAgitationOptions = {}) {
    this.decay = options.decay ?? 1.2;
    this.clickGain = options.clickGain ?? 0.28;
    this.impulseGain = options.impulseGain ?? 0.15;
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PerceptionSnapshot => this.snapshot;

  setPointerUv(x: number, y: number): void {
    this.pointerUv = { x, y };
    this.publish();
  }

  recordClick(now = performance.now()): void {
    this.clickTimes.push(now);
    this.agitation = clamp01(this.agitation + this.clickGain);
    this.publish();
  }

  recordImpulseEnergy(absAmplitude: number): void {
    this.agitation = clamp01(
      this.agitation + absAmplitude * this.impulseGain,
    );
    this.publish();
  }

  tick(dt: number, now = performance.now()): PerceptionSnapshot {
    const clamped = Math.min(Math.max(dt, 0), 0.1);
    this.agitation *= Math.exp(-this.decay * clamped);
    const cutoff = now - 1000;
    this.clickTimes = this.clickTimes.filter((t) => t >= cutoff);
    this.publish();
    return this.snapshot;
  }

  formatSystemNote(): string {
    return formatPerceptionNote(this.snapshot);
  }

  private build(): PerceptionSnapshot {
    return {
      user_agitation: this.agitation,
      clicksPerSecond: this.clickTimes.length,
      pointerUv: { ...this.pointerUv },
    };
  }

  private publish(): void {
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }
}
