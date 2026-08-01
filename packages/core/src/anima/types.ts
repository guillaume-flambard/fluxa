/** Agent-facing phase presets for the somatic bridge. */
export type AnimaPhase = "symbiosis" | "friction" | "dream";

/**
 * Unified visceral intent — prefer this over poking uniforms.
 * Numeric fields are 0..1. Wire JSON still uses stress_level / etc. via applyVisceral.
 */
export interface VisceralIntent {
  /** Convenience preset that sets a coherent phase body state */
  phase?: AnimaPhase;
  stress?: number;
  energy?: number;
  affinity?: number;
  /** → reportCodeHealth */
  hasErrors?: boolean;
  /** → dream climb path */
  forceIdle?: boolean;
}

export function deriveAnimaPhase(opts: {
  mode: string;
  stress: number;
}): AnimaPhase {
  if (opts.mode === "dream") return "dream";
  if (opts.stress >= 0.6) return "friction";
  return "symbiosis";
}
