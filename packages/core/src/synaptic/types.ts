/** Visceral latent vector V = [s, e, a] ∈ [0,1]³ */

export interface VisceralState {
  stress_level: number;
  energy_level: number;
  affinity_level: number;
}

export interface AssistantTurn {
  reply: string;
  visceral_state: VisceralState;
}

export interface VisceralPartial {
  reply?: string;
  visceral_state?: Partial<VisceralState>;
  /** True when a complete JSON object was parsed */
  complete: boolean;
}

export interface PerceptionSnapshot {
  /** EMA of human mechanical load ∈ [0,1] */
  user_agitation: number;
  clicksPerSecond: number;
  /** Last pointer UV (for affinity pull) */
  pointerUv: { x: number; y: number };
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function formatPerceptionNote(p: PerceptionSnapshot): string {
  const x = p.user_agitation.toFixed(2);
  return `[System Note: User agitation is at ${x}/1.0]`;
}
