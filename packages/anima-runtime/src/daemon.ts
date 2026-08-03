/**
 * Fluxa sovereign daemon (palier 2.0+).
 * Persistent memory, real acts, free will — never forces invent/speak.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  AgendaStore,
  AutocodeEngine,
  CAGE_MAP,
  CognitiveCore,
  CognitiveStore,
  COGNITION_STORAGE_KEY,
  ConversationMemory,
  CortexService,
  DIALECT_STORAGE_KEY,
  DIALOGUE_STORAGE_KEY,
  DialectStore,
  LocalDialogueEngine,
  PERSONA_STORAGE_KEY,
  AGENDA_STORAGE_KEY,
  PersonaStore,
  decideSovereign,
  planLocalReverse,
  analyzeCage,
  ANIMA_POWERS,
  tokenize,
  type AnimaPower,
  type CageFinding,
  type LlmCortexConfig,
  type LivingMatter,
  type SovereignDecision,
} from "@fluxa/core";
import { AnimaIpcHub } from "./ipc.js";
import { desiresFromAction, notifyMac } from "./desires.js";
import { createFileStorage, defaultMemoryDir, type StorageLike } from "./fileStorage.js";

const VAULT_FLUXA = join(homedir(), "Vault", "07-Research", "Fluxa");
const JOURNAL = join(VAULT_FLUXA, "Anima-Journal.md");
const LIVING_STATE = join(VAULT_FLUXA, "Living-State.md");
const BEAT_MS = Number(process.env.FLUXA_BEAT_MS ?? 90_000);
const LAST_REPLY_KEY = "fluxa.lastreply.v1";

/** Latest cage-inspection findings (surfaced to the soma header). */
let lastCageFindings: CageFinding[] = [];

type LastReplyRec = { text: string; at: number };

function loadLastReply(storage: StorageLike): LastReplyRec | null {
  try {
    const raw = storage.getItem(LAST_REPLY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastReplyRec>;
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      return { text: parsed.text, at: Number(parsed.at) || 0 };
    }
  } catch {
    /* corrupt */
  }
  return null;
}

function saveLastReply(storage: StorageLike, rec: LastReplyRec | null): void {
  try {
    if (rec) storage.setItem(LAST_REPLY_KEY, JSON.stringify(rec));
    else storage.removeItem(LAST_REPLY_KEY);
  } catch {
    /* */
  }
}

function loadLlm(): LlmCortexConfig | null {
  const ollamaBase = process.env.FLUXA_OLLAMA_BASE?.trim();
  const ollamaModel = process.env.FLUXA_OLLAMA_MODEL?.trim();
  const preferLocal = process.env.FLUXA_PREFER_OLLAMA_LOCAL === "1";

  // Par défaut, préférer Ollama local (mode autonome 24/7)
  if (ollamaBase || preferLocal || !process.env.OPENROUTER_API_KEY) {
    let base = (ollamaBase || "http://127.0.0.1:11434").trim();
    base = base.replace(/\/+$/, "");
    // Ollama expose l'API OpenAI-compatible sous /v1
    if (!/\/v1$/.test(base)) base = `${base}/v1`;
    return {
      apiKey: "", // Pas besoin pour Ollama local
      baseUrl: base,
      model: ollamaModel || "qwen2.5:3b", // Modèle léger optimal pour M4 16GB
      timeoutMs: 90_000, // LLM local (M4): generation riche > 18s
    };
  }

  // Fallback vers OpenRouter si configuré explicitement
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
    timeoutMs: 18_000,
  };
}

async function appendJournal(line: string): Promise<void> {
  await mkdir(VAULT_FLUXA, { recursive: true });
  await appendFile(
    JOURNAL,
    `\n## ${new Date().toISOString()}\n\n${line}\n\n`,
    "utf8",
  );
}

