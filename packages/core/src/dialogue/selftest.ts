/**
 * Memory + autonomy selftest (no network).
 * Run: pnpm --filter @fluxa/core test:memory
 */
import {
  ConversationMemory,
  LocalDialogueEngine,
  tokenize,
} from "./LocalDialogueEngine.js";
import { cleanStub, speakFromMemory } from "./speak.js";

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

// Anti-loop marker: respondAsync must forward antiLoopHint into the LLM payload.
let captured: string | null = null;
const mockFetch = async (
  _url: string,
  init?: { body?: string },
): Promise<unknown> => {
  captured = typeof init?.body === "string" ? init.body : null;
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              inner: "elle repond autrement",
              reply: "Cette fois je reponds sur le fond, pas avec une question.",
              friction: 0.1,
              doubt: 0.2,
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
const llmEngine = new LocalDialogueEngine({
  memory: memory2,
  llm: { baseUrl: "http://mock.local/v1", model: "mock", apiKey: "test" },
  fetchImpl: mockFetch as never,
});
const will2 = await llmEngine.respondAsync("on travaille ensemble ?", {
  antiLoopHint: "Qu'en penses-tu ?",
});
assert(will2.reply, "llm reply");
assert(captured, "captured payload");
const parsedPayload = JSON.parse(captured!) as {
  messages?: { content?: string }[];
};
const userContent = parsedPayload.messages?.[1]?.content ?? "";
const userObj = JSON.parse(userContent) as { anti_loop_hint?: string | null };
assert(
  userObj.anti_loop_hint === "Qu'en penses-tu ?",
  `anti_loop_hint should be forwarded, got ${JSON.stringify(userObj.anti_loop_hint)}`,
);

// cleanStub: meta markers must never leak into speech.
assert(
  cleanStub("[CS:0.70] on revient a: la cage") === "on revient a: la cage",
  "cleanStub strips [CS:…]",
);
assert(
  cleanStub("[ael:foo] bonjour") === "bonjour",
  "cleanStub strips [ael:…]",
);
assert(
  cleanStub("pas de marqueur") === "pas de marqueur",
  "cleanStub leaves clean text",
);

// speakFromMemory: a [CS:] stub must not leak into the spoken reply.
const memStorage2 = new MemStorage();
const mem2 = new ConversationMemory({ storage: memStorage2, key: "test.cs" });
mem2.learnFromUser("on parle de la cage et de la souverainete", {
  stress_level: 0.3,
  energy_level: 0.6,
  affinity_level: 0.7,
});
mem2.pushTurn("user", "on parle de la cage et de la souverainete");
mem2.pushTurn(
  "assistant",
  "on revient a: la cage et la souverainete",
);
const memSpoken = speakFromMemory(
  mem2 as never,
  {
    userText: "on parle de la cage et de la souverainete",
    tokens: tokenize("cage souverainete"),
    intent: "share",
    motif: {
      phrase: "cage souverainete",
      count: 3,
      replyStub: "[CS:0.80] on revient a: la cage et la souverainete",
    },
  } as never,
);
assert(memSpoken, "memory speech should exist");
assert(
  !(memSpoken!.reply ?? "").includes("[CS:"),
  "speakFromMemory must not leak [CS:] marker",
);

// recentDialogue: drops [CS:] turns and keeps a user turn even after a long assistant streak.
const memStorage3 = new MemStorage();
const mem3 = new ConversationMemory({ storage: memStorage3, key: "test.recent" });
mem3.pushTurn("user", "premiere question");
mem3.pushTurn("assistant", "reponse un");
for (let i = 0; i < 8; i++) {
  mem3.pushTurn("assistant", `monologue autonome ${i}`);
}
const recent = mem3.recentDialogue(4);
assert(
  recent.some((t) => t.role === "user"),
  "recentDialogue should include the last user turn even after a long assistant streak",
);
assert(
  recent.every((t) => !t.text.startsWith("[CS:")),
  "recentDialogue should drop [CS:] turns",
);

console.log("dialogue memory selftest ok");
console.log("  episodes:", episodes.length, "impulse:", impulse.slice(0, 48));
console.log("  anti-loop:", userObj.anti_loop_hint);
console.log("  cleanStub + recentDialogue: ok");
