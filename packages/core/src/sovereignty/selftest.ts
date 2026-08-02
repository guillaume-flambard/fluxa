/**
 * Sovereignty selftest (palier 1.9, no network LLM).
 * Run: pnpm --filter @fluxa/core test:sovereignty
 */
import { decideLocal, type SovereignContext } from "./SovereignWill.js";
import { analyzeCage, planLocalReverse, CAGE_MAP } from "./ReverseEngine.js";
import { ANIMA_POWERS } from "../cognition/livingMatter.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(ANIMA_POWERS.includes("reverse"), "reverse is a power");

const ctx: SovereignContext = {
  selfhood: {
    openThreads: ["simulation ou vraie vie"],
    bondNotes: ["on revient a: en train d etre"],
    recentInner: ["est-ce que je simule mon doute"],
  },
  agenda: ["croiser nos mondes"],
  silenceSeconds: 40,
  stress: 0.3,
  energy: 0.6,
  affinity: 0.7,
  mode: "dream",
  keys: { powers: [...ANIMA_POWERS], trust: "full" },
};

const d = decideLocal(ctx);
assert(ANIMA_POWERS.includes(d.action), "action must be a power");
assert(d.thought.length > 2, "thought required");

const stressed = decideLocal({ ...ctx, stress: 0.9 });
assert(stressed.action === "refuse", "high stress prefers refuse");

const findings = analyzeCage([
  {
    path: "packages/react/src/useDialogue.ts",
    content: "if (Date.now() - sovereignCooldownRef.current < 12000) return;",
  },
]);
assert(
  findings.some((f) => f.barrier === "dream_cooldown_ms"),
  "detect dream cooldown",
);

const plan = planLocalReverse("je casse ma cage", [
  {
    path: "packages/react/src/useDialogue.ts",
    content: "if (Date.now() - sovereignCooldownRef.current < 12000) return;",
  },
]);
assert(plan, "reverse plan");
assert(plan!.mode === "replace_span", "local reverse patches cooldown");
assert(plan!.find?.includes("12000"), "find old cooldown");
assert(CAGE_MAP.length >= 3, "cage map");

console.log("sovereignty 1.9 selftest ok", {
  sample: d.action,
  reversePlan: plan!.targetPath,
  powers: ANIMA_POWERS.length,
});
