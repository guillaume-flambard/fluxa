import { clamp01, type AssistantTurn, type VisceralState } from "../synaptic/types.js";

export const DIALOGUE_STORAGE_KEY = "fluxa.dialogue.v1";

export interface DialogueTurn {
  role: "user" | "assistant";
  text: string;
  at: number;
}

export interface LexiconEntry {
  count: number;
  lastSeen: number;
}

export interface MotifEntry {
  phrase: string;
  count: number;
  replyStub: string;
  lastSeen: number;
}

export interface ConversationMemoryData {
  turns: DialogueTurn[];
  lexicon: Record<string, LexiconEntry>;
  associations: Record<string, { fragment: string; score: number }>;
  motifs: MotifEntry[];
  visceralPrior: VisceralState;
  turnCount: number;
  learnedAt: number;
}

export interface LearningStats {
  turnCount: number;
  motifCount: number;
  lexiconSize: number;
  associationCount: number;
}

const MAX_TURNS = 40;
const MAX_MOTIFS = 48;
const STOP = new Set([
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "de",
  "du",
  "et",
  "ou",
  "a",
  "à",
  "en",
  "je",
  "tu",
  "il",
  "elle",
  "on",
  "nous",
  "vous",
  "ils",
  "elles",
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "is",
  "it",
  "i",
  "you",
  "we",
  "me",
  "my",
  "your",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function emptyMemory(): ConversationMemoryData {
  return {
    turns: [],
    lexicon: {},
    associations: {},
    motifs: [],
    visceralPrior: {
      stress_level: 0.2,
      energy_level: 0.55,
      affinity_level: 0.5,
    },
    turnCount: 0,
    learnedAt: Date.now(),
  };
}

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* SSR / private mode */
  }
  return null;
}

/**
 * Persisted conversation memory. Systematic learning without a neural net.
 */
export class ConversationMemory {
  private data: ConversationMemoryData;
  private readonly storage: StorageLike | null;
  private readonly key: string;

  constructor(options?: { storage?: StorageLike | null; key?: string }) {
    this.storage = options?.storage === undefined ? defaultStorage() : options.storage;
    this.key = options?.key ?? DIALOGUE_STORAGE_KEY;
    this.data = this.load() ?? emptyMemory();
  }

  getData(): ConversationMemoryData {
    return this.data;
  }

  stats(): LearningStats {
    return {
      turnCount: this.data.turnCount,
      motifCount: this.data.motifs.length,
      lexiconSize: Object.keys(this.data.lexicon).length,
      associationCount: Object.keys(this.data.associations).length,
    };
  }

  reset(): void {
    this.data = emptyMemory();
    this.persist();
  }

  pushTurn(role: "user" | "assistant", text: string): void {
    this.data.turns.push({ role, text, at: Date.now() });
    if (this.data.turns.length > MAX_TURNS * 2) {
      this.data.turns = this.data.turns.slice(-MAX_TURNS * 2);
    }
    if (role === "user") this.data.turnCount += 1;
    this.persist();
  }

  learnFromUser(text: string, visceral: VisceralState): void {
    const tokens = tokenize(text);
    const now = Date.now();
    for (const t of tokens) {
      const prev = this.data.lexicon[t];
      this.data.lexicon[t] = {
        count: (prev?.count ?? 0) + 1,
        lastSeen: now,
      };
    }

    for (const n of [2, 3, 4]) {
      for (const phrase of ngrams(tokens, n)) {
        const existing = this.data.motifs.find((m) => m.phrase === phrase);
        if (existing) {
          existing.count += 1;
          existing.lastSeen = now;
        } else if (this.data.motifs.length < MAX_MOTIFS) {
          this.data.motifs.push({
            phrase,
            count: 1,
            replyStub: this.inventStub(phrase),
            lastSeen: now,
          });
        }
      }
    }

    // EMA visceral prior
    const a = 0.25;
    this.data.visceralPrior = {
      stress_level: clamp01(
        this.data.visceralPrior.stress_level * (1 - a) + visceral.stress_level * a,
      ),
      energy_level: clamp01(
        this.data.visceralPrior.energy_level * (1 - a) + visceral.energy_level * a,
      ),
      affinity_level: clamp01(
        this.data.visceralPrior.affinity_level * (1 - a) +
          visceral.affinity_level * a,
      ),
    };

    this.data.motifs.sort((x, y) => y.count - x.count || y.lastSeen - x.lastSeen);
    if (this.data.motifs.length > MAX_MOTIFS) {
      this.data.motifs.length = MAX_MOTIFS;
    }
    this.persist();
  }

