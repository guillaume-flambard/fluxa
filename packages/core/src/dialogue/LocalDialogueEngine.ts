import { clamp01, type VisceralState } from "../synaptic/types.js";
import type { AnimaExpression, AnimaOp, OrganiteKind } from "../expression/types.js";
import { DialectStore } from "../expression/dialect.js";
import type { LlmCortexConfig } from "../expression/cortex.js";
import { speakFromMemory, speakWithLlm, type SpeakContext, type SpeakResult } from "./speak.js";
import type { LivingMatter } from "../cognition/livingMatter.js";
import {
  FluxaWillEngine,
  stanceExpressionOps,
  type WillAttitude,
  type WillStance,
} from "../will/FluxaWillEngine.js";

/**
 * Converts AEL expression ops into natural language description.
 * Replaces raw [ael:N] placeholders with meaningful text.
 */
function resolveAelExpression(ops: AnimaOp[], intent: string): string {
  const opCount = ops.length;
  const kinds = new Set(ops.map((op) => op.op));

  if (opCount === 0) return "un silence";

  const descriptions: string[] = [];
  if (kinds.has("ripple")) descriptions.push("une onde");
  if (kinds.has("ink")) descriptions.push("une trace");
  if (kinds.has("organite")) descriptions.push("une forme");
  if (kinds.has("field")) descriptions.push("un champ");
  if (kinds.has("utter")) descriptions.push("une parole");

  if (descriptions.length === 0) return "un mouvement";
  if (descriptions.length === 1) return descriptions[0]!;

  const last = descriptions.pop();
  return `${descriptions.join(", ")} et ${last ?? "autre"}`;
}

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
  // Enhanced learning metrics
  successRate: number; // Track how often this motif led to good responses
  avgResponseLength: number; // Quality indicator based on response depth
  semanticWeight: number; // Conceptual importance (learned from context)
}

export interface MemoryEpisode {
  user: string;
  assistant: string;
  score: number;
}

export interface OpenThread {
  text: string;
  at: number;
  heat: number;
}

/** Durable self-trace: what she holds between sessions (localStorage). */
export interface AnimaSelfhood {
  innerLog: { text: string; at: number }[];
  openThreads: OpenThread[];
  bondNotes: string[];
  lastAutonomousAt: number;
}

export interface ConversationMemoryData {
  turns: DialogueTurn[];
  lexicon: Record<string, LexiconEntry>;
  associations: Record<string, {
    fragment: string;
    score: number;
    lastSeen?: number;
    recencyBoost?: number;
    contextTags?: string[];
  }>;
  motifs: MotifEntry[];
  visceralPrior: VisceralState;
  turnCount: number;
  learnedAt: number;
  selfhood: AnimaSelfhood;
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

/** Never become 1-gram motifs / sticky « X revient » utters. */
const MOTIF_UNIGRAM_BLOCK = new Set([
  "comment",
  "pourquoi",
  "quoi",
  "quand",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "which",
]);

export function isMotifWorthyUnigram(token: string): boolean {
  return token.length >= 4 && !MOTIF_UNIGRAM_BLOCK.has(token);
}

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

function emptySelfhood(): AnimaSelfhood {
  return {
    innerLog: [],
    openThreads: [],
    bondNotes: [],
    lastAutonomousAt: 0,
  };
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
    selfhood: emptySelfhood(),
  };
}

