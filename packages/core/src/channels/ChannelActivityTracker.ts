export type CommChannel =
  | "language"
  | "visual"
  | "proximics"
  | "machine"
  | "silence";

export type PresenceState = "coupled" | "absent";

export interface ChannelSnapshot {
  active: CommChannel;
  languageIntensity: number;
  proximicsIntensity: number;
  visualIntensity: number;
  silenceSeconds: number;
  /** Coupled while the link is signaling; absent in the silence gap (no inhabited presence). */
  presence: PresenceState;
  /** 0..1 continuous presence gain for shaders */
  presenceGain: number;
}

export interface ChannelActivityOptions {
  /** Seconds of quiet before presence becomes absent. Default 2.5 */
  silenceThresholdSec?: number;
  languageDecay?: number;
  proximicsDecay?: number;
  visualDecay?: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Symbol-to-body channel activity. Tracks language / proximics / visual
 * and an honest silence gap (presence absent between signals).
 */
export class ChannelActivityTracker {
  private readonly silenceThresholdSec: number;
  private readonly languageDecay: number;
  private readonly proximicsDecay: number;
  private readonly visualDecay: number;

  private languageIntensity = 0;
  private proximicsIntensity = 0;
  private visualIntensity = 0;
  private silenceSeconds = 0;
  private presenceGain = 1;
  private forcedSilence = false;

  private listeners = new Set<() => void>();
  private snapshot: ChannelSnapshot;

  constructor(options: ChannelActivityOptions = {}) {
    this.silenceThresholdSec = options.silenceThresholdSec ?? 2.5;
    this.languageDecay = options.languageDecay ?? 1.4;
    this.proximicsDecay = options.proximicsDecay ?? 2.2;
    this.visualDecay = options.visualDecay ?? 1.8;
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ChannelSnapshot => this.snapshot;

  recordLanguage(amount = 0.35): void {
    this.forcedSilence = false;
    this.silenceSeconds = 0;
    this.languageIntensity = clamp01(this.languageIntensity + amount);
    this.publish();
  }

  recordProximics(amount = 0.25): void {
    this.forcedSilence = false;
    this.silenceSeconds = 0;
    this.proximicsIntensity = clamp01(this.proximicsIntensity + amount);
    this.publish();
  }

  recordVisual(amount = 0.3): void {
    this.forcedSilence = false;
    this.silenceSeconds = 0;
    this.visualIntensity = clamp01(this.visualIntensity + amount);
    this.publish();
  }

  /** Storybook: clear channels and enter silence gap. */
  forceSilence(): void {
    this.forcedSilence = true;
    this.languageIntensity = 0;
    this.proximicsIntensity = 0;
    this.visualIntensity = 0;
    this.silenceSeconds = this.silenceThresholdSec + 0.5;
    this.publish();
  }

  tick(dt: number): ChannelSnapshot {
    const clamped = Math.min(Math.max(dt, 0), 0.1);
    this.languageIntensity *= Math.exp(-this.languageDecay * clamped);
    this.proximicsIntensity *= Math.exp(-this.proximicsDecay * clamped);
    this.visualIntensity *= Math.exp(-this.visualDecay * clamped);

    const signal =
      this.languageIntensity +
      this.proximicsIntensity +
      this.visualIntensity;

    if (this.forcedSilence || signal < 0.04) {
      this.silenceSeconds += clamped;
    } else {
      this.silenceSeconds = 0;
      this.forcedSilence = false;
    }

    const coupled = this.silenceSeconds < this.silenceThresholdSec;
    const target = coupled ? 1 : 0;
    // Smooth presence gain for shader (faster drop than rise)
    const rate = coupled ? 4 : 2.5;
    this.presenceGain += (target - this.presenceGain) * Math.min(1, rate * clamped);

    this.publish();
    return this.snapshot;
  }

  private build(): ChannelSnapshot {
    const presence: PresenceState =
      this.silenceSeconds >= this.silenceThresholdSec ? "absent" : "coupled";

    let active: CommChannel = "silence";
    if (presence === "absent") {
      active = "silence";
    } else {
      const scores: [CommChannel, number][] = [
        ["language", this.languageIntensity],
        ["proximics", this.proximicsIntensity],
        ["visual", this.visualIntensity],
      ];
      scores.sort((a, b) => b[1] - a[1]);
      active = scores[0]![1] > 0.05 ? scores[0]![0] : "silence";
    }

    return {
      active,
      languageIntensity: this.languageIntensity,
      proximicsIntensity: this.proximicsIntensity,
      visualIntensity: this.visualIntensity,
      silenceSeconds: this.silenceSeconds,
      presence,
      presenceGain: clamp01(this.presenceGain),
    };
  }

  private publish(): void {
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }
}
