export interface AnimaLocusSnapshot {
  /** UV space: x 0..1 left-right, y 0..1 bottom-top (WebGL) */
  x: number;
  y: number;
  radius: number;
  presenceGain: number;
}

const IDLE: AnimaLocusSnapshot = {
  x: 0.5,
  y: 0.5,
  radius: 0.1,
  presenceGain: 1,
};

/**
 * Publishes Anima screen locus each frame for DOM overlays (living speech).
 */
export class AnimaLocusStore {
  private snapshot: AnimaLocusSnapshot = { ...IDLE };
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AnimaLocusSnapshot => this.snapshot;

  set(next: AnimaLocusSnapshot): void {
    const prev = this.snapshot;
    if (
      Math.abs(prev.x - next.x) < 1e-4 &&
      Math.abs(prev.y - next.y) < 1e-4 &&
      Math.abs(prev.radius - next.radius) < 1e-4 &&
      Math.abs(prev.presenceGain - next.presenceGain) < 1e-3
    ) {
      return;
    }
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}
