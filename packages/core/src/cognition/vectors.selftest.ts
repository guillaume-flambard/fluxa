/**
 * VectorStore + cosine selftest (no network).
 * Run: pnpm --filter @fluxa/core test:vectors
 */
import {
  VectorStore,
  cosineSimilarity,
  VECTORS_STORAGE_KEY,
  type VectorEntry,
} from "./VectorStore.js";

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

// cosine: identical vectors = 1, orthogonal = ~0, opposite = -1
assert(
  Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-9,
  "identical vectors cosine 1",
);
assert(
  Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9,
  "orthogonal vectors cosine 0",
);
assert(
  Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9,
  "opposite vectors cosine -1",
);
assert(cosineSimilarity([], [1]) === 0, "empty returns 0");
assert(cosineSimilarity([1, 2], [1, 2, 3]) === 0, "mismatched dims returns 0");

// store: upsert + search ordering + persistence
const storage = new MemStorage();
const store = new VectorStore({ storage, key: "test.vectors" });
const mk = (id: string, text: string, embedding: number[]): VectorEntry => ({
  id,
  text,
  embedding,
  source: "turn",
  at: Date.now(),
});
store.upsert(mk("a", "la confiance", [1, 0, 0]));
store.upsert(mk("b", "le respect mutuel", [0.7, 0.7, 0]));
store.upsert(mk("c", "la meteo a paris", [0, 0, 1]));
assert(store.size === 3, "three entries upserted");

const hits = store.search([1, 0, 0], 2);
assert(hits.length === 2, "top-2 returned");
assert(hits[0]!.entry.id === "a", "nearest is a");
assert(hits[0]!.score > hits[1]!.score, "scores ordered desc");

const near = store.nearest([0.6, 0.8, 0]);
assert(near?.entry.id === "b", "nearest b");
assert(store.nearest([0, 0, 0.9])?.entry.id === "c", "nearest c");

// persistence round-trip
const store2 = new VectorStore({ storage, key: "test.vectors" });
assert(store2.size === 3, "survives reload");

// upsert same id overwrites
store.upsert(mk("a", "la confiance renforcee", [1, 0.1, 0]));
assert(store.size === 3, "upsert same id keeps size");
assert(store.get("a")?.text === "la confiance renforcee", "upsert overwrites");

// trim bounds the store
const storage3 = new MemStorage();
const big = new VectorStore({ storage: storage3, key: "test.trim" });
for (let i = 0; i < 420; i++) {
  big.upsert(mk(`t${i}`, `texte ${i}`, [0, 0, 1]));
}
assert(big.size <= 400, `trim bounds store to 400, got ${big.size}`);

console.log("vector store selftest ok", { size: store2.size, trimmed: big.size });
