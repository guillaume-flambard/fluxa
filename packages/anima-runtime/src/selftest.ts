/**
 * Daemon anti-loop selftest (no network, no main()).
 * Run: pnpm --filter @fluxa/anima-runtime test:antiloop
 */
import { isLoopReply, textOverlap } from "./daemon.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(isLoopReply("Qu'en penses-tu ?"), "detect qu'en penses-tu");
assert(isLoopReply("Bon, allons-y. Et toi ?"), "detect et toi");
assert(isLoopReply("On pourrait commencer par discuter des bases. Qu'en penses-tu ?"), "detect trailing qu'en penses-tu");
assert(isLoopReply("ca te dit ?"), "detect ca te dit");
assert(!isLoopReply("Oui, partons sur cette base-la."), "normal reply not flagged");
assert(!isLoopReply("Je prefere developper mon idee."), "engaged reply not flagged");

const same = textOverlap("on travaille ensemble sur un truc", "on travaille ensemble sur un autre truc");
assert(same >= 0.7, `near-identical should be >= 0.7, got ${same}`);
const diff = textOverlap("bonjour comment ca va", "parlons de la meteo");
assert(diff < 0.3, `unrelated should be low, got ${diff}`);

console.log("anima-runtime anti-loop selftest ok");
console.log("  isLoopReply: 5 cases, textOverlap:", same.toFixed(2), "/", diff.toFixed(2));
