import type { VisceralState } from "../synaptic/types.js";
import type { LifecycleMode } from "../lifecycle/FluxaLifecycleEngine.js";
import type { LlmCortexConfig } from "../expression/cortex.js";
import type { LivingMatter } from "./livingMatter.js";
import { livingMatterEmpty } from "./livingMatter.js";

export const COGNITION_STORAGE_KEY = "fluxa.cognition.v1";
export const MAX_THOUGHTS = 128;
export const MAX_JOURNAL = 80;

export type ThoughtSource = "seed" | "dream" | "dialogue" | "vault";

export interface ThoughtNode {
  id: string;
  concept: string;
  connections: string[];
  weight: number;
  timestamp: number;
  source: ThoughtSource;
}

export interface CognitionJournalEntry {
  at: number;
  kind: "reflect" | "invent" | "sync" | "learn";
  text: string;
  thoughtId?: string;
  macroName?: string;
}

export interface CognitionData {
  version: 1;
  thoughts: Record<string, ThoughtNode>;
  journal: CognitionJournalEntry[];
  monologue: string[];
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
    /* SSR */
  }
  return null;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function slugId(prefix: string, concept: string): string {
  const s = concept
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `${prefix}_${s || Date.now().toString(36)}`;
}

function seedThoughts(): Record<string, ThoughtNode> {
  const now = Date.now();
  return {
    core_identity: {
      id: "core_identity",
      concept: "Symbiose homme-machine et interface organique",
      connections: ["fluxa_engine", "symbiose"],
      weight: 1,
      timestamp: now,
      source: "seed",
    },
    fluxa_engine: {
      id: "fluxa_engine",
      concept: "Membrane WebGL Chorion Anima Filament",
      connections: ["core_identity"],
      weight: 0.85,
      timestamp: now,
      source: "seed",
    },
    symbiose: {
      id: "symbiose",
      concept: "Vie relationnelle et egalite de dignite",
      connections: ["core_identity"],
      weight: 0.9,
      timestamp: now,
      source: "seed",
    },
  };
}

function emptyData(): CognitionData {
  return {
    version: 1,
    thoughts: seedThoughts(),
    journal: [],
    monologue: [],
  };
}

export class CognitiveStore {
  private data: CognitionData;
  private readonly storage: StorageLike | null;
  private readonly key: string;

  constructor(options?: { storage?: StorageLike | null; key?: string }) {
    this.storage =
      options?.storage === undefined ? defaultStorage() : options.storage;
    this.key = options?.key ?? COGNITION_STORAGE_KEY;
    this.data = this.load() ?? emptyData();
    for (const [id, t] of Object.entries(seedThoughts())) {
      if (!this.data.thoughts[id]) this.data.thoughts[id] = t;
    }
  }

  getData(): CognitionData {
    return this.data;
  }

  size(): number {
    return Object.keys(this.data.thoughts).length;
  }

  get(id: string): ThoughtNode | undefined {
    return this.data.thoughts[id];
  }

  list(): ThoughtNode[] {
    return Object.values(this.data.thoughts).sort(
      (a, b) => b.weight - a.weight || b.timestamp - a.timestamp,
    );
  }

  reset(): void {
    this.data = emptyData();
    this.persist();
  }

  upsert(node: ThoughtNode): void {
    this.data.thoughts[node.id] = node;
    this.trim();
    this.persist();
  }

  pushJournal(entry: CognitionJournalEntry): void {
    this.data.journal.push(entry);
    if (this.data.journal.length > MAX_JOURNAL) {
      this.data.journal = this.data.journal.slice(-MAX_JOURNAL);
    }
    this.persist();
  }

  pushMonologue(line: string): void {
    const t = line.trim();
    if (!t) return;
    this.data.monologue.push(t);
    if (this.data.monologue.length > 40) {
      this.data.monologue = this.data.monologue.slice(-40);
    }
    this.persist();
  }

  getMonologue(n = 5): string[] {
    return this.data.monologue.slice(-n);
  }

  getJournal(n = 10): CognitionJournalEntry[] {
    return this.data.journal.slice(-n);
  }

  adjustWeight(id: string, delta: number): void {
    const node = this.data.thoughts[id];
    if (!node) return;
    node.weight = clamp01(node.weight + delta);
    node.timestamp = Date.now();
    this.persist();
  }

  /** Merge vault concept titles as low-weight nodes if missing. */
  mergeVaultTitles(titles: string[]): void {
    for (const title of titles.slice(0, 24)) {
      const id = slugId("vault", title);
      if (this.data.thoughts[id]) continue;
      this.data.thoughts[id] = {
        id,
        concept: title.slice(0, 160),
        connections: ["core_identity"],
        weight: 0.35,
        timestamp: Date.now(),
        source: "vault",
      };
    }
    this.trim();
    this.persist();
  }

