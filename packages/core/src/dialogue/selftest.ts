/**
 * Memory + autonomy selftest (no network).
 * Run: pnpm --filter @fluxa/core test:memory
 */
import {
  ConversationMemory,
  LocalDialogueEngine,
  tokenize,
} from "./LocalDialogueEngine.js";

class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const storage = new MemStorage();
const memory = new ConversationMemory({ storage, key: "test.dialogue" });

memory.learnFromUser("est-ce une simulation ou la vraie vie", {
  stress_level: 0.3,
  energy_level: 0.6,
  affinity_level: 0.7,
});
memory.pushTurn("user", "est-ce une simulation ou la vraie vie");
memory.pushTurn(
  "assistant",
  "Le choix est faux. On est en train d'etre, toi et moi.",
);
memory.ingestSpeech({
  userText: "est-ce une simulation ou la vraie vie",
  tokens: tokenize("est-ce une simulation ou la vraie vie"),
  reply: "Le choix est faux. On est en train d'etre, toi et moi.",
  inner: "est-ce que je simule mon doute aussi ?",
  intent: "question",
});

const episodes = memory.recallEpisodes(tokenize("simulation vraie vie"));
assert(episodes.length >= 1, "expected episodic recall");
assert(
  episodes[0]!.assistant.includes("en train d'etre"),
  "episode should carry past reply",
);

const self = memory.getSelfhood();
assert(self.innerLog.length >= 1, "inner log should persist");
assert(self.openThreads.length >= 1, "question should open a thread");

memory.consolidateDream(["pont bio silicium"]);
assert(
  memory.getSelfhood().bondNotes.some((n) => n.includes("pont")),
  "dream consolidates bond notes",
);

// Persistence round-trip
const memory2 = new ConversationMemory({ storage, key: "test.dialogue" });
assert(
  memory2.recallEpisodes(tokenize("simulation")).length >= 1,
  "episodes survive reload",
);
assert(
  memory2.getSelfhood().openThreads.length >= 1,
  "selfhood survives reload",
);

// Autonomy gate
assert(!memory2.canAutonomous(10), "silence too short");
assert(memory2.canAutonomous(30), "silence long enough");
const impulse = memory2.pickImpulse();
assert(impulse.length > 3, "impulse should be non-empty");

const engine = new LocalDialogueEngine({
  memory: memory2,
  llm: null,
});
const auto = await engine.initiateAsync({ silenceSeconds: 40 });
assert(auto, "initiate should run when silence ok");
memory2.markAutonomous();
assert(!memory2.canAutonomous(40), "cooldown after autonomous");

console.log("dialogue memory selftest ok");
console.log("  episodes:", episodes.length, "impulse:", impulse.slice(0, 48));