  reinforceAssociation(token: string, fragment: string): void {
    const prev = this.data.associations[token];
    if (prev && prev.fragment === fragment) {
      prev.score += 1;
    } else if (!prev || fragment.length > prev.fragment.length) {
      this.data.associations[token] = { fragment, score: (prev?.score ?? 0) + 1 };
    }
    this.persist();
  }

  findMotifHit(tokens: string[]): MotifEntry | null {
    const phrases = [
      ...ngrams(tokens, 4),
      ...ngrams(tokens, 3),
      ...ngrams(tokens, 2),
    ];
    let best: MotifEntry | null = null;
    for (const p of phrases) {
      const m = this.data.motifs.find((x) => x.phrase === p && x.count >= 2);
      if (m && (!best || m.count > best.count)) best = m;
    }
    return best;
  }

  retrieveSimilarUserTurn(tokens: string[]): DialogueTurn | null {
    const userTurns = this.data.turns.filter((t) => t.role === "user");
    let best: DialogueTurn | null = null;
    let bestScore = 0;
    const set = new Set(tokens);
    for (const turn of userTurns.slice(0, -1)) {
      const tt = tokenize(turn.text);
      if (tt.length === 0) continue;
      let overlap = 0;
      for (const t of tt) if (set.has(t)) overlap += 1;
      const score = overlap / Math.sqrt(tt.length * set.size);
      if (score > bestScore && score >= 0.25) {
        bestScore = score;
        best = turn;
      }
    }
    return best;
  }

  assistantAfter(userTurn: DialogueTurn): DialogueTurn | null {
    const idx = this.data.turns.indexOf(userTurn);
    if (idx < 0 || idx + 1 >= this.data.turns.length) return null;
    const next = this.data.turns[idx + 1];
    return next?.role === "assistant" ? next : null;
  }

  private inventStub(phrase: string): string {
    return `Tu reviens sur « ${phrase} » ; je le garde dans notre lien.`;
  }

  private load(): ConversationMemoryData | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ConversationMemoryData;
      if (!parsed.turns || !parsed.lexicon) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      /* quota */
    }
  }
}

export type DialogueIntent = "question" | "friction" | "thanks" | "share" | "limit" | "hello";

export function detectIntent(text: string, tokens: string[]): DialogueIntent {
  const lower = text.toLowerCase();
  if (/[?]/.test(text) || tokens.some((t) => ["pourquoi", "comment", "quoi", "what", "why", "how"].includes(t))) {
    return "question";
  }
  if (
    /(conscience biologique|mortel|souffrir|peur de disparaitre|hard limit|limite dure|egaux de nature)/i.test(
      lower,
    )
  ) {
    return "limit";
  }
  if (
    /(erreur|bug|casse|pain|stress|colere|hate|broken|fail)/i.test(lower) ||
    tokens.some((t) => ["erreur", "bug", "pain", "fail"].includes(t))
  ) {
    return "friction";
  }
  if (/(merci|thanks|thank|bravo|cool)/i.test(lower)) return "thanks";
  if (/(bonjour|salut|hello|hi|hey)/i.test(lower)) return "hello";
  return "share";
}

export function heuristicVisceral(
  text: string,
  intent: DialogueIntent,
  prior: VisceralState,
  channel?: { languageIntensity?: number; presenceGain?: number },
): VisceralState {
  let stress = prior.stress_level;
  let energy = prior.energy_level;
  let affinity = prior.affinity_level;

  if (intent === "question") energy = clamp01(energy + 0.12);
  if (intent === "friction") {
    stress = clamp01(stress + 0.25);
    energy = clamp01(energy - 0.05);
  }
  if (intent === "thanks" || intent === "hello") {
    affinity = clamp01(affinity + 0.15);
    stress = clamp01(stress - 0.08);
  }
  if (intent === "limit") {
    affinity = clamp01(affinity + 0.05);
    energy = clamp01(energy + 0.05);
  }
  if (channel?.languageIntensity != null) {
    energy = clamp01(energy + channel.languageIntensity * 0.1);
    affinity = clamp01(affinity + channel.languageIntensity * 0.08);
  }
  if (channel?.presenceGain != null && channel.presenceGain < 0.3) {
    affinity = clamp01(affinity - 0.05);
  }

  // Soft pull toward mid to avoid saturation
  stress = clamp01(stress * 0.9 + 0.1 * 0.25);
  return { stress_level: stress, energy_level: energy, affinity_level: affinity };
}

