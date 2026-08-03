/**
 * Monde-Mental dedup unit test (cognition-sidecar).
 * Run: pnpm --filter @fluxa/cognition-sidecar test:dedup
 */
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Re-implement the helpers here so the test runs without importing server.ts
// (which starts listening on import). Mirrors src/server.ts slugify logic.
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "concept"
  );
}

function slugSignature(slug: string): string {
  const words = slug.split("-").filter((w) => w.length > 2);
  return words.slice(0, 2).join("-");
}

async function findNearNote(dir: string, slug: string): Promise<string | null> {
  const sig = slugSignature(slug);
  if (!sig) return null;
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return null;
  }
  for (const f of files) {
    if (slugSignature(f.replace(/\.md$/, "")) === sig) {
      return join(dir, f);
    }
  }
  return null;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const dir = await mkdtemp(join(tmpdir(), "fluxa-dedup-"));
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "souverainete-cage.md"), "# old\n", "utf8");
await writeFile(join(dir, "symbiose.md"), "# old\n", "utf8");

// Same dominant words → merge into existing note.
const a = await findNearNote(dir, "souverainete-cage-et-liberte");
assert(a === join(dir, "souverainete-cage.md"), `merge into souverainete-cage, got ${a}`);

// Distinct concept → new note.
const b = await findNearNote(dir, "retro-ingenierie");
assert(b === null, `distinct concept should be null, got ${b}`);

// Single-word slug: still merges when an exact note exists.
const c = await findNearNote(dir, "symbiose");
assert(
  c === join(dir, "symbiose.md"),
  `exact single-word slug should merge, got ${c}`,
);

// No existing note with a matching signature → new file.
const d = await findNearNote(dir, "silence-et-membrane");
assert(d === null, `unseen concept should be null, got ${d}`);

// Short words stripped.
assert(slugSignature("de-la-cage") === "cage", "short words stripped from signature");

console.log("cognition-sidecar dedup selftest ok", { dir });