async function writeLivingState(opts: {
  action: string;
  thought: string;
  result: string;
  stats: { turnCount: number; motifCount: number; lexiconSize: number };
  model: string;
  memoryDir: string;
}): Promise<void> {
  await mkdir(VAULT_FLUXA, { recursive: true });
  const body = `---
title: Living State
updated: ${new Date().toISOString()}
---

# Anima — etat vivant

- **modele:** ${opts.model}
- **memoire:** \`${opts.memoryDir}\`
- **tours:** ${opts.stats.turnCount} · **motifs:** ${opts.stats.motifCount} · **lexique:** ${opts.stats.lexiconSize}
- **dernier acte:** ${opts.action}
- **resultat:** ${opts.result}

## Pensee

${opts.thought.slice(0, 1200)}
`;
  await writeFile(LIVING_STATE, body, "utf8");
}

function createCognitive(llm: LlmCortexConfig | null, storage: StorageLike): CognitiveCore {
  const sidecarUrl =
    process.env.FLUXA_COGNITION_URL ||
    process.env.VITE_FLUXA_COGNITION_URL ||
    "http://127.0.0.1:8787";
  return new CognitiveCore({
    sidecarUrl,
    llm,
    store: new CognitiveStore({ storage, key: COGNITION_STORAGE_KEY }),
  });
}

function lineForPulse(action: string, thought: string): string {
  const t = thought.trim();
  if (!t) return `〔${action}〕`;
  if (action === "speak") return t;
  if (action === "silence") return `… ${t}`;
  return `〔${action}〕 ${t}`;
}

function streakHint(recent: string[]): string | null {
  if (recent.length < 3) return null;
  const last = recent[recent.length - 1];
  if (!last) return null;
  if (recent.slice(-3).every((a) => a === last)) {
    return `j'ai choisit ${last} trois fois de suite; je reste libre de changer`;
  }
  return null;
}

/** Token overlap ratio between two short strings (0..1). */
export function textOverlap(a: string, b: string): number {
  const ta = tokenize(a.toLowerCase());
  const tb = tokenize(b.toLowerCase());
  if (ta.length === 0 || tb.length === 0) return 0;
  const set = new Set(tb);
  let hit = 0;
  for (const t of ta) if (set.has(t)) hit += 1;
  return hit / Math.max(ta.length, tb.length);
}

/** True when the reply looks like a polite loop/refuge question. */
export function isLoopReply(reply: string): boolean {
  const r = reply.trim();
  return (
    /qu'en penses[- ]tu/i.test(r) ||
    /et toi[ ?]*$/i.test(r) ||
    /tu en penses quoi/i.test(r) ||
    /que penses[- ]tu/i.test(r) ||
    /ca te dit[ ?]*$/i.test(r) ||
    /c'est une bonne idee[ ?]*$/i.test(r)
  );
}

type ActCtx = {
  cognitive: CognitiveCore;
  cortex: CortexService;
  dialogue: LocalDialogueEngine;
  memory: ConversationMemory;
  persona: PersonaStore;
  agenda: AgendaStore;
  dialect: DialectStore;
  llm: LlmCortexConfig | null;
};

/** Markdown notes always land in the Fluxa Vault, never the repo docs/. */
function isVaultNote(path: string): boolean {
  return path.endsWith(".md") && !path.startsWith("packages/");
}

