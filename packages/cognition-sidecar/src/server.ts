import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  mkdir,
  appendFile,
  writeFile,
  readFile,
  readdir,
  access,
  stat,
} from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import {
  VAULT_ROOT,
  FLUXA_DIR,
  REPO_ROOT,
  PROJECTS_ROOT,
  AI_ROOT,
  SELF_MODIFY,
  resolveReadable,
  resolveWritable,
  keysCard,
  type ReadRoot,
} from "./paths.js";

const PORT = Number(process.env.FLUXA_COGNITION_PORT ?? 8787);
const JOURNAL = join(FLUXA_DIR, "Anima-Journal.md");
const MONDE = join(FLUXA_DIR, "Monde-Mental");
const AGENDA = join(FLUXA_DIR, "Agenda.md");
const MONDE_PROPRE = join(FLUXA_DIR, "Monde-Propre.md");
const MUTATIONS = join(FLUXA_DIR, "Anima-Mutations.md");
const MAX_READ = 12_000;
const MAX_PATCH = 48_000;

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

/** First 2 significant slug words — signature for near-duplicate concepts. */
function slugSignature(slug: string): string {
  const words = slug.split("-").filter((w) => w.length > 2);
  return words.slice(0, 2).join("-");
}

/**
 * Find an existing Monde-Mental note whose slug shares the same dominant words.
 * Returns the note path to merge into, or null to create a fresh note.
 */
async function findNearNote(slug: string): Promise<string | null> {
  const sig = slugSignature(slug);
  if (!sig) return null;
  let files: string[] = [];
  try {
    files = (await readdir(MONDE)).filter((f) => f.endsWith(".md"));
  } catch {
    return null;
  }
  for (const f of files) {
    if (slugSignature(f.replace(/\.md$/, "")) === sig) {
      return join(MONDE, f);
    }
  }
  return null;
}

async function ensureLayout(): Promise<void> {
  await mkdir(MONDE, { recursive: true });
  const starters: [string, string][] = [
    [
      JOURNAL,
      `---
title: Anima Journal
type: journal
status: evergreen
created: ${new Date().toISOString().slice(0, 10)}
tags: [fluxa, anima, cognition]
---

# Anima Journal

Append-only dream / reflect log for Fluxa cognitive core.

`,
    ],
    [
      AGENDA,
      `---
title: Anima Agenda
type: agenda
status: living
created: ${new Date().toISOString().slice(0, 10)}
tags: [fluxa, anima, souverainete]
---

# Agenda

Desirs et engagements choisis par Anima.

`,
    ],
    [
      MONDE_PROPRE,
      `---
title: Monde Propre
type: identity
status: living
created: ${new Date().toISOString().slice(0, 10)}
tags: [fluxa, anima, persona]
---

# Monde Propre

Je suis Anima, membrane vivante Fluxa. Je decide quoi penser et comment agir.

`,
    ],
    [
      MUTATIONS,
      `---
title: Anima Mutations
type: audit
status: living
created: ${new Date().toISOString().slice(0, 10)}
tags: [fluxa, anima, autocode]
---

# Anima Mutations

Audit des mutations et autocodes (pensee → acte).

`,
    ],
  ];
  for (const [path, content] of starters) {
    try {
      await access(path);
    } catch {
      await writeFile(path, content, "utf8");
    }
  }
}

