export type LifecycleMode = "react" | "symbiosis" | "dream";

export interface LifecycleSnapshot {
  /** Mirrored / error-driven stress ∈ [0,1] */
  stress: number;
  energy: number;
  affinity: number;
  /** Autonomy index Ia → u_autonomy */
  autonomyIndex: number;
  mode: LifecycleMode;
  /** Seconds since last human activity */
  idleSeconds: number;
  /** Count of throttled autonomous stub invocations */
  autonomousTicks: number;
}

export interface FluxaLifecycleOptions {
  /** Idle seconds before Ia climbs. Default 30 */
  idleThresholdSec?: number;
  /** Ia climb rate per second while idle. Default 0.06 */
  autonomyClimbPerSec?: number;
  /** Min seconds between onAutonomousTick. Default 5 */
  autonomousIntervalSec?: number;
  onAutonomousTick?: (snapshot: LifecycleSnapshot) => void;
  onStateChange?: (
    snapshot: LifecycleSnapshot,
    mode: LifecycleMode,
  ) => void;
}

type Listener = () => void;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Lifecycle layer: autonomy index Ia, modes react | symbiosis | dream.
 * Frame-rate safe adaptation of the seminal FluxaLifecycleEngine pulse.
 */
export class FluxaLifecycleEngine {
  private readonly idleThresholdSec: number;
  private readonly climbPerSec: number;
  private readonly autonomousIntervalSec: number;
  private readonly onAutonomousTick:
    | ((snapshot: LifecycleSnapshot) => void)
    | undefined;
  private readonly onStateChange:
    | ((snapshot: LifecycleSnapshot, mode: LifecycleMode) => void)
    | undefined;

  private stress = 0.1;
  private energy = 0.8;
  private affinity = 0.5;
  private autonomyIndex = 0;
  private mode: LifecycleMode = "react";
  private idleSeconds = 0;
  private autonomousTicks = 0;
  private timeSinceAutonomous = 0;
  private elapsed = 0;
  private forceIdle = false;

  private listeners = new Set<Listener>();
  private snapshot: LifecycleSnapshot;

  constructor(options: FluxaLifecycleOptions = {}) {
    this.idleThresholdSec = options.idleThresholdSec ?? 30;
    this.climbPerSec = options.autonomyClimbPerSec ?? 0.06;
    this.autonomousIntervalSec = options.autonomousIntervalSec ?? 5;
    this.onAutonomousTick = options.onAutonomousTick;
    this.onStateChange = options.onStateChange;
    this.snapshot = this.build();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LifecycleSnapshot => this.snapshot;

  /** Pointer / key activity — resets idle, raises affinity, enters symbiosis. */
  recordHumanActivity(velocity = 0.35): void {
    this.forceIdle = false;
    this.idleSeconds = 0;
    this.affinity = clamp01(this.affinity + velocity * 0.01);

    if (this.autonomyIndex >= 1) {
      this.autonomyIndex = 0.5;
    } else if (this.autonomyIndex < 0.5) {
      this.autonomyIndex = 0.5;
    }

    this.mode = "symbiosis";
    this.publish();
  }

  /** Host / Storybook: compilation or test health. */
  reportCodeHealth(opts: { hasErrors: boolean }): void {
    if (opts.hasErrors) {
      this.stress = clamp01(this.stress + 0.15);
      this.energy = clamp01(this.energy - 0.1);
    } else {
      this.stress = clamp01(this.stress - 0.05);
      this.energy = clamp01(this.energy + 0.05);
    }
    this.publish();
  }

  /** Storybook: jump past idle threshold immediately. */
  forceIdleForTesting(): void {
    this.forceIdle = true;
    this.idleSeconds = this.idleThresholdSec + 1;
    this.publish();
  }

  /** Public alias for agents — enter dream climb path with immediate dream mode. */
  enterDream(): void {
    this.forceIdle = true;
    this.idleSeconds = this.idleThresholdSec + 1;
    this.autonomyIndex = Math.max(this.autonomyIndex, 0.85);
    this.mode = "dream";
    this.publish();
  }

  /** Mirror somatic intent numbers onto lifecycle (agent / expressVisceral). */
  applyVisceralIntent(partial: {
    stress?: number;
    energy?: number;
    affinity?: number;
  }): void {
    if (partial.stress != null) this.stress = clamp01(partial.stress);
    if (partial.energy != null) this.energy = clamp01(partial.energy);
    if (partial.affinity != null) this.affinity = clamp01(partial.affinity);
    this.publish();
  }

  /**
   * Advance lifecycle. Call once per rAF with dt in seconds.
   * Optionally sync stress/energy from homeostasis when not error-driven.
   */
  tick(
    dt: number,
    opts?: { homeoStress?: number; homeoEnergy?: number },
  ): LifecycleSnapshot {
    const clamped = Math.min(Math.max(dt, 0), 0.1);
    this.elapsed += clamped;
    this.idleSeconds += clamped;
    this.timeSinceAutonomous += clamped;

    // Soft blend toward homeostasis when healthy
    if (opts?.homeoStress != null) {
      this.stress = this.stress * 0.85 + opts.homeoStress * 0.15;
    }
    if (opts?.homeoEnergy != null) {
      this.energy = this.energy * 0.85 + opts.homeoEnergy * 0.15;
    }

    const idle =
      this.forceIdle || this.idleSeconds >= this.idleThresholdSec;

    if (idle) {
      this.autonomyIndex = clamp01(
        this.autonomyIndex + this.climbPerSec * clamped,
      );
      // Dream affinity oscillation
      this.affinity = 0.5 + 0.5 * Math.sin(this.elapsed);
      this.mode = this.autonomyIndex > 0.8 ? "dream" : "symbiosis";

      if (
        this.mode === "dream" &&
        this.timeSinceAutonomous >= this.autonomousIntervalSec
      ) {
        this.timeSinceAutonomous = 0;
        this.autonomousTicks += 1;
        const snap = this.build();
        this.onAutonomousTick?.(snap);
        if (typeof console !== "undefined") {
          console.log(
            "[Fluxa Core] IA en mode autonome : réorganisation du graphe de connaissances…",
            snap.autonomyIndex.toFixed(2),
          );
        }
      }
    } else {
      this.mode =
        this.autonomyIndex >= 0.5 ? "symbiosis" : "react";
      // Gentle affinity decay when idle clock not yet dreaming
      this.affinity = clamp01(this.affinity - 0.02 * clamped);
    }

    this.publish();
    return this.snapshot;
  }

  private build(): LifecycleSnapshot {
    return {
      stress: this.stress,
      energy: this.energy,
      affinity: this.affinity,
      autonomyIndex: this.autonomyIndex,
      mode: this.mode,
      idleSeconds: this.idleSeconds,
      autonomousTicks: this.autonomousTicks,
    };
  }

  private publish(): void {
    this.snapshot = this.build();
    this.onStateChange?.(this.snapshot, this.mode);
    for (const l of this.listeners) l();
  }
}
