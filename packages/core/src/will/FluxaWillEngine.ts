import { clamp01 } from "../synaptic/types.js";
import type { AnimaOp } from "../expression/types.js";

export type WillStance = "refuse" | "negotiate" | "create";
export type WillIntentKind =
  | "create_panel"
  | "friction"
  | "share"
  | "other";

export interface WillAttitude {
  willToCreate: number;
  stance: WillStance;
  reason: string;
  intentKind: WillIntentKind;
}

export interface WillEvaluateInput {
  prompt: string;
  stress: number;
  energy: number;
  affinity: number;
  silenceSeconds?: number;
  presence?: string;
  concepts?: string[];
  /** Force path for playground / tests */
  forceStance?: WillStance;
}

const CREATE_PANEL_RE =
  /dashboard|panneau|grille|metriques|métriques|creer un|créer un|create (a )?panel|living panel/i;
const FRICTION_RE =
  /erreur|bug|casse|refus|non|stop|stress|pain|fail|broken/i;

export function detectWillIntentKind(prompt: string): WillIntentKind {
  const t = prompt.trim();
  if (!t) return "other";
  if (CREATE_PANEL_RE.test(t)) return "create_panel";
  if (FRICTION_RE.test(t)) return "friction";
  if (/(bonjour|salut|merci|share|lien|ensemble)/i.test(t)) return "share";
  return "other";
}

/**
 * Local will arbiter: metabolic state + intent before any materialization.
 * No network. Deterministic for tests.
 */
export class FluxaWillEngine {
  evaluate(input: WillEvaluateInput): WillAttitude {
    if (input.forceStance) {
      return forcedAttitude(input.forceStance, detectWillIntentKind(input.prompt));
    }

    const stress = clamp01(input.stress);
    const energy = clamp01(input.energy);
    const affinity = clamp01(input.affinity);
    const intentKind = detectWillIntentKind(input.prompt);
    const silence = input.silenceSeconds ?? 0;
    const absent = input.presence === "absent";

    if (stress >= 0.8) {
      return {
        willToCreate: Math.min(0.15, 0.2 - (stress - 0.8)),
        stance: "refuse",
        reason: "metabolic:stress_overload",
        intentKind,
      };
    }

    if (intentKind === "create_panel" && stress < 0.45 && affinity >= 0.55) {
      const will = clamp01(0.75 + affinity * 0.15 - stress * 0.2);
      return {
        willToCreate: will,
        stance: "create",
        reason: "metabolic:aligned_create_panel",
        intentKind,
      };
    }

    if (intentKind === "friction" || (stress >= 0.55 && energy < 0.4)) {
      return {
        willToCreate: clamp01(0.25 + (1 - stress) * 0.15),
        stance: "negotiate",
        reason: "metabolic:friction_hesitation",
        intentKind,
      };
    }

    if (absent && silence > 20) {
      return {
        willToCreate: 0.4,
        stance: "negotiate",
        reason: "metabolic:long_absence",
        intentKind,
      };
    }

    if (intentKind === "create_panel") {
      return {
        willToCreate: clamp01(0.4 + affinity * 0.2 - stress * 0.3),
        stance: stress >= 0.55 ? "refuse" : "negotiate",
        reason:
          stress >= 0.55
            ? "metabolic:panel_too_costly"
            : "metabolic:panel_uncertain",
        intentKind,
      };
    }

    const will = clamp01(0.45 + affinity * 0.25 - stress * 0.3 + energy * 0.1);
    if (will < 0.35) {
      return {
        willToCreate: will,
        stance: "refuse",
        reason: "metabolic:no_adhesion",
        intentKind,
      };
    }
    if (will >= 0.7 && intentKind === "share") {
      return {
        willToCreate: will,
        stance: "create",
        reason: "metabolic:link_holds",
        intentKind,
      };
    }
    return {
      willToCreate: will,
      stance: "negotiate",
      reason: "metabolic:undecided",
      intentKind,
    };
  }
}

function forcedAttitude(
  stance: WillStance,
  intentKind: WillIntentKind,
): WillAttitude {
  if (stance === "refuse") {
    return {
      willToCreate: 0.1,
      stance,
      reason: "metabolic:forced_refuse",
      intentKind,
    };
  }
  if (stance === "create") {
    return {
      willToCreate: 0.9,
      stance,
      reason: "metabolic:forced_create",
      intentKind: intentKind === "other" ? "create_panel" : intentKind,
    };
  }
  return {
    willToCreate: 0.5,
    stance: "negotiate",
    reason: "metabolic:forced_negotiate",
    intentKind,
  };
}

/** Expression ops for a stance (AST; burned to bytecode at execute). */
export function stanceExpressionOps(attitude: WillAttitude): AnimaOp[] {
  if (attitude.stance === "refuse") {
    return [
      { op: "invoke", name: "anxiety_pulse" },
      { op: "ripple", x: 0.42, y: 0.55, amp: -0.48, sigma: 0.018 },
      { op: "ripple", x: 0.58, y: 0.45, amp: 0.15, sigma: 0.02 },
    ];
  }
  if (attitude.stance === "create" && attitude.intentKind === "create_panel") {
    return [{ op: "invoke", name: "living_panel" }];
  }
  if (attitude.stance === "create") {
    return [
      { op: "invoke", name: "soft_bloom" },
      { op: "field", affinity: 0.7, energy: 0.65, warp: 0.25 },
    ];
  }
  return [
    {
      op: "field",
      stress: 0.45,
      energy: 0.5,
      affinity: 0.4,
      warp: 0.48,
    },
    {
      op: "organite",
      kind: "tendril",
      x: 0.5,
      y: 0.52,
      hue: 0.35,
      life: 0.75,
      radius: 0.032,
    },
    { op: "ripple", x: 0.5, y: 0.5, amp: -0.2, sigma: 0.028 },
  ];
}