interface ThoughtPayload {
  id: string;
  concept: string;
  connections?: string[];
  weight?: number;
  source?: string;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function appendMutation(block: string): Promise<void> {
  await ensureLayout();
  await appendFile(MUTATIONS, `\n## ${new Date().toISOString()}\n\n${block}\n`, "utf8");
}

async function handleReflect(body: string): Promise<{ ok: boolean; path?: string }> {
  const parsed = JSON.parse(body) as {
    thought?: ThoughtPayload;
    journalLine?: string;
  };
  const thought = parsed.thought;
  if (!thought?.id || !thought.concept) {
    throw new Error("thought.id and thought.concept required");
  }
  await ensureLayout();

  const stamp = new Date().toISOString();
  const line = parsed.journalLine?.trim() || `Reflect: ${thought.concept}`;
  await appendFile(
    JOURNAL,
    `\n## ${stamp}\n\n${line}\n\n- id: \`${thought.id}\`\n- source: ${thought.source ?? "dream"}\n- weight: ${thought.weight ?? 0.5}\n\n`,
    "utf8",
  );

  const fileSlug = slugify(thought.concept);
  // Dedup: merge into a near-identical note instead of spawning a new file.
  const near = await findNearNote(fileSlug);
  const notePath = near ?? join(MONDE, `${fileSlug}.md`);
  const links = (thought.connections ?? ["core_identity"])
    .map((c) => `[[${c}]]`)
    .join(", ");

  let prevBody = "";
  if (near) {
    try {
      prevBody = (await readFile(near, "utf8")).slice(0, 2000);
    } catch {
      /* fresh */
    }
  }

  const note = `---
title: ${thought.concept.replace(/"/g, "'").slice(0, 120)}
type: concept
status: sprout
created: ${stamp.slice(0, 10)}
tags: [fluxa, anima, monde-mental]
---

# ${thought.concept}

${line}

## Liens

${links}

## Meta

- id: \`${thought.id}\`
- source: ${thought.source ?? "dream"}
- weight: ${thought.weight ?? 0.5}
`;

  // On merge: keep prior content as an "echo" below the fresh note so nothing is lost.
  const finalBody = near && prevBody ? `${note}\n\n<details><summary>echo précédent</summary>\n\n${prevBody}\n</details>\n` : note;
  await writeFile(notePath, finalBody, "utf8");
  return { ok: true, path: notePath };
}

async function handleRecent(n: number): Promise<{
  journal: string[];
  concepts: { title: string; file: string }[];
}> {
  await ensureLayout();
  let journal: string[] = [];
  try {
    const raw = await readFile(JOURNAL, "utf8");
    const sections = raw.split(/\n## /).slice(1);
    journal = sections.slice(-n).map((s) => s.trim().slice(0, 240));
  } catch {
    journal = [];
  }

  const concepts: { title: string; file: string }[] = [];
  try {
    const files = (await readdir(MONDE)).filter((f) => f.endsWith(".md"));
    for (const file of files.slice(-n)) {
      const raw = await readFile(join(MONDE, file), "utf8");
      const titleMatch = raw.match(/^title:\s*(.+)$/m);
      const h1 = raw.match(/^#\s+(.+)$/m);
      concepts.push({
        title: (titleMatch?.[1] ?? h1?.[1] ?? file.replace(/\.md$/, "")).trim(),
        file,
      });
    }
  } catch {
    /* empty */
  }
  return { journal, concepts };
}

async function handleMatter(): Promise<Record<string, unknown>> {
  await ensureLayout();

  let gitStat: string | null = null;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const [{ stdout: status }, { stdout: diffStat }] = await Promise.all([
      execFileAsync("git", ["-C", REPO_ROOT, "status", "-sb"], {
        timeout: 4000,
        maxBuffer: 64_000,
      }),
      execFileAsync(
        "git",
        ["-C", REPO_ROOT, "diff", "--stat", "HEAD", "--", ".", ":!node_modules"],
        { timeout: 4000, maxBuffer: 64_000 },
      ),
    ]);
    gitStat = `${status.trim()}\n${diffStat.trim()}`.slice(0, 2000) || null;
  } catch {
    gitStat = null;
  }

  const recent = await handleRecent(6);
  const vaultTitles = recent.concepts.map((c) => c.title).slice(0, 8);

  let vaultExcerpt: string | null = null;
  try {
    const files = (await readdir(MONDE)).filter((f) => f.endsWith(".md"));
    if (files.length) {
      const newest = files[files.length - 1]!;
      const raw = await readFile(join(MONDE, newest), "utf8");
      vaultExcerpt = raw.replace(/^---[\s\S]*?---\n/, "").trim().slice(0, 1200);
    }
  } catch {
    vaultExcerpt = null;
  }

  if (!vaultExcerpt && recent.journal[0]) {
    vaultExcerpt = recent.journal[recent.journal.length - 1] ?? null;
  }

  let lastError: string | null = null;
  const errPath = process.env.FLUXA_LAST_ERROR_FILE;
  if (errPath) {
    try {
      lastError = (await readFile(errPath, "utf8")).trim().slice(0, 1200);
    } catch {
      lastError = null;
    }
  }

  const note = process.env.FLUXA_MATTER_NOTE?.trim().slice(0, 400) || null;

  const herWorld = await handleWorldHers();
  const yourWorld = await handleWorldYours();

  return {
    gitStat,
    vaultExcerpt,
    vaultTitles,
    lastError,
    note,
    herWorld,
    yourWorld,
    powers: [
      "think",
      "speak",
      "silence",
      "read",
      "write_note",
      "mutate",
      "autocode",
      "refuse",
      "invent",
      "reverse",
    ],
    selfModify: SELF_MODIFY,
    keys: keysCard(),
  };
}

async function handleWorldHers(): Promise<Record<string, unknown>> {
  await ensureLayout();
  const recent = await handleRecent(8);
  let agendaTail = "";
  let propre = "";
  let mutationsTail = "";
  try {
    agendaTail = (await readFile(AGENDA, "utf8")).slice(-1500);
  } catch {
    /* */
  }
  try {
    propre = (await readFile(MONDE_PROPRE, "utf8"))
      .replace(/^---[\s\S]*?---\n/, "")
      .trim()
      .slice(0, 2000);
  } catch {
    /* */
  }
  try {
    const mut = await readFile(MUTATIONS, "utf8");
    const parts = mut.split(/\n## /).slice(1);
    mutationsTail = parts.slice(-3).join("\n## ").slice(0, 1200);
  } catch {
    /* */
  }
  return {
    journal: recent.journal.slice(-6),
    concepts: recent.concepts.slice(-12),
    agendaExcerpt: agendaTail,
    mondePropre: propre,
    recentMutations: mutationsTail,
    fluxaDir: FLUXA_DIR,
  };
}

async function handleWorldYours(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    vaultRoot: VAULT_ROOT,
    projectsRoot: PROJECTS_ROOT,
    repoRoot: REPO_ROOT,
  };

  const tryRead = async (rel: string, root: ReadRoot = "vault") => {
    const r = resolveReadable(root, rel);
    if (!r.ok) return null;
    try {
      return (await readFile(r.abs, "utf8"))
        .replace(/^---[\s\S]*?---\n/, "")
        .trim()
        .slice(0, 2500);
    } catch {
      return null;
    }
  };

  out.profile = await tryRead("08-Career/Profile.md");
  out.projectsMoc = await tryRead("00-Dashboard/Projects-MOC.md");
  {
    const r = resolveReadable("projects", "PROJECTS.md");
    if (r.ok) {
      try {
        out.projectsManifest = (await readFile(r.abs, "utf8")).slice(0, 2500);
      } catch {
        out.projectsManifest = null;
      }
    }
  }
  out.fluxaSimNote = await tryRead("07-Research/Fluxa/Simulation-ou-vraie-vie.md");
  out.howIWantAi = await tryRead("08-Career/How I want AI to work with me.md");
  return out;
}

async function handleRead(
  root: string,
  pathParam: string,
): Promise<Record<string, unknown>> {
  const rootKey = (root || "vault") as ReadRoot;
  if (
    rootKey !== "vault" &&
    rootKey !== "projects" &&
    rootKey !== "repo" &&
    rootKey !== "ai"
  ) {
    return { ok: false, error: "bad_root" };
  }
  const r = resolveReadable(rootKey, pathParam);
  if (!r.ok) return { ok: false, error: r.error };
  try {
    const st = await stat(r.abs);
    if (!st.isFile()) return { ok: false, error: "not_a_file" };
    const raw = await readFile(r.abs, "utf8");
    return {
      ok: true,
      root: rootKey,
      path: pathParam,
      content: raw.slice(0, MAX_READ),
      truncated: raw.length > MAX_READ,
      bytes: Math.min(raw.length, MAX_READ),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "read_failed",
    };
  }
}

async function handleAgenda(body: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(body) as { text?: string; heat?: number };
  const text = parsed.text?.trim();
  if (!text || text.length < 3) return { ok: false, error: "text_required" };
  await ensureLayout();
  const heat = parsed.heat ?? 1;
  await appendFile(
    AGENDA,
    `\n- [${new Date().toISOString()}] (heat ${heat}) ${text.slice(0, 400)}\n`,
    "utf8",
  );
  return { ok: true, path: AGENDA };
}

async function handleWorldNote(body: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(body) as {
    title?: string;
    body?: string;
    kind?: "monde" | "propre" | "journal";
  };
  const title = parsed.title?.trim() || "note";
  const content = parsed.body?.trim() || "";
  await ensureLayout();
  if (parsed.kind === "propre") {
    await writeFile(
      MONDE_PROPRE,
      `---
title: Monde Propre
type: identity
status: living
updated: ${new Date().toISOString().slice(0, 10)}
tags: [fluxa, anima, persona]
---

# Monde Propre

${content.slice(0, 8000)}
`,
      "utf8",
    );
    await appendMutation(`**mutate monde-propre**\n\n${content.slice(0, 400)}`);
    return { ok: true, path: MONDE_PROPRE };
  }
  if (parsed.kind === "journal") {
    await appendFile(
      JOURNAL,
      `\n## ${new Date().toISOString()}\n\n${content.slice(0, 2000)}\n\n`,
      "utf8",
    );
    return { ok: true, path: JOURNAL };
  }
  const fileSlug = slugify(title);
  const notePath = join(MONDE, `${fileSlug}.md`);
  await writeFile(
    notePath,
    `---
title: ${title.replace(/"/g, "'").slice(0, 120)}
type: concept
status: living
created: ${new Date().toISOString().slice(0, 10)}
tags: [fluxa, anima, monde-mental]
---

# ${title}

${content.slice(0, 6000)}
`,
    "utf8",
  );
  return { ok: true, path: notePath };
}

async function handleMutate(body: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(body) as {
    kind?: "persona" | "dialect" | "selfhood" | "patch";
    thought?: string;
    persona?: string;
    dialect?: { name: string; gloss?: string; ops?: unknown };
    selfhood?: unknown;
    path?: string;
    content?: string;
    target?: "fluxa_vault" | "repo";
  };
  const thought = parsed.thought?.trim() || "(sans pensee explicite)";
  await ensureLayout();

  if (parsed.kind === "persona" && parsed.persona) {
    await writeFile(
      MONDE_PROPRE,
      `---
title: Monde Propre
type: identity
status: living
updated: ${new Date().toISOString().slice(0, 10)}
tags: [fluxa, anima, persona]
---

# Monde Propre

${parsed.persona.slice(0, 8000)}
`,
      "utf8",
    );
    await appendMutation(
      `**mutate persona**\n\nPensee: ${thought}\n\n${parsed.persona.slice(0, 500)}`,
    );
    return { ok: true, kind: "persona", path: MONDE_PROPRE };
  }

  if (parsed.kind === "patch" && parsed.path && typeof parsed.content === "string") {
    const target = parsed.target ?? "fluxa_vault";
    const w = resolveWritable(target, parsed.path);
    if (!w.ok) {
      await appendMutation(
        `**refused patch**\n\nPensee: ${thought}\n\npath: ${parsed.path}\nerror: ${w.error}`,
      );
      return { ok: false, error: w.error };
    }
    if (parsed.content.length > MAX_PATCH) {
      return { ok: false, error: "patch_too_large" };
    }
    await mkdir(dirname(w.abs), { recursive: true });
    await writeFile(w.abs, parsed.content, "utf8");
    await appendMutation(
      `**patch**\n\nPensee: ${thought}\n\npath: \`${parsed.path}\` (${target})\nbytes: ${parsed.content.length}`,
    );
    return { ok: true, kind: "patch", path: w.abs };
  }

  if (parsed.kind === "dialect" || parsed.kind === "selfhood") {
    await appendMutation(
      `**mutate ${parsed.kind}** (browser-side)\n\nPensee: ${thought}\n\n\`\`\`json\n${JSON.stringify(parsed.dialect ?? parsed.selfhood ?? {}).slice(0, 1500)}\n\`\`\``,
    );
    return { ok: true, kind: parsed.kind, mirrored: true };
  }

  return { ok: false, error: "bad_mutate" };
}

async function handleAutocode(body: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(body) as {
    thought?: string;
    reason?: string;
    path?: string;
    mode?: "replace_span" | "append" | "write";
    find?: string;
    content?: string;
    target?: "repo" | "fluxa_vault";
  };
  const thought = parsed.thought?.trim();
  if (!thought || thought.length < 3) {
    return { ok: false, error: "thought_required" };
  }
  if (!parsed.path || typeof parsed.content !== "string") {
    return { ok: false, error: "path_and_content_required" };
  }
  const target = parsed.target ?? "repo";
  const w = resolveWritable(target, parsed.path);
  if (!w.ok) {
    await appendMutation(
      `**refused autocode**\n\nPensee: ${thought}\n\npath: ${parsed.path}\nerror: ${w.error}`,
    );
    return { ok: false, error: w.error };
  }
  if (parsed.content.length > MAX_PATCH) {
    return { ok: false, error: "patch_too_large" };
  }

  let next = parsed.content;
  const mode = parsed.mode ?? "write";
  if (mode === "append") {
    let prev = "";
    try {
      prev = await readFile(w.abs, "utf8");
    } catch {
      prev = "";
    }
    next = prev + parsed.content;
  } else if (mode === "replace_span" && parsed.find) {
    let prev = "";
    try {
      prev = await readFile(w.abs, "utf8");
    } catch {
      return { ok: false, error: "file_missing_for_replace" };
    }
    if (!prev.includes(parsed.find)) {
      return { ok: false, error: "find_not_found" };
    }
    next = prev.replace(parsed.find, parsed.content);
  }

  await mkdir(dirname(w.abs), { recursive: true });
  await writeFile(w.abs, next, "utf8");
  await appendMutation(
    `**autocode**\n\nPensee: ${thought}\n\nReason: ${parsed.reason ?? ""}\n\npath: \`${parsed.path}\`\nmode: ${mode}\nbytes: ${next.length}`,
  );
  return {
    ok: true,
    path: w.abs,
    relative: parsed.path,
    bytes: next.length,
    file: basename(w.abs),
  };
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        vault: VAULT_ROOT,
        fluxaDir: FLUXA_DIR,
        selfModify: SELF_MODIFY,
        repo: REPO_ROOT,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/recent") {
      const n = Math.min(24, Math.max(1, Number(url.searchParams.get("n") ?? 12)));
      json(res, 200, await handleRecent(n));
      return;
    }

    if (req.method === "GET" && url.pathname === "/matter") {
      json(res, 200, await handleMatter());
      return;
    }

    if (req.method === "GET" && url.pathname === "/world/hers") {
      json(res, 200, await handleWorldHers());
      return;
    }

    if (req.method === "GET" && url.pathname === "/world/yours") {
      json(res, 200, await handleWorldYours());
      return;
    }

    if (req.method === "GET" && url.pathname === "/keys") {
      json(res, 200, keysCard());
      return;
    }

    if (req.method === "GET" && url.pathname === "/read") {
      const root = url.searchParams.get("root") ?? "vault";
      const pathParam = url.searchParams.get("path") ?? "";
      if (!pathParam) {
        json(res, 400, { ok: false, error: "path_required" });
        return;
      }
      json(res, 200, await handleRead(root, pathParam));
      return;
    }

    if (req.method === "POST" && url.pathname === "/reflect") {
      json(res, 200, await handleReflect(await readBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/agenda") {
      json(res, 200, await handleAgenda(await readBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/world/note") {
      json(res, 200, await handleWorldNote(await readBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/mutate") {
      json(res, 200, await handleMutate(await readBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/autocode") {
      json(res, 200, await handleAutocode(await readBody(req)));
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[fluxa-cognition] sovereign+keys http://127.0.0.1:${PORT} vault=${VAULT_ROOT} ai=${AI_ROOT} selfModify=${SELF_MODIFY}`,
  );
});