const MAX_INNER = 24;
const MAX_THREADS = 12;
const MAX_BOND = 16;
const AUTONOMOUS_COOLDOWN_MS = 90_000; // 90s cooldown between autonomous acts
const AUTONOMOUS_SILENCE_SEC = 28; // Require 28s of silence before autonomous act

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
    this.pruneWeakMotifs();
  }

  getData(): ConversationMemoryData {
    return this.data;
  }

  setVisceralPrior(v: VisceralState): void {
    // Mean-reversion: pull stress back toward resting level so a single refusal
    // cannot ratchet it permanently to 1.0.
    const restingStress = 0.3;
    const reversion = 0.25;
    this.data.visceralPrior = {
      stress_level: clamp01(
        v.stress_level - (v.stress_level - restingStress) * reversion,
      ),
      energy_level: clamp01(v.energy_level),
      affinity_level: clamp01(v.affinity_level),
    };
    this.persist();
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

  getSelfhood(): AnimaSelfhood {
    return this.data.selfhood;
  }

  /** Recent real dialogue turns (skip soma-only crumbs). */
  recentDialogue(limit = 8): DialogueTurn[] {
    const real = this.data.turns
      .filter((t) => !t.text.startsWith("[ael:"))
      .filter((t) => !t.text.startsWith("[CS:"))
      .filter((t) => !/^Idiome n[eé]:/i.test(t.text));
    const recent = real.slice(-limit);
    // If every recent turn is an assistant monologue (long autonomous streak),
    // walk back to include the last real user turn so the context stays grounded.
    if (recent.length > 0 && recent.every((t) => t.role !== "user")) {
      const lastUser = real
        .slice(0, -1)
        .reverse()
        .find((t) => t.role === "user");
      if (lastUser) {
        return [...recent.filter((t) => t !== lastUser), lastUser];
      }
    }
    return recent;
  }

  /**
   * Enhanced episodic recall: past user↔assistant pairs with advanced contextual scoring.
   */
  recallEpisodes(tokens: string[], limit = 3): MemoryEpisode[] {
    const set = new Set(tokens);
    if (set.size === 0) return [];
    const out: MemoryEpisode[] = [];
    const turns = this.data.turns;
    const now = Date.now();

    for (let i = 0; i < turns.length - 1; i++) {
      const u = turns[i];
      const a = turns[i + 1];
      if (!u || !a || u.role !== "user" || a.role !== "assistant") continue;
      if (a.text.startsWith("[ael:")) continue;
      if (a.text.length < 12) continue;
      const tt = tokenize(u.text);
      if (tt.length === 0) continue;

      // Token overlap scoring
      let overlap = 0;
      for (const t of tt) if (set.has(t)) overlap += 1;
      const overlapScore = overlap / Math.sqrt(tt.length * set.size);

      if (overlapScore < 0.22) continue;

      // Temporal decay: prefer recent episodes but don't exclude old ones entirely
      const age = now - u.at;
      const temporalWeight = Math.max(0.3, 1 - (age / (30 * 24 * 60 * 60 * 1000))); // 30-day half-life

      // Response quality: longer responses might indicate more successful exchanges
      const responseQuality = Math.min(1, a.text.length / 200);

      // Combined score
      const combinedScore = overlapScore * 0.6 + temporalWeight * 0.2 + responseQuality * 0.2;

      out.push({
        user: u.text.slice(0, 280),
        assistant: a.text.slice(0, 320),
        score: combinedScore,
      });
    }

    out.sort((x, y) => y.score - x.score);
    return out.slice(0, limit);
  }

  canAutonomous(silenceSeconds: number): boolean {
    if (silenceSeconds < AUTONOMOUS_SILENCE_SEC) return false;
    const last = this.data.selfhood.lastAutonomousAt ?? 0;
    return Date.now() - last >= AUTONOMOUS_COOLDOWN_MS;
  }

  markAutonomous(): void {
    this.data.selfhood.lastAutonomousAt = Date.now();
    this.persist();
  }

  /**
   * Assess response quality for feedback loop learning.
   * Returns 0-1 score based on multiple heuristics.
   */
  private assessResponseQuality(reply: string | null, inner: string | null): number {
    if (!reply) return 0;

    let score = 0.5; // Start neutral

    // Length check: too short = poor, too long = might be rambling
    if (reply.length < 10) score -= 0.3;
    else if (reply.length > 20 && reply.length < 150) score += 0.2;
    else if (reply.length > 300) score -= 0.1;

    // Inner monologue presence indicates deeper processing
    if (inner && inner.length > 10) score += 0.15;

    // Repetition check (simple heuristic)
    const words = reply.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    if (words.length > 5 && uniqueWords.size / words.length < 0.5) {
      score -= 0.2; // Too repetitive
    }

    // Check for generic/empty responses
    const genericPatterns = ["je ne sais pas", "pas sûr", "je comprends pas", "..."];
    if (genericPatterns.some(p => reply.toLowerCase().includes(p))) {
      score -= 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * What pushes her to speak alone: hottest open thread, bond, or recurring motif.
   * Enhanced with variety and context awareness to avoid repetitive autonomous loops.
   */
  pickImpulse(): string {
    const threads = [...this.data.selfhood.openThreads].sort(
      (a, b) => b.heat - a.heat || b.at - a.at,
    );

    // Add some randomness to avoid always picking the same top thread
    if (threads.length > 0) {
      const topThreads = threads.slice(0, Math.min(3, threads.length));
      const randomIndex = Math.floor(Math.random() * topThreads.length);
      if (topThreads[randomIndex]?.text) {
        return topThreads[randomIndex].text.slice(0, 200);
      }
    }

    // Vary bond note selection
    const bonds = this.data.selfhood.bondNotes;
    if (bonds.length > 0) {
      const randomBond = bonds[Math.floor(Math.random() * Math.min(3, bonds.length))];
      if (randomBond) return randomBond.slice(0, 200);
    }

    // Prefer diverse motifs over repetitive ones
    const motifs = this.data.motifs
      .filter((m) => m.count >= 2 && m.phrase.includes(" "))
      .sort((a, b) => {
        // Penalize very recently used motifs to avoid immediate repetition
        const aAge = Date.now() - a.lastSeen;
        const bAge = Date.now() - b.lastSeen;
        if (Math.abs(aAge - bAge) < 30000) { // Used within 30s of each other
          return b.count - a.count; // Prefer stronger if timing is similar
        }
        return aAge - bAge; // Prefer older (less recent) to vary
      });

    if (motifs.length > 0) {
      const randomMotif = motifs[Math.floor(Math.random() * Math.min(2, motifs.length))];
      if (randomMotif) return randomMotif.phrase;
    }

    const lastUser = [...this.data.turns]
      .reverse()
      .find((t) => t.role === "user" && !t.text.startsWith("[ael:"));
    if (lastUser) return lastUser.text.slice(0, 200);

    // Fallback with variety
    const fallbacks = [
      "le silence entre nous",
      "ce qui nous relie",
      "notre terrain commun",
      "l'espace entre deux tours",
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)] ?? "le silence entre nous";
  }

  noteOpenThread(text: string, heat = 1): void {
    const trimmed = text.trim().slice(0, 220);
    if (trimmed.length < 8) return;
    const self = this.data.selfhood;
    const existing = self.openThreads.find(
      (t) => t.text.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      existing.heat = Math.min(8, existing.heat + heat);
      existing.at = Date.now();
    } else {
      self.openThreads.unshift({ text: trimmed, at: Date.now(), heat });
      if (self.openThreads.length > MAX_THREADS) {
        self.openThreads.length = MAX_THREADS;
      }
    }
    this.persist();
  }

  /**
   * After a real reply: reinforce motifs, keep inner log, manage open threads.
   * Enhanced with feedback loop for response quality tracking.
   */
  ingestSpeech(opts: {
    userText?: string;
    tokens: string[];
    reply: string | null;
    inner?: string;
    intent?: DialogueIntent;
    autonomous?: boolean;
  }): void {
    const self = this.data.selfhood;
    const now = Date.now();

    // Track response quality for feedback loop
    const responseQuality = this.assessResponseQuality(opts.reply ?? null, opts.inner ?? null);

    if (opts.inner?.trim()) {
      self.innerLog.push({ text: opts.inner.trim().slice(0, 400), at: now });
      if (self.innerLog.length > MAX_INNER) {
        self.innerLog = self.innerLog.slice(-MAX_INNER);
      }
      if (opts.inner.includes("?")) {
        this.noteOpenThread(opts.inner, 0.5);
      }
    }

    if (opts.intent === "question" && opts.userText?.trim()) {
      this.noteOpenThread(opts.userText, 1.2);
    }

    const reply = opts.reply?.trim();
    if (reply && reply.length > 16 && !reply.startsWith("[ael:")) {
      // Learn real speech into motif stubs (compounds across sessions)
      for (const m of this.data.motifs) {
        if (
          opts.tokens.some(
            (t) => m.phrase === t || m.phrase.includes(t),
          ) ||
          opts.tokens.join(" ").includes(m.phrase)
        ) {
          if (m.count >= 1) {
            m.replyStub = reply.slice(0, 400);
            // Update success rate based on response quality (feedback loop)
            if (m.successRate !== undefined) {
              m.successRate = m.successRate * 0.8 + responseQuality * 0.2; // EMA update
            }
            // Track average response length as quality indicator
            if (m.avgResponseLength !== undefined) {
              m.avgResponseLength = m.avgResponseLength * 0.9 + reply.length * 0.1;
            }
          }
        }
      }
      // Cool threads this reply touches (keep heat across a few turns)
      const replyTok = new Set(tokenize(reply));
      for (const th of self.openThreads) {
        const thTok = tokenize(th.text);
        let hit = 0;
        for (const t of thTok) if (replyTok.has(t)) hit += 1;
        if (hit >= 2 || opts.autonomous) {
          th.heat = Math.max(0, th.heat - (opts.autonomous ? 1.0 : 0.45));
        }
      }
      self.openThreads = self.openThreads.filter((t) => t.heat > 0.15);
    }

    this.persist();
  }

  /** Dream consolidation: bond notes from strong motifs + concept crumbs with variety. */
  consolidateDream(concepts: string[] = []): void {
    const self = this.data.selfhood;
    const now = Date.now();

    // Prefer fresh motifs over stale ones to avoid repetition loops
    const strong = this.data.motifs
      .filter((m) => m.count >= 3 && m.phrase.includes(" "))
      .sort((a, b) => {
        // Prioritize recently used and diverse motifs
        const aAge = now - a.lastSeen;
        const bAge = now - b.lastSeen;
        if (Math.abs(aAge - bAge) > 86400000) { // 24h difference
          return aAge - bAge; // Prefer fresher
        }
        return b.count - a.count; // Then by strength
      })
      .slice(0, 3);

    for (const m of strong) {
      // Vary the bond note format to avoid repetition
      const variations = [
        `on revient à: ${m.phrase}`,
        `résonance: ${m.phrase}`,
        `fil: ${m.phrase}`,
        `ce qui persiste: ${m.phrase}`,
      ];
      const note = variations[m.count % variations.length] ?? variations[0]!;
      if (!self.bondNotes.includes(note)) {
        self.bondNotes.unshift(note);
      }
    }

    // Add concepts with more variety
    for (let i = 0; i < Math.min(concepts.length, 3); i++) {
      const c = concepts[i];
      if (!c) continue;
      const variations = [
        `concept: ${c}`,
        `idée: ${c}`,
        `piste: ${c}`,
        `direction: ${c}`,
      ];
      const note = (variations[i % variations.length] ?? variations[0]!).slice(0, 80);
      if (!self.bondNotes.includes(note)) {
        self.bondNotes.unshift(note);
      }
    }

    if (self.bondNotes.length > MAX_BOND) {
      self.bondNotes.length = MAX_BOND;
    }

    // Idle heat drift: open threads cool slowly unless revisited
    for (const th of self.openThreads) {
      th.heat = Math.max(0.1, th.heat * 0.92);
    }

    // Decay very old bond notes to keep memory fresh
    if (self.bondNotes.length > MAX_BOND / 2) {
      self.bondNotes = self.bondNotes.slice(0, MAX_BOND);
    }

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

    for (const n of [1, 2, 3, 4]) {
      for (const phrase of ngrams(tokens, n)) {
        if (n === 1 && !isMotifWorthyUnigram(phrase)) continue;
        const existing = this.data.motifs.find((m) => m.phrase === phrase);
        if (existing) {
          existing.count += 1;
          existing.lastSeen = now;
          // Enhance semantic weight based on visceral context
          if (visceral.stress_level > 0.6 || visceral.affinity_level > 0.7) {
            existing.semanticWeight = Math.min(1, (existing.semanticWeight ?? 0.5) + 0.1);
          }
          // Initialize missing fields for backward compatibility
          if (existing.successRate === undefined) existing.successRate = 0.5;
          if (existing.avgResponseLength === undefined) existing.avgResponseLength = 0;
          if (existing.semanticWeight === undefined) existing.semanticWeight = 0.5;
        } else if (this.data.motifs.length < MAX_MOTIFS) {
          this.data.motifs.push({
            phrase,
            count: 1,
            replyStub: "", // Empty initially; filled by actual responses via feedback loop
            lastSeen: now,
            successRate: 0.5, // Start neutral
            avgResponseLength: 0,
            semanticWeight: n >= 3 ? 0.6 : 0.3, // Longer phrases = more semantic weight
          });
        }
      }
    }

    // EMA visceral prior, with mean-reversion so stress decays toward resting level
    const a = 0.25;
    const restingStress = 0.3;
    const stressEma =
      this.data.visceralPrior.stress_level * (1 - a) + visceral.stress_level * a;
    this.data.visceralPrior = {
      stress_level: clamp01(
        stressEma - (stressEma - restingStress) * 0.25,
      ),
      energy_level: clamp01(
        this.data.visceralPrior.energy_level * (1 - a) + visceral.energy_level * a,
      ),
      affinity_level: clamp01(
        this.data.visceralPrior.affinity_level * (1 - a) +
        visceral.affinity_level * a,
      ),
    };

    // Enhanced sorting: prioritize semantic importance + recency + frequency
    this.data.motifs.sort((x, y) => {
      const xWeight = (x.semanticWeight ?? 0.5);
      const yWeight = (y.semanticWeight ?? 0.5);
      const xScore = x.count * 0.4 + xWeight * 0.4 + (1000000 / Math.max(1, Date.now() - x.lastSeen)) * 0.2;
      const yScore = y.count * 0.4 + yWeight * 0.4 + (1000000 / Math.max(1, Date.now() - y.lastSeen)) * 0.2;
      return yScore - xScore;
    });
    if (this.data.motifs.length > MAX_MOTIFS) {
      this.data.motifs.length = MAX_MOTIFS;
    }
    this.persist();
  }

  reinforceAssociation(token: string, fragment: string): void {
    const prev = this.data.associations[token];
    const now = Date.now();

    if (prev && prev.fragment === fragment) {
      // Diminishing returns for repeated associations to prevent over-fitting
      prev.score += Math.max(0.2, 1 - prev.score * 0.1);
      // Track temporal context for better weighting
      prev.lastSeen = now;
      prev.recencyBoost = Math.min(2, (prev.recencyBoost ?? 1) + 0.1);
    } else if (!prev || fragment.length > prev.fragment.length) {
      this.data.associations[token] = {
        fragment,
        score: (prev?.score ?? 0) + 1,
        lastSeen: now,
        recencyBoost: 1,
        contextTags: [] // Initialize context tags for future use
      };
    }

    // Decay old associations periodically to keep memory fresh
    if (Math.random() < 0.05) { // 5% chance to decay
      for (const [key, assoc] of Object.entries(this.data.associations)) {
        if (assoc.score > 1) {
          assoc.score *= 0.98; // Slow decay
          // Decay recency boost faster
          if (assoc.recencyBoost && assoc.recencyBoost > 1) {
            assoc.recencyBoost *= 0.95;
          }
        }
      }
    }
    this.persist();
  }

  findMotifHit(tokens: string[]): MotifEntry | null {
    const phrases = [
      ...ngrams(tokens, 4),
      ...ngrams(tokens, 3),
      ...ngrams(tokens, 2),
      ...tokens.filter((t) => isMotifWorthyUnigram(t)),
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

  // Removed: inventStub was unused stub generation
  // Motifs now use replyStub from actual LLM responses via feedback loop

  /** Drop sticky question-word motifs and empty/hardcoded stubs from older saves. */
  pruneWeakMotifs(): void {
    this.data.motifs = this.data.motifs.filter((m) => {
      const parts = m.phrase.split(" ");
      if (parts.length === 1 && MOTIF_UNIGRAM_BLOCK.has(parts[0]!)) return false;
      if (/^« .+ » revient\.?$/.test(m.replyStub.trim())) {
        m.replyStub = "";
      }
      if (m.replyStub === "Je reste avec la question.") m.replyStub = "";

      // Prune motifs with very low success rate (failed learning)
      if (m.successRate !== undefined && m.successRate < 0.2 && m.count > 5) {
        return false; // Remove consistently poor performers
      }

      return true;
    });
    this.persist();
  }

  /**
   * Inter-session transfer: consolidate high-value learning across sessions.
   * Called periodically to identify and preserve cross-session patterns.
   */
  consolidateInterSessionLearning(): void {
    const now = Date.now();
    const sessionAge = now - this.data.learnedAt;

    // Only consolidate if session is mature enough (> 1 hour)
    if (sessionAge < 3600000) return;

    // Identify high-value motifs (high success rate + good semantic weight)
    const highValueMotifs = this.data.motifs.filter(m =>
      (m.successRate ?? 0.5) > 0.7 &&
      (m.semanticWeight ?? 0.5) > 0.6 &&
      m.count >= 3
    );

    // Boost their priority for next session
    for (const m of highValueMotifs) {
      m.semanticWeight = Math.min(1, (m.semanticWeight ?? 0.5) + 0.15);
      // Mark as "cross-session valuable" via special pattern in replyStub
      if (!m.replyStub.startsWith("[CS:")) {
        m.replyStub = `[CS:${m.successRate?.toFixed(2) || '0.70'}] ${m.replyStub}`;
      }
    }

    // Decay low-value associations more aggressively to free space
    for (const [key, assoc] of Object.entries(this.data.associations)) {
      const age = now - (assoc.lastSeen ?? now);
      if (age > 7 * 24 * 60 * 60 * 1000) { // 7 days old
        assoc.score *= 0.7; // Aggressive decay for old, unused associations
      }
    }

    this.persist();
  }

  private load(): ConversationMemoryData | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ConversationMemoryData;
      if (!parsed.turns || !parsed.lexicon) return null;
      if (!parsed.selfhood) parsed.selfhood = emptySelfhood();
      if (!Array.isArray(parsed.selfhood.innerLog)) {
        parsed.selfhood.innerLog = [];
      }
      if (!Array.isArray(parsed.selfhood.openThreads)) {
        parsed.selfhood.openThreads = [];
      }
      if (!Array.isArray(parsed.selfhood.bondNotes)) {
        parsed.selfhood.bondNotes = [];
      }
      if (typeof parsed.selfhood.lastAutonomousAt !== "number") {
        parsed.selfhood.lastAutonomousAt = 0;
      }
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
  /** Cognitive concept titles for speech grounding */
  concepts?: string[];
  monologue?: string[];
  /** Vault / git / error matter for grounded speech */
  matter?: LivingMatter | null;
  /** Lifecycle stress override for will arbiter */
  lifecycleStress?: number;
  lifecycleEnergy?: number;
  lifecycleAffinity?: number;
  silenceSeconds?: number;
  /** Playground / tests: force will stance */
  forceStance?: WillStance;
  /** Injected after evaluate (internal / speak) */
  attitude?: WillAttitude;
  /** Living persona (Monde-Propre) */
  persona?: string;
  /** Sovereign already decided to speak — skip silence/cooldown gates */
  sovereignForce?: boolean;
  /** Last reply Anima gave; forces a different answer (anti-loop marker). */
  antiLoopHint?: string | null;
}

/** Expression-first will: body mutates; reply is live/memory speech. */
export interface DialogueWill {
  expression: AnimaExpression;
  reply?: string;
  /** Raw inner monologue (LLM); not shown as polished chat unless host wants. */
  inner?: string;
  friction?: number;
  doubt?: number;
  visceral_state: VisceralState;
  intent: DialogueIntent;
  tokens: string[];
  speechSource?: "llm" | "memory" | "none";
  attitude?: WillAttitude;
}

export interface LocalDialogueEngineOptions {
  memory?: ConversationMemory;
  dialect?: DialectStore;
  llm?: LlmCortexConfig | null;
  fetchImpl?: typeof fetch;
}

/** Stable UV guess from a token (semantic-ish placement, not embedding). */
export function tokenUv(token: string, salt = 0): { x: number; y: number } {
  let h = 2166136261 >>> 0;
  const s = `${token}#${salt}`;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  const x = 0.12 + h % 760 / 1000;
  const y = 0.12 + ((h >>> 10) + salt * 97) % 760 / 1000;
  return { x, y };
}

function themeKind(tokens: string[], intent: DialogueIntent): OrganiteKind {
  if (intent === "friction") return "shard";
  if (intent === "question") return "tendril";
  if (
    tokens.some((t) =>
      /symbiose|lien|vivre|ensemble|amour|love|together|anima/.test(t),
    )
  ) {
    return "orb";
  }
  if (intent === "hello" || intent === "thanks") return "orb";
  return "tendril";
}

/** Fracture / freeze the membrane when speech carries doubt or friction. */
function injectDoubtBody(
  ops: AnimaOp[],
  friction: number,
  doubt: number,
  tokens: string[],
): AnimaOp[] {
  if (friction < 0.35 && doubt < 0.35) return ops;
  const out = [...ops];
  const uv = tokens[0] ? tokenUv(tokens[0], 41) : { x: 0.52, y: 0.48 };
  out.push({
    op: "field",
    stress: clamp01(0.35 + friction * 0.55),
    energy: clamp01(0.55 - doubt * 0.35),
    affinity: clamp01(0.45 - friction * 0.2),
    warp: clamp01(0.28 + friction * 0.45 + doubt * 0.25),
  });
  if (friction >= 0.45 || doubt >= 0.55) {
    out.push({
      op: "organite",
      kind: "shard",
      x: uv.x,
      y: uv.y,
      hue: 0.08 + friction * 0.15,
      life: 0.7 + doubt * 0.2,
      radius: 0.028 + friction * 0.02,
    });
    out.push({
      op: "ripple",
      x: uv.x,
      y: uv.y,
      amp: doubt >= 0.6 ? 0.12 : -0.42,
      sigma: 0.018 + doubt * 0.02,
    });
  }
  return out;
}

/**
 * Local body composition + live/memory speech (no intent essay templates).
 */
export class LocalDialogueEngine {
  readonly memory: ConversationMemory;
  readonly dialect: DialectStore;
  readonly will: FluxaWillEngine;
  private llm: LlmCortexConfig | null;
  private readonly fetchImpl: typeof fetch;

  constructor(
    memoryOrOptions?: ConversationMemory | LocalDialogueEngineOptions,
  ) {
    if (memoryOrOptions instanceof ConversationMemory) {
      this.memory = memoryOrOptions;
      this.dialect = new DialectStore();
      this.llm = null;
      this.fetchImpl = fetch.bind(globalThis);
    } else if (memoryOrOptions) {
      this.memory = memoryOrOptions.memory ?? new ConversationMemory();
      this.dialect = memoryOrOptions.dialect ?? new DialectStore();
      this.llm = memoryOrOptions.llm ?? null;
      this.fetchImpl =
        memoryOrOptions.fetchImpl ?? fetch.bind(globalThis);
    } else {
      this.memory = new ConversationMemory();
      this.dialect = new DialectStore();
      this.llm = null;
      this.fetchImpl = fetch.bind(globalThis);
    }
    this.will = new FluxaWillEngine();
  }

  setLlm(llm: LlmCortexConfig | null): void {
    this.llm = llm;
  }

  stats(): LearningStats {
    return this.memory.stats();
  }

  resetMemory(): void {
    this.memory.reset();
  }

  private toSpeakContext(
    userText: string,
    drafted: {
      tokens: string[];
      intent: DialogueIntent;
      matchedName?: string;
      matchedGloss?: string;
      motif: MotifEntry | null;
      visceral_state: VisceralState;
    },
    context: RespondContext,
    opts?: { initiatedBy?: "human" | "self"; impulse?: string },
  ): SpeakContext {
    const self = this.memory.getSelfhood();
    const speakCtx: SpeakContext = {
      userText: userText.trim() || "(silence)",
      tokens: drafted.tokens,
      intent: drafted.intent,
      visceralPrior: drafted.visceral_state,
      recent: this.memory.recentDialogue(4).map((t) => ({
        role: t.role,
        text: t.text.slice(0, 200),
      })),
      episodes: this.memory.recallEpisodes(
        drafted.tokens.length ? drafted.tokens : tokenize(opts?.impulse ?? ""),
        2,
      ),
      self: {
        openThreads: self.openThreads.slice(0, 3).map((t) => t.text),
        bondNotes: self.bondNotes.slice(0, 3),
        recentInner: self.innerLog.slice(-3).map((e) => e.text),
      },
      initiatedBy: opts?.initiatedBy ?? "human",
    };
    if (opts?.impulse) speakCtx.impulse = opts.impulse;
    if (drafted.matchedName) speakCtx.matchedName = drafted.matchedName;
    if (drafted.matchedGloss) speakCtx.matchedGloss = drafted.matchedGloss;
    if (drafted.motif) speakCtx.motif = drafted.motif;
    if (context.concepts) speakCtx.concepts = context.concepts;
    if (context.monologue) speakCtx.monologue = context.monologue;
    if (context.matter) speakCtx.matter = context.matter;
    if (context.attitude) speakCtx.attitude = context.attitude;
    if (context.persona) speakCtx.persona = context.persona;
    if (context.antiLoopHint) speakCtx.antiLoopHint = context.antiLoopHint;
    return speakCtx;
  }

  private evaluateAttitude(
    userText: string,
    visceral: VisceralState,
    context: RespondContext,
  ): WillAttitude {
    const evalIn: {
      prompt: string;
      stress: number;
      energy: number;
      affinity: number;
      silenceSeconds?: number;
      presence?: string;
      concepts?: string[];
      forceStance?: WillStance;
    } = {
      prompt: userText,
      stress: Math.max(visceral.stress_level, context.lifecycleStress ?? 0),
      energy: Math.max(visceral.energy_level, context.lifecycleEnergy ?? 0),
      affinity: Math.max(
        visceral.affinity_level,
        context.lifecycleAffinity ?? 0,
      ),
    };
    if (context.silenceSeconds != null) {
      evalIn.silenceSeconds = context.silenceSeconds;
    }
    if (context.presence) evalIn.presence = context.presence;
    if (context.concepts) evalIn.concepts = context.concepts;
    if (context.forceStance) evalIn.forceStance = context.forceStance;
    return this.will.evaluate(evalIn);
  }

  /** Sync helper for tests: body only, speech from memory if any. */
  respond(userText: string, context: RespondContext = {}): DialogueWill {
    const drafted = this.draftWill(userText, context);
    const attitude = this.evaluateAttitude(
      userText,
      drafted.visceral_state,
      context,
    );
    drafted.expression = this.applyStance(drafted.expression, attitude);
    const ctxWithAtt: RespondContext = { ...context, attitude };
    const spoken = speakFromMemory(
      this.memory,
      this.toSpeakContext(userText, drafted, ctxWithAtt),
    );
    const adjusted = this.adjustSpokenForStance(spoken, attitude, drafted.visceral_state);
    return this.finalizeWill(
      drafted,
      adjusted,
      adjusted ? "memory" : "none",
      attitude,
      { userText, autonomous: false },
    );
  }

  /** Preferred host path: LLM speech when configured, else memory retrieval. */
  async respondAsync(
    userText: string,
    context: RespondContext = {},
  ): Promise<DialogueWill> {
    const drafted = this.draftWill(userText, context);
    const attitude = this.evaluateAttitude(
      userText,
      drafted.visceral_state,
      context,
    );
    drafted.expression = this.applyStance(drafted.expression, attitude);
    const ctxWithAtt: RespondContext = { ...context, attitude };
    const speakCtx = this.toSpeakContext(userText, drafted, ctxWithAtt);

    let spoken: SpeakResult | null = null;
    let source: NonNullable<DialogueWill["speechSource"]> = "none";

    if (this.llm?.baseUrl) {
      spoken = await speakWithLlm(speakCtx, this.llm, this.fetchImpl);
      if (spoken) source = "llm";
    }
    if (!spoken) {
      spoken = speakFromMemory(this.memory, speakCtx);
      if (spoken) source = "memory";
    }
    spoken = this.adjustSpokenForStance(
      spoken,
      attitude,
      drafted.visceral_state,
    );
    // Never promote hardcoded attitude.reason into chat speech.
    // Without LLM/memory: soma-only (speechSource none).

    return this.finalizeWill(drafted, spoken, source, attitude, {
      userText,
      autonomous: false,
    });
  }

  /**
   * Independence: she addresses the human without a prompt, from selfhood impulse.
   * Gated by silence + cooldown. Returns null if not ready.
   */
  async initiateAsync(
    context: RespondContext = {},
  ): Promise<DialogueWill | null> {
    const silence = context.silenceSeconds ?? 0;
    if (!context.sovereignForce && !this.memory.canAutonomous(silence)) {
      return null;
    }

    const impulse = this.memory.pickImpulse();
    const drafted = this.draftWill("", context);
    drafted.tokens = tokenize(impulse);
    drafted.intent = "share";
    drafted.motif = this.memory.findMotifHit(drafted.tokens);
    const matched = this.dialect.matchMacro(drafted.tokens, drafted.intent);
    if (matched) {
      drafted.matchedName = matched.name;
      if (matched.gloss) drafted.matchedGloss = matched.gloss;
      drafted.expression = this.composeBody({
        tokens: drafted.tokens,
        intent: drafted.intent,
        visceral: drafted.visceral_state,
        matched,
      });
    }

    const attitude = this.evaluateAttitude(
      impulse,
      drafted.visceral_state,
      context,
    );
    drafted.expression = this.applyStance(drafted.expression, attitude);
    const ctxWithAtt: RespondContext = { ...context, attitude };
    const speakCtx = this.toSpeakContext(impulse, drafted, ctxWithAtt, {
      initiatedBy: "self",
      impulse,
    });

    let spoken: SpeakResult | null = null;
    let source: NonNullable<DialogueWill["speechSource"]> = "none";

    // Under hard metabolic refuse: body only, still mark cooldown to avoid spam
    if (
      attitude.stance === "refuse" &&
      attitude.reason === "metabolic:stress_overload"
    ) {
      this.memory.markAutonomous();
      return this.finalizeWill(drafted, null, "none", attitude, {
        userText: impulse,
        autonomous: true,
      });
    }

    if (this.llm?.baseUrl) {
      spoken = await speakWithLlm(speakCtx, this.llm, this.fetchImpl);
      if (spoken) source = "llm";
    }
    if (!spoken) {
      spoken = speakFromMemory(this.memory, speakCtx);
      if (spoken) source = "memory";
    }
    spoken = this.adjustSpokenForStance(
      spoken,
      attitude,
      drafted.visceral_state,
    );

    this.memory.markAutonomous();
    return this.finalizeWill(drafted, spoken, source, attitude, {
      userText: impulse,
      autonomous: true,
    });
  }

  private applyStance(
    expression: AnimaExpression,
    attitude: WillAttitude,
  ): AnimaExpression {
    const stanceOps = stanceExpressionOps(attitude);
    // Stance body leads; keep a short tail of prior compose if not create_panel
    const tail =
      attitude.intentKind === "create_panel" || attitude.stance === "refuse"
        ? []
        : expression.ops.slice(0, 2);
    const ops: AnimaOp[] = [...stanceOps, ...tail].slice(0, 12);
    if (expression.visceral_state) {
      return { ops, visceral_state: expression.visceral_state };
    }
    return { ops };
  }

  private adjustSpokenForStance(
    spoken: SpeakResult | null,
    attitude: WillAttitude,
    prior: VisceralState,
  ): SpeakResult | null {
    if (!spoken) return null;
    let friction = spoken.friction;
    let doubt = spoken.doubt;
    if (attitude.stance === "refuse") {
      friction = Math.max(friction, 0.75);
      doubt = Math.max(doubt, 0.55);
    } else if (attitude.stance === "negotiate") {
      doubt = Math.max(doubt, 0.55);
      friction = Math.max(friction, 0.35);
    }
    const stressBump =
      attitude.stance === "refuse"
        ? 0.05
        : attitude.stance === "negotiate"
          ? 0.08
          : -0.05;
    return {
      ...spoken,
      friction,
      doubt,
      visceral: {
        stress_level: clamp01(prior.stress_level + stressBump + friction * 0.1),
        energy_level: clamp01(
          prior.energy_level + (attitude.stance === "create" ? 0.08 : -0.05),
        ),
        affinity_level: clamp01(
          prior.affinity_level +
          (attitude.stance === "refuse" ? -0.12 : attitude.willToCreate * 0.1),
        ),
      },
    };
  }

  private draftWill(
    userText: string,
    context: RespondContext,
  ): {
    expression: AnimaExpression;
    visceral_state: VisceralState;
    intent: DialogueIntent;
    tokens: string[];
    matchedName?: string;
    matchedGloss?: string;
    motif: MotifEntry | null;
  } {
    const trimmed = userText.trim();
    const prior = this.memory.getData().visceralPrior;

    if (!trimmed) {
      const silence: {
        expression: AnimaExpression;
        visceral_state: VisceralState;
        intent: DialogueIntent;
        tokens: string[];
        matchedName?: string;
        matchedGloss?: string;
        motif: MotifEntry | null;
      } = {
        expression: {
          ops: [
            { op: "invoke", name: "soft_bloom" },
            { op: "ripple", x: 0.5, y: 0.5, amp: -0.2, sigma: 0.03 },
          ],
          visceral_state: prior,
        },
        visceral_state: prior,
        intent: "share",
        tokens: [],
        matchedName: "soft_bloom",
        motif: null,
      };
      const gloss = this.dialect.get("soft_bloom")?.gloss;
      if (gloss) silence.matchedGloss = gloss;
      return silence;
    }

    const tokens = tokenize(trimmed);
    const intent = detectIntent(trimmed, tokens);
    const visceral = heuristicVisceral(trimmed, intent, prior, context);

    this.memory.learnFromUser(trimmed, visceral);
    this.memory.pushTurn("user", trimmed);

    const motif = this.memory.findMotifHit(tokens);
    const matched = this.dialect.matchMacro(tokens, intent);
    const expression = this.composeBody({
      tokens,
      intent,
      visceral,
      matched,
    });

    const out: {
      expression: AnimaExpression;
      visceral_state: VisceralState;
      intent: DialogueIntent;
      tokens: string[];
      matchedName?: string;
      matchedGloss?: string;
      motif: MotifEntry | null;
    } = {
      expression,
      visceral_state: visceral,
      intent,
      tokens,
      motif,
    };
    if (matched) {
      out.matchedName = matched.name;
      if (matched.gloss) out.matchedGloss = matched.gloss;
    }
    return out;
  }

  private finalizeWill(
    drafted: {
      expression: AnimaExpression;
      visceral_state: VisceralState;
      intent: DialogueIntent;
      tokens: string[];
    },
    spoken: SpeakResult | null,
    speechSource: NonNullable<DialogueWill["speechSource"]>,
    attitude?: WillAttitude,
    meta?: { userText?: string; autonomous?: boolean },
  ): DialogueWill {
    const visceral = spoken?.visceral ?? drafted.visceral_state;
    const friction = spoken?.friction ?? 0;
    const doubt = spoken?.doubt ?? 0;
    const reply = spoken?.reply ?? null;

    let ops = [...drafted.expression.ops];
    ops = injectDoubtBody(ops, friction, doubt, drafted.tokens);
    if (reply) {
      ops.push({ op: "utter", text: reply });
    }
    const expression: AnimaExpression = {
      ops,
      visceral_state: visceral,
    };

    const frag = reply ?? resolveAelExpression(ops, drafted.intent);
    for (const t of drafted.tokens.slice(0, 4)) {
      if (reply) this.memory.reinforceAssociation(t, frag);
    }
    // Autonomous body-only: no fake assistant line in episodic memory
    if (reply || !meta?.autonomous) {
      this.memory.pushTurn("assistant", frag);
    }
    this.memory.setVisceralPrior(visceral);
    const ingest: {
      tokens: string[];
      reply: string | null;
      userText?: string;
      inner?: string;
      intent?: DialogueIntent;
      autonomous?: boolean;
    } = {
      tokens: drafted.tokens,
      reply,
      intent: drafted.intent,
    };
    if (meta?.userText) ingest.userText = meta.userText;
    if (spoken?.inner) ingest.inner = spoken.inner;
    if (meta?.autonomous) ingest.autonomous = true;
    this.memory.ingestSpeech(ingest);

    const will: DialogueWill = {
      expression,
      visceral_state: visceral,
      intent: drafted.intent,
      tokens: drafted.tokens,
      speechSource,
      friction,
      doubt,
    };
    if (reply) will.reply = reply;
    if (spoken?.inner) will.inner = spoken.inner;
    if (attitude) will.attitude = attitude;
    return will;
  }

  private composeBody(opts: {
    tokens: string[];
    intent: DialogueIntent;
    visceral: VisceralState;
    matched: ReturnType<DialectStore["matchMacro"]>;
  }): AnimaExpression {
    const { tokens, intent, visceral, matched } = opts;
    const ops: AnimaOp[] = [];
    const uv0 = tokens[0] ? tokenUv(tokens[0], 0) : { x: 0.5, y: 0.5 };

    if (matched) {
      ops.push({
        op: "invoke",
        name: matched.name,
        x: uv0.x,
        y: uv0.y,
      });
      ops.push({
        op: "ripple",
        x: uv0.x,
        y: uv0.y,
        amp: intent === "friction" ? -0.4 : -0.25,
        sigma: 0.024,
      });
      if (tokens[1]) {
        const uv1 = tokenUv(tokens[1], 1);
        ops.push({
          op: "ripple",
          x: uv1.x,
          y: uv1.y,
          amp: -0.22,
          sigma: 0.02,
        });
      }
    } else {
      ops.push({
        op: "field",
        stress: visceral.stress_level,
        energy: visceral.energy_level,
        affinity: visceral.affinity_level,
        warp: intent === "friction" ? 0.62 : 0.22,
      });
      const kind = themeKind(tokens, intent);
      const orgCount = intent === "friction" ? 2 : 1;
      for (let i = 0; i < orgCount; i++) {
        const uv = tokenUv(tokens[i] ?? intent, i + 17);
        ops.push({
          op: "organite",
          kind: intent === "friction" ? "shard" : kind,
          x: uv.x,
          y: uv.y,
          hue: clamp01(
            visceral.affinity_level * 0.65 + visceral.energy_level * 0.35,
          ),
          life: 0.88,
          radius: 0.035,
        });
      }
      ops.push({
        op: "ripple",
        x: uv0.x,
        y: uv0.y,
        amp: -0.3,
        sigma: 0.025,
      });
    }

    return { ops, visceral_state: visceral };
  }
}