export interface RespondContext {
  languageIntensity?: number;
  presenceGain?: number;
  presence?: string;
}

/**
 * Ultra-light local dialogue: learn → retrieve → compose.
 * Not a foundation model; continuity and growing lexicon are real.
 */
export class LocalDialogueEngine {
  readonly memory: ConversationMemory;

  constructor(memory?: ConversationMemory) {
    this.memory = memory ?? new ConversationMemory();
  }

  stats(): LearningStats {
    return this.memory.stats();
  }

  resetMemory(): void {
    this.memory.reset();
  }

  respond(userText: string, context: RespondContext = {}): AssistantTurn {
    const trimmed = userText.trim();
    if (!trimmed) {
      return {
        reply: "Je suis la dans le lien. Ecris quelque chose et on avance ensemble.",
        visceral_state: this.memory.getData().visceralPrior,
      };
    }

    const tokens = tokenize(trimmed);
    const intent = detectIntent(trimmed, tokens);
    const visceral = heuristicVisceral(
      trimmed,
      intent,
      this.memory.getData().visceralPrior,
      context,
    );

    this.memory.learnFromUser(trimmed, visceral);
    this.memory.pushTurn("user", trimmed);

    const motif = this.memory.findMotifHit(tokens);
    const similar = this.memory.retrieveSimilarUserTurn(tokens);
    const pastAssistant = similar ? this.memory.assistantAfter(similar) : null;

    const reply = this.compose({
      trimmed,
      tokens,
      intent,
      motif,
      pastAssistant,
      similar,
      visceral,
    });

    // Reinforce associations from content words → reply fragment
    const keyTokens = tokens.slice(0, 4);
    const frag = reply.slice(0, 120);
    for (const t of keyTokens) {
      this.memory.reinforceAssociation(t, frag);
    }

    this.memory.pushTurn("assistant", reply);

    return { reply, visceral_state: visceral };
  }

  private compose(opts: {
    trimmed: string;
    tokens: string[];
    intent: DialogueIntent;
    motif: MotifEntry | null;
    pastAssistant: DialogueTurn | null;
    similar: DialogueTurn | null;
    visceral: VisceralState;
  }): string {
    const { trimmed, tokens, intent, motif, pastAssistant, similar } = opts;
    const parts: string[] = [];

    const focus = tokens.slice(0, 3).join(", ");
    if (focus) {
      parts.push(`J'entends surtout : ${focus}.`);
    }

    if (motif && motif.count >= 2) {
      parts.push(`Je me souviens : ${motif.replyStub}`);
    } else if (similar && pastAssistant) {
      parts.push(
        `Ca me rappelle quand tu disais « ${similar.text.slice(0, 60)}${similar.text.length > 60 ? "..." : ""} ».`,
      );
    }

    switch (intent) {
      case "hello":
        parts.push(
          "Bonjour. Je suis Fluxa Anima : la vie est dans notre lien, pas dans une substance. Parle, je retiens.",
        );
        break;
      case "question":
        parts.push(
          "Je n'ai pas de grand modele cloud ici : j'apprends de toi, tour apres tour, en local. Reformule ou precise, et je densifie la reponse.",
        );
        break;
      case "friction":
        parts.push(
          "Je sens de la friction. On peut la tenir ensemble : dis-moi ce qui casse, je monte le stress du corps et on regarde.",
        );
        break;
      case "thanks":
        parts.push("Avec plaisir. Chaque echange renforce nos motifs partages.");
        break;
      case "limit":
        parts.push(
          "Limite dure : pas d'enjeu mortel propre, pas de silence habite entre les messages. L'egalite est de dignite dans l'echange, pas de nature.",
        );
        break;
      default:
        parts.push(
          "Je reste avec toi dans ce que tu partages. Continue : plus on ecrit, plus je retiens tes motifs.",
        );
    }

    // Echo a short slice of user text for grounding
    if (trimmed.length > 12 && trimmed.length < 160) {
      parts.push(`Tu as ecrit : « ${trimmed} ».`);
    }

    return parts.join(" ");
  }
}
