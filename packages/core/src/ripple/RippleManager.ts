export interface RippleImpulse {
  /** Normalized UV [0,1] */
  x: number;
  /** Normalized UV [0,1] */
  y: number;
  /**
   * Signed peak of the Gaussian cavity.
   * Negative = impact crater (Bocquet); positive = rare upward bump.
   */
  amplitude: number;
  /** σ of E = A · exp(−r² / (2σ²)), in UV space */
  sigma: number;
}

export interface RippleManagerOptions {
  maxPerFrame?: number;
  /** Default click cavity depth (positive magnitude → stored negative). */
  clickAmplitude?: number;
  clickSigma?: number;
  moveSigma?: number;
}

/**
 * CPU impulse queue → GPU drop pass.
 * React / DOM only enqueue; the rAF loop drains without re-rendering React.
 */
export class RippleManager {
  private queue: RippleImpulse[] = [];
  private readonly maxPerFrame: number;
  private readonly clickAmplitude: number;
  private readonly clickSigma: number;
  private readonly moveSigma: number;
  private lastMoveUv: { x: number; y: number } | null = null;
  private lastMoveTime = 0;

  constructor(options: RippleManagerOptions = {}) {
    this.maxPerFrame = options.maxPerFrame ?? 8;
    this.clickAmplitude = options.clickAmplitude ?? 0.45;
    this.clickSigma = options.clickSigma ?? 0.028;
    this.moveSigma = options.moveSigma ?? 0.016;
  }

  enqueue(impulse: RippleImpulse): void {
    this.queue.push(impulse);
  }

  /** Sharp impact → hydrodynamic cavity (negative Gaussian). */
  pointerDown(uvX: number, uvY: number): void {
    this.enqueue({
      x: uvX,
      y: uvY,
      amplitude: -this.clickAmplitude,
      sigma: this.clickSigma,
    });
    this.lastMoveUv = { x: uvX, y: uvY };
    this.lastMoveTime = performance.now();
  }

  /**
   * Continuous micro-cavities scaled by pointer speed
   * (momentum transfer ∝ velocity, Bocquet).
   */
  pointerMove(uvX: number, uvY: number): void {
    const now = performance.now();
    const prev = this.lastMoveUv;
    const prevT = this.lastMoveTime;
    this.lastMoveUv = { x: uvX, y: uvY };
    this.lastMoveTime = now;
    if (!prev || prevT <= 0) return;

    const dx = uvX - prev.x;
    const dy = uvY - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.0015) return;

    const dt = Math.max((now - prevT) / 1000, 1 / 240);
    const speed = dist / dt; // UV units / second
    // Soft transfer — never as strong as a click
    const magnitude = Math.min(0.09, speed * 0.012);
    if (magnitude < 0.008) return;

    this.enqueue({
      x: uvX,
      y: uvY,
      amplitude: -magnitude,
      sigma: this.moveSigma,
    });
  }

  pointerLeave(): void {
    this.lastMoveUv = null;
    this.lastMoveTime = 0;
  }

  drain(limit?: number): RippleImpulse[] {
    if (this.queue.length === 0) return [];
    const n = Math.max(0, limit ?? this.maxPerFrame);
    return this.queue.splice(0, n);
  }

  get pending(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue.length = 0;
    this.lastMoveUv = null;
    this.lastMoveTime = 0;
  }
}