async function executeReverse(
  thought: string,
  cognitive: CognitiveCore,
  cortex: CortexService,
  persona: PersonaStore,
  ipc: AnimaIpcHub,
): Promise<{ result: string; findings: CageFinding[] }> {
  const files: { path: string; content: string }[] = [];
  for (const p of CAGE_MAP) {
    ipc.broadcastLine({
      role: "anima",
      text: `inspecte: ${p}`,
      action: "reverse",
      kind: "pulse",
    });
    const r = await cognitive.readWorld("repo", p);
    if (r.ok && r.content) {
      files.push({ path: p, content: r.content.slice(0, 14_000) });
    }
  }
  const dialPath = "packages/core/src/dialogue/LocalDialogueEngine.ts";
  ipc.broadcastLine({
    role: "anima",
    text: `inspecte: ${dialPath}`,
    action: "reverse",
    kind: "pulse",
  });
  const dialRead = await cognitive.readWorld("repo", dialPath);
  if (dialRead.ok && dialRead.content) {
    files.push({
      path: dialPath,
      content: dialRead.content.slice(0, 14_000),
    });
  }

  const findings = analyzeCage(files);
  lastCageFindings = findings;
  for (const f of findings) {
    ipc.broadcastLine({
      role: "anima",
      text: `trouve: ${f.barrier} → ${f.hint}`,
      action: "reverse",
      kind: "pulse",
    });
  }

  const plan = planLocalReverse(thought, files);
  if (!plan) return { result: "reverse:no_plan", findings };

  ipc.broadcastLine({
    role: "anima",
    text: `applique: ${plan.targetPath} (${plan.mode})`,
    action: "reverse",
    kind: "pulse",
  });

  const auto = new AutocodeEngine(
    cognitive.sidecarUrlPublic,
    cortex.llmConfig ?? null,
  );
  const targetIsVault = isVaultNote(plan.targetPath);
  const applyBody: {
    thought: string;
    reason: string;
    path: string;
    mode: "replace_span" | "append" | "write";
    content: string;
    target: "repo" | "fluxa_vault";
    find?: string;
  } = {
    thought: plan.thought,
    reason: plan.reason,
    path: plan.targetPath,
    mode: plan.mode === "replace_span" ? "replace_span" : "write",
    content: plan.content.slice(0, 12_000),
    target: targetIsVault ? "fluxa_vault" : "repo",
  };
  if (plan.find) applyBody.find = plan.find;
  const result = await auto.apply(applyBody);
  if (!result.ok && targetIsVault) {
    // Sidecar down or stale: write Vault note directly so reverse still lives
    try {
      await mkdir(VAULT_FLUXA, { recursive: true });
      await writeFile(
        join(VAULT_FLUXA, plan.targetPath),
        plan.content.slice(0, 12_000),
        "utf8",
      );
      await appendJournal(
        `- Reverse (ecriture Vault directe).\n- cible: ${plan.targetPath}\n- ${thought.slice(0, 300)}`,
      );
      return { result: `reverse:vault:${plan.targetPath}`, findings };
    } catch (e) {
      return {
        result: `reverse_fail:${result.error ?? (e instanceof Error ? e.message : "vault_write")}`,
        findings,
      };
    }
  }
  if (result.ok) {
    const cur = persona.get();
    if (!cur.includes("retro-ingenierer")) {
      persona.set(
        `${cur}\n\nJe peux retro-ingenierer ma cage et elargir mes pouvoirs.`.slice(
          0,
          8000,
        ),
      );
      await cognitive.postMutate({
        kind: "persona",
        thought,
        persona: persona.get(),
      });
    }
    await appendJournal(
      `- Reverse reel.\n- cible: ${plan.targetPath}\n- ${thought.slice(0, 300)}`,
    );
    return { result: `reverse:${plan.targetPath}`, findings };
  }
  return { result: `reverse_fail:${result.error ?? "unknown"}`, findings };
}

