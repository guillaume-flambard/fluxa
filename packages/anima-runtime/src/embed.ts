/**
 * nomic-embed-text client — embeddings sémantiques via Ollama local.
 * Utilisé pour la mémoire associative dans mind.db.
 */

const EMBED_MODEL = "nomic-embed-text";

export async function embed(
  text: string,
  ollamaBase = process.env.FLUXA_OLLAMA_BASE ?? "http://localhost:11434",
): Promise<number[] | null> {
  try {
    const r = await fetch(`${ollamaBase}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 2000) }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { embedding?: number[] };
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

/** Encode un vecteur float en Buffer pour SQLite BLOB */
export function vecToBuffer(vec: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i]!, i * 4);
  return buf;
}

/** Decode un Buffer SQLite BLOB en vecteur float */
export function bufferToVec(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < buf.byteLength; i += 4) out.push(buf.readFloatLE(i));
  return out;
}

/** Similarité cosinus entre deux vecteurs */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
