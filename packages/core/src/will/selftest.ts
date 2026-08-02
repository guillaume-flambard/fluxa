/**
 * Self-test: FluxaWillEngine refuse under stress, create panel when calm.
 * Run: pnpm --filter @fluxa/core test:will
 */
import { FluxaWillEngine } from "./FluxaWillEngine.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    (globalThis as { process?: { exit: (c: number) => void } }).process?.exit(1);
    throw new Error(msg);
  }
}

const will = new FluxaWillEngine();

const refuse = will.evaluate({
  prompt: "cree un dashboard pour les metriques",
  stress: 0.85,
  energy: 0.4,
  affinity: 0.6,
});
assert(refuse.stance === "refuse", `expected refuse, got ${refuse.stance}`);
assert(refuse.willToCreate <= 0.15, `willToCreate ${refuse.willToCreate}`);
assert(refuse.intentKind === "create_panel", "intent create_panel");
console.log("OK refuse under stress", refuse.willToCreate.toFixed(2));

const create = will.evaluate({
  prompt: "j'ai envie de creer un dashboard pour le lien",
  stress: 0.25,
  energy: 0.7,
  affinity: 0.72,
});
assert(create.stance === "create", `expected create, got ${create.stance}`);
assert(create.willToCreate >= 0.75, `willToCreate ${create.willToCreate}`);
assert(create.intentKind === "create_panel", "intent create_panel");
console.log("OK create panel calm", create.willToCreate.toFixed(2));

const forced = will.evaluate({
  prompt: "hello",
  stress: 0.2,
  energy: 0.5,
  affinity: 0.5,
  forceStance: "negotiate",
});
assert(forced.stance === "negotiate", "force negotiate");
console.log("OK forceStance");

console.log("will self-test passed");