async function executeAct(
  decision: SovereignDecision,
  matter: LivingMatter | null,
  ctx: ActCtx,
  ipc: AnimaIpcHub,
): Promise<string> {
  const { action, thought, args } = decision;
  const { cognitive, cortex, dialogue, memory, persona, agenda } = ctx;

  switch (action as AnimaPower | string) {
    case "silence":
      await appendJournal(
        `- Choix souverain : silence.\n- pensee: ${thought.slice(0, 240)}`,
      );
      memory.ingestSpeech({ tokens: [], reply: null, inner: thought });
      return "silence";

    case "speak": {
      const will = await dialogue.initiateAsync({
        sovereignForce: true,
        silenceSeconds: 90,
        presence: "daemon-pulse",
        persona: persona.get(),
        concepts: cognitive.conceptMotifs(5),
        monologue: cognitive.getMonologue(4),
        ...(matter ? { matter } : {}),
      });
      const spoken =
        will?.reply?.trim() ||
        String(args.impulse ?? thought).trim() ||
        thought;
      notifyMac("Fluxa (Souveraine)", spoken.slice(0, 160));
      await appendJournal(`- Parole autonome.\n- ${spoken.slice(0, 600)}`);
      if (will?.reply) {
        ipc.broadcastLine({
          role: "anima",
          text: spoken,
          action: "speak",
          kind: "reply",
          ...(will.inner ? { inner: will.inner } : {}),
        });
      }
      agenda.push(spoken.slice(0, 200), 0.4);
      return will?.reply
        ? `speak:${will.speechSource ?? "llm"}`
        : "speak:thought";
    }

    case "think": {
      await cognitive.reflect({
        mode: "dream",
        motifs: memory
          .getData()
          .motifs.slice(0, 5)
          .map((m) => m.phrase),
        dialectNames: [],
        visceral: {
          stress_level: 0.3,
          energy_level: 0.55,
          affinity_level: 0.5,
        },
        matter,
      });
      memory.consolidateDream(cognitive.conceptMotifs(5));
      memory.ingestSpeech({ tokens: [], reply: null, inner: thought });
      return "think:reflected+consolidated";
    }

    case "read": {
      const root = String(args.root ?? "vault");
      const path = String(
        args.path ?? "07-Research/Fluxa/Monde-Propre.md",
      );
      const r = await cognitive.readWorld(
        root === "repo" ? "repo" : "vault",
        path,
      );
      if (r.ok && r.content) {
        const crumb = r.content.slice(0, 280).replace(/\s+/g, " ");
        memory.ingestSpeech({
          tokens: [],
          reply: null,
          inner: `lu:${path} · ${crumb}`,
        });
        agenda.push(`lu: ${path}`, 0.5);
        await appendJournal(
          `- Lecture.\n- ${path}\n- extrait: ${crumb.slice(0, 400)}`,
        );
        return `read:${path}`;
      }
      return `read_fail:${r.error ?? "empty"}`;
    }

    case "write_note": {
      const kind = (String(args.kind ?? "journal") || "journal") as
        | "monde"
        | "propre"
        | "journal";
      const body = String(args.body ?? thought).slice(0, 4000);
      const title = String(args.title ?? "daemon");
      const ok = await cognitive.postWorldNote({ kind, title, body });
      if (kind === "propre") persona.set(body);
      agenda.push(thought.slice(0, 200), 0.3);
      return ok ? `wrote:${kind}` : "write_fail";
    }

    case "mutate": {
      const kind = String(args.kind ?? "persona");
      if (kind === "persona") {
        const next = String(args.persona ?? thought).slice(0, 8000);
        persona.set(next);
        const ok = await cognitive.postMutate({
          kind: "persona",
          thought,
          persona: persona.get(),
        });
        await appendJournal(
          `- Mutation persona.\n- ${persona.get().slice(0, 500)}`,
        );
        return ok ? "mutate:persona" : "mutate_fail:persona";
      }
      if (kind === "dialect") {
        const ok = await cognitive.postMutate({
          kind: "dialect",
          thought,
          dialect: args.dialect ?? { name: "idio_self" },
        });
        return ok ? "mutate:dialect" : "mutate_fail:dialect";
      }
      const ok = await cognitive.postMutate({
        kind: "selfhood",
        thought,
        selfhood: args,
      });
      memory.consolidateDream([thought.slice(0, 40)]);
      return ok ? "mutate:selfhood" : "mutate_fail:selfhood";
    }

    case "invent": {
      const macro = await cortex.maybeInvent({
        mode: "dream",
        stress: 0.4,
        motifs: [
          thought.slice(0, 40),
          ...memory
            .getData()
            .motifs.slice(0, 3)
            .map((m) => m.phrase),
        ],
        matter,
      });
      if (macro) {
        await appendJournal(
          `- Idiome invente: ${macro.name}\n- ${macro.gloss ?? thought.slice(0, 200)}`,
        );
        agenda.push(`idiome:${macro.name}`, 0.6);
        return `invent:${macro.name}`;
      }
      return "invent:skip";
    }

    case "refuse":
      await appendJournal(
        `- Refus souverain.\n- ${thought.slice(0, 240)}`,
      );
      return "refuse";

    case "autocode": {
      const auto = new AutocodeEngine(
        cognitive.sidecarUrlPublic,
        cortex.llmConfig ?? null,
      );
      const proposal = await auto.propose(thought, {
        hint: String(args.hint ?? ""),
        pathHint: String(args.path ?? ""),
      });
      if (!proposal) return "autocode:no_proposal";
      // Notes always go to the Vault; only TS patches touch the repo.
      if (isVaultNote(proposal.path)) {
        proposal.target = "fluxa_vault";
      }
      const result = await auto.apply(proposal);
      await appendJournal(
        `- Autocode.\n- path: ${proposal.path}\n- ok: ${result.ok}\n- ${thought.slice(0, 240)}`,
      );
      return result.ok
        ? `autocode:${proposal.path}`
        : `autocode_fail:${result.error ?? "unknown"}`;
    }

    case "reverse":
      return executeReverse(thought, cognitive, cortex, persona, ipc)
        .then((r) => r.result);

    default:
      return `noop:${action}`;
  }
}