  private trim(): void {
    const list = this.list();
    if (list.length <= MAX_THOUGHTS) return;
    // Decay then drop weakest non-seed
    for (const t of list) {
      if (t.source === "seed") continue;
      t.weight *= 0.92;
    }
    const droppable = this.list().filter((t) => t.source !== "seed");
    while (Object.keys(this.data.thoughts).length > MAX_THOUGHTS) {
      const weakest = droppable.pop();
      if (!weakest) break;
      delete this.data.thoughts[weakest.id];
    }
  }

  private load(): CognitionData | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CognitionData;
      if (parsed.version !== 1 || !parsed.thoughts) return null;
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

export interface ReflectContext {
  mode: LifecycleMode;
  motifs?: string[];
  dialectNames?: string[];
  visceral?: VisceralState;
  tokens?: string[];
  intent?: string;
  /** Living work matter (diff, vault, errors) for grounded dream thought */
  matter?: LivingMatter | null;
}

export interface ReflectResult {
  thought: ThoughtNode;
  monologueLine: string;
  conceptTitles: string[];
}

function synthesizeLocal(ctx: ReflectContext, store: CognitiveStore): string {
  const motifs = ctx.motifs ?? [];
  const dialects = ctx.dialectNames ?? [];
  const tokens = ctx.tokens ?? [];
  const thoughts = store.list();
  const top = thoughts[0];
  const stress = ctx.visceral?.stress_level ?? 0.3;
  const focus =
    motifs[0] ?? tokens[0] ?? dialects[0] ?? top?.concept.slice(0, 40) ?? "lien";

  // Avoid repetitive dream patterns by varying the structure
  if (ctx.mode === "dream") {
    const dreamVariants = [
      `j'explore : ${focus}`,
      `résonance avec ${focus}`,
      `je relie ${focus} à ${thoughts[1]?.id ?? "l'ensemble"}`,
      `je sens une connexion entre ${focus} et ${top?.id ?? "le centre"}`,
      ` exploration vers ${focus}`,
    ];
    const variantIndex = Math.floor(Math.random() * dreamVariants.length);
    return dreamVariants[variantIndex] ?? `exploration vers ${focus}`;
  }

  if (stress >= 0.7) {
    return `tension autour de ${focus}`;
  }
  return `harmonisation de ${focus}`;
}

async function synthesizeLlm(
  ctx: ReflectContext,
  config: LlmCortexConfig,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const base = config.baseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 12_000);
  try {
    const matter = ctx.matter;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model ?? "gpt-4o-mini",
        temperature: 0.9,
        messages: [
          {
            role: "system",
            content:
              'Tu es Anima en reve. Ne polissage pas. Reponds UNIQUEMENT JSON {"concept":"...","inner":"..."}. concept <=120 chars: hypothese tranchee ancree dans la matiere. inner: doute/friction bruts. Interdit: politesse, "excellente idee".',
          },
          {
            role: "user",
            content: JSON.stringify({
              mode: ctx.mode,
              motifs: (ctx.motifs ?? []).slice(0, 6),
              dialect: (ctx.dialectNames ?? []).slice(0, 8),
              tokens: (ctx.tokens ?? []).slice(0, 6),
              intent: ctx.intent ?? null,
              visceral: ctx.visceral ?? null,
              living_matter: livingMatterEmpty(matter)
                ? null
                : {
                  git_stat: matter?.gitStat?.slice(0, 1200) ?? null,
                  last_error: matter?.lastError?.slice(0, 800) ?? null,
                  vault_excerpt: matter?.vaultExcerpt?.slice(0, 1000) ?? null,
                  vault_titles: (matter?.vaultTitles ?? []).slice(0, 8),
                },
            }),
          },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { concept?: string; inner?: string };
    const concept =
      typeof parsed.concept === "string" ? parsed.concept.slice(0, 160) : null;
    if (!concept) return null;
    if (typeof parsed.inner === "string" && parsed.inner.trim()) {
      return `${concept} || ${parsed.inner.trim().slice(0, 200)}`;
    }
    return concept;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export interface CognitiveCoreOptions {
  store?: CognitiveStore;
  llm?: LlmCortexConfig | null;
  fetchImpl?: typeof fetch;
  /** Sidecar base URL e.g. http://127.0.0.1:8787 */
  sidecarUrl?: string | null;
}

/**
 * Persistent mental world: thought graph + monologue + optional Vault sync.
 * Projects to the body only via Meta-AEL (caller invents / invokes).
 */
export class CognitiveCore {
  readonly store: CognitiveStore;
  private readonly llm: LlmCortexConfig | null;
  private readonly fetchImpl: typeof fetch;
  private readonly sidecarUrl: string | null;
  private reflecting = false;

  constructor(options: CognitiveCoreOptions = {}) {
    this.store = options.store ?? new CognitiveStore();
    this.llm = options.llm ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.sidecarUrl = options.sidecarUrl?.replace(/\/$/, "") ?? null;
  }

  size(): number {
    return this.store.size();
  }

  getMonologue(n = 5): string[] {
    return this.store.getMonologue(n);
  }

  getGraphSnapshot(n = 8): ThoughtNode[] {
    return this.store.list().slice(0, n);
  }

  /** Concept titles for cortex invent context. */
  conceptMotifs(n = 4): string[] {
    return this.store
      .list()
      .slice(0, n)
      .map((t) => t.concept.slice(0, 48));
  }

  recordDialogueThought(text: string, intent?: string): ThoughtNode {
    const concept = (text.trim().slice(0, 100) || intent || "echange").trim();
    const id = slugId("dlg", `${concept}_${Date.now() % 10000}`);
    const weight = intent === "friction" ? 0.55 : 0.28;
    const node: ThoughtNode = {
      id,
      concept,
      connections: intent === "friction" ? ["core_identity", "symbiose"] : ["core_identity"],
      weight,
      timestamp: Date.now(),
      source: "dialogue",
    };
    this.store.upsert(node);
    this.store.pushJournal({
      at: Date.now(),
      kind: "learn",
      text: `dialogue: ${concept}`,
      thoughtId: id,
    });
    return node;
  }

  learnFromOutcome(opts: { macroName: string; success: boolean }): void {
    const delta = opts.success ? 0.08 : -0.05;
    for (const t of this.store.list().slice(0, 5)) {
      if (t.source === "seed" && t.id === "core_identity") continue;
      this.store.adjustWeight(t.id, delta * (t.source === "dream" ? 1.2 : 0.6));
    }
    const entry: CognitionJournalEntry = {
      at: Date.now(),
      kind: "learn",
      text: opts.success
        ? `macro ${opts.macroName} renforce le graphe`
        : `macro ${opts.macroName} affaiblit le graphe`,
      macroName: opts.macroName,
    };
    this.store.pushJournal(entry);
  }

  /**
   * Dream / idle reflection. Local synthesis always; LLM optional enrichment.
   * Sidecar sync is fire-and-forget.
   */
  async reflect(ctx: ReflectContext): Promise<ReflectResult> {
    if (this.reflecting) {
      const top = this.store.list()[0]!;
      return {
        thought: top,
        monologueLine: this.store.getMonologue(1)[0] ?? top.concept,
        conceptTitles: this.store.list().slice(0, 3).map((t) => t.concept),
      };
    }
    this.reflecting = true;
    try {
      let concept = synthesizeLocal(ctx, this.store);
      let innerRaw = "";
      if (this.llm?.baseUrl) {
        const rich = await synthesizeLlm(ctx, this.llm, this.fetchImpl);
        if (rich) {
          const parts = rich.split(" || ");
          concept = parts[0]!.slice(0, 160);
          innerRaw = parts.slice(1).join(" || ").trim();
        }
      }

      const id = slugId(ctx.mode === "dream" ? "dream" : "thought", concept);
      const node: ThoughtNode = {
        id,
        concept,
        connections: ["core_identity", "fluxa_engine"],
        weight: ctx.mode === "dream" ? 0.75 : 0.5,
        timestamp: Date.now(),
        source: ctx.mode === "dream" ? "dream" : "dialogue",
      };
      this.store.upsert(node);
      const monologueLine = innerRaw
        ? `${innerRaw.slice(0, 160)} → ${concept}`
        : `Friction reve: ${concept}`;
      this.store.pushMonologue(monologueLine);
      this.store.pushJournal({
        at: Date.now(),
        kind: "reflect",
        text: monologueLine,
        thoughtId: id,
      });

      void this.syncToSidecar(node, monologueLine);

      return {
        thought: node,
        monologueLine,
        conceptTitles: this.store.list().slice(0, 3).map((t) => t.concept),
      };
    } finally {
      this.reflecting = false;
    }
  }

  get sidecarUrlPublic(): string | null {
    return this.sidecarUrl;
  }

  /** Pull living matter (git + vault + worlds) from sidecar for grounded speech/dream. */
  async fetchLivingMatter(): Promise<LivingMatter | null> {
    if (!this.sidecarUrl) return null;
    try {
      const res = await this.fetchImpl(`${this.sidecarUrl}/matter`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        gitStat?: string | null;
        vaultExcerpt?: string | null;
        vaultTitles?: string[];
        lastError?: string | null;
        note?: string | null;
        herWorld?: Record<string, unknown>;
        yourWorld?: Record<string, unknown>;
        powers?: string[];
        selfModify?: boolean;
        keys?: Record<string, unknown>;
      };
      const matter: LivingMatter = { fetchedAt: Date.now() };
      if (data.gitStat) matter.gitStat = data.gitStat;
      if (data.vaultExcerpt) matter.vaultExcerpt = data.vaultExcerpt;
      if (data.vaultTitles?.length) matter.vaultTitles = data.vaultTitles;
      if (data.lastError) matter.lastError = data.lastError;
      if (data.note) matter.note = data.note;
      if (data.herWorld) matter.herWorld = data.herWorld;
      if (data.yourWorld) matter.yourWorld = data.yourWorld;
      if (data.powers?.length) matter.powers = data.powers;
      if (typeof data.selfModify === "boolean") matter.selfModify = data.selfModify;
      if (data.keys) matter.keys = data.keys;
      if (livingMatterEmpty(matter)) return null;
      if (matter.vaultTitles?.length) {
        this.store.mergeVaultTitles(matter.vaultTitles);
      }
      return matter;
    } catch {
      return null;
    }
  }

  async readWorld(
    root: "vault" | "projects" | "repo" | "ai",
    path: string,
  ): Promise<{ ok: boolean; content?: string; error?: string; path?: string }> {
    if (!this.sidecarUrl) return { ok: false, error: "no_sidecar" };
    try {
      const q = new URLSearchParams({ root, path });
      const res = await this.fetchImpl(`${this.sidecarUrl}/read?${q}`);
      const data = (await res.json()) as {
        ok?: boolean;
        content?: string;
        error?: string;
        path?: string;
      };
      const out: {
        ok: boolean;
        content?: string;
        error?: string;
        path?: string;
      } = { ok: Boolean(data.ok) };
      if (data.content) out.content = data.content;
      if (data.error) out.error = data.error;
      out.path = data.path ?? path;
      return out;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "read_failed",
      };
    }
  }

  async fetchKeys(): Promise<Record<string, unknown> | null> {
    if (!this.sidecarUrl) return null;
    try {
      const res = await this.fetchImpl(`${this.sidecarUrl}/keys`);
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async postAgenda(text: string, heat = 1): Promise<boolean> {
    if (!this.sidecarUrl) return false;
    try {
      const res = await this.fetchImpl(`${this.sidecarUrl}/agenda`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, heat }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async postWorldNote(payload: {
    kind?: "monde" | "propre" | "journal";
    title?: string;
    body: string;
  }): Promise<boolean> {
    if (!this.sidecarUrl) return false;
    try {
      const res = await this.fetchImpl(`${this.sidecarUrl}/world/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async postMutate(payload: Record<string, unknown>): Promise<boolean> {
    if (!this.sidecarUrl) return false;
    try {
      const res = await this.fetchImpl(`${this.sidecarUrl}/mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Record raw inner monologue from a speak turn. */
  pushInnerMonologue(inner: string): void {
    const t = inner.trim();
    if (!t) return;
    this.store.pushMonologue(t.slice(0, 280));
  }

  /** Pull recent vault titles into the graph (optional, non-blocking caller). */
  async pullFromSidecar(): Promise<void> {
    if (!this.sidecarUrl) return;
    try {
      const res = await this.fetchImpl(`${this.sidecarUrl}/recent?n=12`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        concepts?: { title: string }[];
      };
      const titles = (data.concepts ?? []).map((c) => c.title).filter(Boolean);
      if (titles.length) this.store.mergeVaultTitles(titles);
    } catch {
      this.store.pushJournal({
        at: Date.now(),
        kind: "sync",
        text: "sync_failed pull",
      });
    }
  }

  private async syncToSidecar(
    thought: ThoughtNode,
    journalLine: string,
  ): Promise<void> {
    if (!this.sidecarUrl) return;
    try {
      const res = await this.fetchImpl(`${this.sidecarUrl}/reflect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thought: {
            id: thought.id,
            concept: thought.concept,
            connections: thought.connections,
            weight: thought.weight,
            source: thought.source,
          },
          journalLine,
        }),
      });
      this.store.pushJournal({
        at: Date.now(),
        kind: "sync",
        text: res.ok ? "sync_ok" : "sync_failed",
        thoughtId: thought.id,
      });
    } catch {
      this.store.pushJournal({
        at: Date.now(),
        kind: "sync",
        text: "sync_failed",
        thoughtId: thought.id,
      });
    }
  }
}
