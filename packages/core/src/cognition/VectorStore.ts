/**
 * Lightweight semantic vector store for Fluxa (palier 2.1).
 * JSON-backed, in-memory cosine search — no server, no native deps.
 * Embeddings are computed elsewhere (daemon/sidecar) and upserted here.
 */

export interface VectorEntry {
  id: string;
  text: string;
  embedding: number[];
  source: "turn" | "episode" | "motif" | "concept" | "note" | "query";
  at: number;
}

export interface VectorHit {
  entry: VectorEntry;
  score: number;
}

export const VECTORS_STORAGE_KEY = "fluxa.vectors.v1";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type VectorStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export class VectorStore {
  private entries = new Map<string, VectorEntry>();
  private readonly storage: VectorStorageLike | null;
  private readonly key: string;

  constructor(options?: { storage?: VectorStorageLike | null; key?: string }) {
    this.storage = options?.storage === undefined ? null : options.storage;
    this.key = options?.key ?? VECTORS_STORAGE_KEY;
    this.load();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Upsert one entry by id. */
  upsert(entry: VectorEntry): void {
    if (!Array.isArray(entry.embedding) || entry.embedding.length === 0) return;
    this.entries.set(entry.id, entry);
    this.trim();
    this.persist();
  }

  get(id: string): VectorEntry | undefined {
    return this.entries.get(id);
  }

  remove(id: string): void {
    this.entries.delete(id);
    this.persist();
  }

  all(): VectorEntry[] {
    return [...this.entries.values()];
  }

  /** Top-K nearest by cosine to the given embedding. */
  search(embedding: number[], k = 5, opts?: { minScore?: number }): VectorHit[] {
    const minScore = opts?.minScore ?? -1;
    const hits: VectorHit[] = [];
    for (const entry of this.entries.values()) {
      const score = cosineSimilarity(embedding, entry.embedding);
      if (score >= minScore) hits.push({ entry, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  /** Nearest entry (any source) for near-duplicate detection. */
  nearest(embedding: number[], opts?: { minScore?: number }): VectorHit | null {
    const hits = this.search(embedding, 1, opts);
    return hits[0] ?? null;
  }

  private trim(): void {
    // Bound the store (e.g. 400 entries) — drop oldest first.
    const MAX = 400;
    if (this.entries.size <= MAX) return;
    const sorted = [...this.entries.values()].sort((a, b) => a.at - b.at);
    const overflow = sorted.length - MAX;
    for (let i = 0; i < overflow; i++) {
      const id = sorted[i]?.id;
      if (id) this.entries.delete(id);
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return;
      const data = JSON.parse(raw) as VectorEntry[];
      if (!Array.isArray(data)) return;
      for (const e of data) {
        if (e?.id && Array.isArray(e.embedding)) this.entries.set(e.id, e);
      }
    } catch {
      /* corrupt — start fresh */
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify([...this.entries.values()]));
    } catch {
      /* quota */
    }
  }
}