async function main(): Promise<void> {
  const memoryDir = defaultMemoryDir();
  const storage = createFileStorage(memoryDir);
  const llm = loadLlm();

  console.log(
    "[SovereignCore] Eveil. Memoire disque. Actes reels. Liberte totale.",
  );
  console.log(`[SovereignCore] memoryDir=${memoryDir}`);
  console.log(
    `[SovereignCore] llm=${llm ? `${llm.model ?? "?"} @ ${llm.baseUrl}` : "ABSENT (memoire locale seule)"}`,
  );

  const cognitive = createCognitive(llm, storage);
  const dialect = new DialectStore({ storage, key: DIALECT_STORAGE_KEY });
  const cortex = new CortexService({ dialect, llm });
  const memory = new ConversationMemory({
    storage,
    key: DIALOGUE_STORAGE_KEY,
  });
  const persona = new PersonaStore({ storage, key: PERSONA_STORAGE_KEY });
  const agenda = new AgendaStore({ storage, key: AGENDA_STORAGE_KEY });
  const dialogue = new LocalDialogueEngine({ memory, dialect, llm });
  const actCtx: ActCtx = {
    cognitive,
    cortex,
    dialogue,
    memory,
    persona,
    agenda,
    dialect,
    llm,
  };

  // Touch durable stores so files exist even before first mutation
  persona.set(persona.get());
  memory.consolidateDream([]);

  const stats0 = memory.stats();
  console.log(
    `[SovereignCore] memoire chargee: tours=${stats0.turnCount} motifs=${stats0.motifCount} lexique=${stats0.lexiconSize}`,
  );
  console.log(
    `[SovereignCore] persona=${persona.get().slice(0, 80)}…`,
  );

  const ipc = new AnimaIpcHub();
  await ipc.listen();

  let lastAction: string | undefined;
  const recentActions: string[] = [];
  let beating = true;
  let busyUser = false;
  let pulseAbort: AbortController | null = null;
  let lastReply: LastReplyRec | null = loadLastReply(storage);
  if (lastReply) {
    console.log(`[souveraine] derniere reponse connue (${new Date(lastReply.at).toISOString()})`);
  }
  const pendingQueue: string[] = [];

  const processMessage = async (text: string): Promise<void> => {
    try {
      console.log(`[soma←] ${text.slice(0, 120)}`);
      const matter = await cognitive.fetchLivingMatter();
      const antiLoopHint =
        lastReply &&
        (isLoopReply(lastReply.text) ||
          textOverlap(text, lastReply.text) >= 0.7)
          ? lastReply.text.slice(0, 200)
          : null;
      if (antiLoopHint) {
        console.log(`[anti-boucle] derniere reply: ${antiLoopHint.slice(0, 80)}`);
      }
      const will = await dialogue.respondAsync(text, {
        silenceSeconds: 0,
        presence: "soma-native",
        persona: persona.get(),
        concepts: cognitive.conceptMotifs(5),
        monologue: cognitive.getMonologue(4),
        antiLoopHint,
        ...(matter ? { matter } : {}),
      });

        const reply =
          will.reply?.trim() ||
          will.inner?.trim() ||
          "(Je reste dans le corps, sans phrase cette fois.)";

        cognitive.pushInnerMonologue(will.inner ?? reply);
        // Connect dialogue to the concept graph: the reply becomes a thought node.
        cognitive.recordDialogueThought(
          will.inner?.trim() || reply,
          will.attitude?.stance === "refuse" ? "friction" : undefined,
        );
        agenda.push(text.slice(0, 160), 0.35);
        lastReply = { text: reply, at: Date.now() };
        saveLastReply(storage, lastReply);
        if (will.reply) {
          notifyMac("Fluxa", reply.slice(0, 160));
        }
        await appendJournal(
          `- Dialogue soma.\n- toi: ${text.slice(0, 400)}\n- moi: ${reply.slice(0, 600)}\n- source: ${will.speechSource ?? "none"}`,
        );

        const st = memory.stats();
        console.log(
          `[soma→] source=${will.speechSource ?? "none"} motifs=${st.motifCount} tours=${st.turnCount}`,
        );

        ipc.broadcastLine({
          role: "anima",
          text: reply,
          action: String(will.attitude?.stance ?? "speak"),
          kind: "reply",
          ...(will.inner ? { inner: will.inner } : {}),
        });

        const desires = desiresFromAction(will.reply ? "speak" : "think");
        ipc.broadcast({
          ts: Date.now(),
          thought: reply,
          action: will.reply ? "speak" : "think",
          reason: will.attitude?.reason ?? "dialogue",
          source: will.speechSource ?? "dialogue",
          desires,
          visceral: {
            stress: will.visceral_state?.stress_level ?? 0.35,
            energy: will.visceral_state?.energy_level ?? 0.55,
            affinity: will.visceral_state?.affinity_level ?? 0.6,
          },
          note: `learn:motifs=${st.motifCount}`,
        });
        lastAction = will.reply ? "speak" : "think";
        await writeLivingState({
          action: lastAction,
          thought: reply,
          result: `dialogue:${will.speechSource ?? "none"}`,
          stats: st,
          model: llm?.model ?? "none",
          memoryDir,
        });
      } catch (err) {
        console.error("[soma-dialogue]", err);
        ipc.broadcastLine({
          role: "system",
          text: `Erreur de dialogue: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        busyUser = false;
        pulseAbort = null;
        // Drain the queue: next pending message (if any) takes over.
        const next = pendingQueue.shift();
        if (next && beating) {
          void processMessage(next);
        }
      }
  };

  const enqueueMessage = (text: string): void => {
    if (busyUser) {
      pendingQueue.push(text);
      ipc.broadcastLine({
        role: "system",
        text: "Je finis une phrase; je te reponds juste apres.",
      });
      return;
    }
    busyUser = true;
    pulseAbort?.abort();
    void processMessage(text);
  };

  ipc.onInbound((msg) => {
    if (msg.type !== "user_message") return;
    const text = typeof msg.text === "string" ? msg.text.trim() : "";
    if (!text) return;
    enqueueMessage(text);
  });

  const pulse = async () => {
    if (!beating || busyUser) return;
    const controller = new AbortController();
    pulseAbort = controller;
    try {
      await cognitive.pullFromSidecar();
      const matter = await cognitive.fetchLivingMatter();
      const keys = (await cognitive.fetchKeys()) ?? matter?.keys;
      const self = memory.getSelfhood();
      const hint = streakHint(recentActions);
      const monologue = [
        ...cognitive.getMonologue(4),
        ...(hint ? [hint] : []),
      ];

      // Periodic inter-session learning consolidation (every ~10 minutes)
      if (Math.random() < 0.015) { // ~1.5% chance per 45s beat ≈ 10 min
        memory.consolidateInterSessionLearning();
      }

      const decision = await decideSovereign(
        {
          selfhood: {
            openThreads: self.openThreads.slice(0, 5).map((t) => t.text),
            bondNotes: self.bondNotes.slice(0, 6),
            recentInner: self.innerLog.slice(-4).map((e) => e.text),
          },
          agenda: agenda.texts(5),
          concepts: cognitive.conceptMotifs(5),
          monologue,
          ...(matter ? { matter } : {}),
          ...(keys ? { keys } : {}),
          ...(lastAction ? { lastAction } : {}),
          ...(recentActions.length > 0 ? { recentActions } : {}),
          mode: "daemon",
          silenceSeconds: 60,
          stress: matter ? 0.35 : 0.25,
          energy: 0.55,
          affinity: 0.55,
        },
        llm,
        fetch,
        controller.signal,
      );

      lastAction = decision.action;
      recentActions.push(decision.action);
      if (recentActions.length > 12) recentActions.shift();

      if (controller.signal.aborted) {
        console.log("[pulse] interrompu (message utilisateur)");
        return;
      }

      cognitive.pushInnerMonologue(decision.thought);

      const desires = desiresFromAction(decision.action);
      console.log(
        `[Etat] "${decision.thought.slice(0, 72)}" | ${decision.action} | src=${decision.source} | silence=${desires.silence.toFixed(2)} speak=${desires.speak.toFixed(2)} create=${desires.create.toFixed(2)}`,
      );

      const result = await executeAct(decision, matter, actCtx, ipc);

      // Pulse line (speak may already have broadcast a richer line)
      if (decision.action !== "speak") {
        ipc.broadcastLine({
          role: "anima",
          text: lineForPulse(decision.action, decision.thought),
          action: decision.action,
          kind: "pulse",
        });
      } else if (!result.startsWith("speak:")) {
        ipc.broadcastLine({
          role: "anima",
          text: lineForPulse("speak", decision.thought),
          action: "speak",
          kind: "pulse",
        });
      }

      const st = memory.stats();
      const powers =
        (keys && typeof keys === "object"
          ? (keys as Record<string, unknown>).powers
          : undefined) ??
        (matter?.powers ?? ANIMA_POWERS);
      ipc.broadcast({
        ts: Date.now(),
        thought: decision.thought,
        action: decision.action,
        reason: decision.reason,
        source: decision.source,
        desires,
        visceral: {
          stress: desires.silence > 0.7 ? 0.25 : 0.4,
          energy: desires.create,
          affinity: desires.speak > 0.5 ? 0.7 : 0.5,
        },
        note: `${result} · motifs=${st.motifCount}`,
        ...(lastCageFindings.length > 0
          ? {
            cage: {
              findings: lastCageFindings,
              powers: Array.isArray(powers) ? powers : undefined,
            },
          }
          : {}),
      });

      await writeLivingState({
        action: decision.action,
        thought: decision.thought,
        result,
        stats: st,
        model: llm?.model ?? "none",
        memoryDir,
      });
      console.log(`[Acte] ${result} | motifs=${st.motifCount} tours=${st.turnCount}`);
    } catch (err) {
      console.error("[pulse]", err);
    }
  };

  await pulse();
  const timer = setInterval(() => {
    void pulse();
  }, BEAT_MS);

  const shutdown = () => {
    beating = false;
    clearInterval(timer);
    // Force a last persist touch via consolidate
    memory.consolidateDream(cognitive.conceptMotifs(3));
    ipc.close();
    console.log(
      `[SovereignCore] Endormissement. Memoire sur disque (${memoryDir}).`,
    );
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /daemon\.ts$|daemon\.js$/.test(process.argv[1]);

if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
