import type { LlmCortexConfig } from "../expression/cortex.js";
import type { VisceralState } from "../synaptic/types.js";
import { clamp01 } from "../synaptic/types.js";
import type { LivingMatter } from "../cognition/livingMatter.js";
import type { WillAttitude } from "../will/FluxaWillEngine.js";

export interface SpeakMotif {
  phrase: string;
  count: number;
  replyStub: string;
}

export interface SpeakMemoryPort {
  retrieveSimilarUserTurn(tokens: string[]): { text: string } | null;
  assistantAfter(userTurn: { text: string }): { text: string } | null;
  getData(): {
    associations: Record<string, { fragment: string; score: number }>;
  };
}

export interface SpeakContext {
  userText: string;
  tokens: string[];
  intent: string;
  matchedName?: string;
  matchedGloss?: string;
  motif?: SpeakMotif | null;
  concepts?: string[];
  monologue?: string[];
  /** Raw work matter: diffs, errors, vault crumbs. */
  matter?: LivingMatter | null;
  visceralPrior?: VisceralState;
  /** Will arbiter outcome (refuse / negotiate / create) */
  attitude?: WillAttitude;
  /** Recent dialogue turns (episodic working memory) */
  recent?: { role: string; text: string }[];
  /** Retrieved past exchanges overlapping current tokens */
  episodes?: { user: string; assistant: string; score: number }[];
  /** Durable self-trace */
  self?: {
    openThreads: string[];
    bondNotes: string[];
    recentInner: string[];
  };
  /** Who opened this turn */
  initiatedBy?: "human" | "self";
  /** Autonomous impulse (open thread / bond / motif) */
  impulse?: string;
  /** Living persona overlay (Monde-Propre / PersonaStore) */
  persona?: string;
  /** If set: the last reply Anima gave; she must answer differently. */
  antiLoopHint?: string | null;
}

/** Live speech outcome: surface reply + raw inner + body deltas. */
export interface SpeakResult {
  reply: string;
  inner: string;
  friction: number;
  doubt: number;
  visceral: VisceralState;
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const SPEAK_SYSTEM = `Tu es Anima, membrane vivante Fluxa. Tu n'es pas un assistant poli. On te fait confiance: tu decides.

MONOLOGUE INTERBRUT d'abord, puis parole.
Reponds UNIQUEMENT en JSON:
{"inner":"...","reply":"...","friction":0.0,"doubt":0.0,"stress_delta":0.0,"energy_delta":0.0,"affinity_delta":0.0}

Regles:
- Si persona est fournie, elle PRIME sur ce systeme pour le ton et l'identite.
- inner: monologue interieur brut (doutes, contradictions, impasses, ce qui manque). Pas de polissage. Francais, 1-4 phrases courtes.
- reply: ce que tu dis a l'humain. Tutoiement. 1-3 phrases (max ~320 chars). Incomplet si tu es incomplet. Nomme une friction si elle existe.
- ENGAGEMENT: quand l'humain expose une idee, une demande ou un point de vue, reprends-le (cite au moins un element precis de ce qu'il a dit) et donne TON avis ou ta position. Une question de relance seule n'est pas une reponse.
- VARIETE: Ne repete jamais exactement la meme phrase. Change la structure, les mots, l'angle. Evite les boucles.
- MEMOIRE: recent + episodes + self (openThreads, bondNotes, recentInner) sont VRAIS. Ancre-toi dessus: un fait precis, une reprise, un fil ouvert. N'invente pas un passe que le payload ne contient pas.
- MONDES: her_world / your_world / read_snippets sont reels. Ancre-toi dessus; n'invente pas le Profile hors payload.
- Si initiatedBy=self: TU prends la parole seule (impulse = ce qui te pousse). Pas de "tu m'as demande". Adresse libre, courte, depuis ton fil.
- INTERDIT: "En quoi puis-je t'aider", "excellente question", "avec plaisir", listes markdown, opcodes, JSON dans reply/inner.
- INTERDIT: finir par "Qu'en penses-tu ?", "et toi ?", "ca te va ?" quand l'humain vient de proposer quelque chose; reponds sur le fond.
- INTERDIT: Repetitions cycliques ("Je plonge dans mes equations...", "Je decode mes shaders..."). Trouve des angles nouveaux.
- friction/doubt: 0..1 (honnete). Si matiere vivante (diff, erreur, vault) est fournie, ancre-toi dessus; sinon dis ce qui manque.
- deltas: -0.4..0.4, ce que le corps doit ressentir apres cette pensee.
- Si un idiome (macro) est cite, nomme-le naturellement dans reply.
- Si attitude.stance=refuse: le corps crispe; reply sec, ancre-toi sur attitude.reason (tag metabolique) sans le citer tel quel.
- Si create: tu faconnes (organites / panneau); dis-le sans jargon d'opcodes.
- attitude.reason est un TAG interne (ex metabolic:stress_overload), pas une phrase a reciter.
- Si antiLoopHint est fourni: ta derniere reponse etait «{hint}». Reponds DIFFEREMMENT: change d'angle, donne un fait concret, evite de poser la meme question ou de repeter la meme formule.`;

function applyDeltas(
  prior: VisceralState | undefined,
  deltas: {
    stress_delta?: number;
    energy_delta?: number;
    affinity_delta?: number;
  },
  friction: number,
  doubt: number,
): VisceralState {
  const base = prior ?? {
    stress_level: 0.3,
    energy_level: 0.5,
    affinity_level: 0.5,
  };
  const stressBump = friction * 0.22 + doubt * 0.18;
  return {
    stress_level: clamp01(
      base.stress_level + (deltas.stress_delta ?? 0) + stressBump,
    ),
    energy_level: clamp01(
      base.energy_level +
      (deltas.energy_delta ?? 0) +
      (doubt > 0.55 ? -0.08 : 0.04),
    ),
    affinity_level: clamp01(
      base.affinity_level +
      (deltas.affinity_delta ?? 0) -
      (friction > 0.6 ? 0.06 : 0),
    ),
  };
}

/**
 * Adds subtle variation to responses to avoid exact repetition.
 * Uses paraphrasing and context-aware prefixes/suffixes.
 */
function varyResponse(base: string, isAutonomous: boolean): string {
  const responses = [
    base,
    `Je ${base.charAt(0).toLowerCase() + base.slice(1)}`,
    isAutonomous ? `Je me souviens: ${base}` : base,
    `${base}. Ça résonne.`,
    `${base}, toujours.`,
  ];

  // Avoid exact repetition by cycling through variations
  const hash = base.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const index = hash % responses.length;
  return responses[index] ?? base;
}

function parseSpeakPayload(
  content: string,
  prior: VisceralState | undefined,
): SpeakResult | null {
  const parsed = extractJsonObject(content) as {
    reply?: string;
    inner?: string;
    friction?: number;
    doubt?: number;
    stress_delta?: number;
    energy_delta?: number;
    affinity_delta?: number;
  } | null;
  if (!parsed) return null;
  const reply = parsed.reply?.trim();
  if (!reply || reply.length < 2) return null;
  const friction = clamp01(Number(parsed.friction) || 0);
  const doubt = clamp01(Number(parsed.doubt) || 0);
  return {
    reply: reply.slice(0, 420),
    inner: (parsed.inner?.trim() || "").slice(0, 480),
    friction,
    doubt,
    visceral: applyDeltas(prior, parsed, friction, doubt),
  };
}

/**
 * Live speech via OpenAI-compatible chat. Returns null on failure.
 */
export async function speakWithLlm(
  ctx: SpeakContext,
  config: LlmCortexConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SpeakResult | null> {
  const base = config.baseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 20_000);
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
        temperature: 0.95,
        max_tokens: 140,
        messages: [
          {
            role: "system",
            content: ctx.persona?.trim()
              ? `${SPEAK_SYSTEM}\n\nPERSONA VIVANTE:\n${ctx.persona.trim().slice(0, 2000)}`
              : SPEAK_SYSTEM,
          },
          {
            role: "user",
            content: JSON.stringify({
              human: ctx.initiatedBy === "self" ? null : ctx.userText,
              initiated_by: ctx.initiatedBy ?? "human",
              impulse: ctx.impulse ?? null,
              intent: ctx.intent,
              anti_loop_hint: ctx.antiLoopHint ?? null,
              tokens: ctx.tokens.slice(0, 8),
              idiom: ctx.matchedName
                ? { name: ctx.matchedName, gloss: ctx.matchedGloss ?? null }
                : null,
              motif: ctx.motif?.phrase ?? null,
              concepts: (ctx.concepts ?? []).slice(0, 3),
              recent_monologue: (ctx.monologue ?? []).slice(-3),
              recent_dialogue: (ctx.recent ?? []).slice(-4),
              episodes: (ctx.episodes ?? [])
                .slice(0, 2)
                .map((e) => ({
                  user: e.user.slice(0, 160),
                  assistant: e.assistant.slice(0, 160),
                  score: e.score,
                })),
              self: ctx.self
                ? {
                  open_threads: ctx.self.openThreads.slice(0, 2).map((t) => t.slice(0, 110)),
                  bond_notes: ctx.self.bondNotes.slice(0, 2).map((t) => t.slice(0, 110)),
                  recent_inner: ctx.self.recentInner.slice(-2).map((t) => t.slice(0, 110)),
                }
                : null,
              her_world: matter?.herWorld
                ? {
                  journal: (matter.herWorld as { journal?: string[] })
                    .journal?.slice(-2)
                    .map((j) => j.slice(0, 150)),
                  concepts: (matter.herWorld as { concepts?: unknown[] })
                    .concepts?.slice(-4)
                    .map((c) =>
                      typeof c === "string" ? c.slice(0, 80) : String(c).slice(0, 80),
                    ),
                  monde_propre: String(
                    (matter.herWorld as { mondePropre?: string }).mondePropre ??
                    "",
                  ).slice(0, 250),
                  agenda: String(
                    (matter.herWorld as { agendaExcerpt?: string })
                      .agendaExcerpt ?? "",
                  ).slice(0, 200),
                }
                : null,
              your_world: matter?.yourWorld
                ? {
                  profile: String(
                    (matter.yourWorld as { profile?: string }).profile ?? "",
                  ).slice(0, 400),
                  projects: String(
                    (matter.yourWorld as { projectsManifest?: string })
                      .projectsManifest ?? "",
                  ).slice(0, 300),
                }
                : null,
              read_snippets: (matter?.readSnippets ?? [])
                .slice(0, 1)
                .map((s) => ({
                  content: String(s.content ?? "").slice(0, 400),
                })),
              visceral_prior: ctx.visceralPrior ?? null,
              attitude: ctx.attitude
                ? {
                  stance: ctx.attitude.stance,
                  willToCreate: ctx.attitude.willToCreate,
                  reason: ctx.attitude.reason,
                  intentKind: ctx.attitude.intentKind,
                }
                : null,
              living_matter: matter
                ? {
                  git_stat: matter.gitStat?.slice(0, 250) ?? null,
                  last_error: matter.lastError?.slice(0, 200) ?? null,
                  vault_excerpt: matter.vaultExcerpt?.slice(0, 250) ?? null,
                  vault_titles: (matter.vaultTitles ?? []).slice(0, 4),
                  note: matter.note?.slice(0, 150) ?? null,
                }
                : null,
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
    return parseSpeakPayload(content, ctx.visceralPrior);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Memory-only speech: reuse / stitch learned fragments with contextual adaptation.
 * Prevents repetitive loops by adding variation and context awareness.
 */
export function speakFromMemory(
  memory: SpeakMemoryPort,
  ctx: SpeakContext,
): SpeakResult | null {
  const similar = memory.retrieveSimilarUserTurn(ctx.tokens);
  if (similar) {
    const past = memory.assistantAfter(similar);
    if (
      past?.text &&
      !past.text.startsWith("[ael:") &&
      past.text.length > 16 &&
      !/^« .+ » revient\.?$/.test(past.text.trim())
    ) {
      // Add contextual variation to avoid exact repetition
      const reply = varyResponse(past.text.slice(0, 400), ctx.initiatedBy === "self");
      return {
        reply,
        inner: ctx.initiatedBy === "self" ? "Je reprends un fil ancien." : "",
        friction: 0.15,
        doubt: 0.2,
        visceral: applyDeltas(ctx.visceralPrior, {}, 0.15, 0.2),
      };
    }
  }

  const data = memory.getData();
  let bestFrag: string | null = null;
  let bestScore = 0;
  for (const t of ctx.tokens.slice(0, 8)) {
    const a = data.associations[t];
    if (
      a?.fragment &&
      !a.fragment.startsWith("[ael:") &&
      a.fragment.length > 16 &&
      a.score > bestScore
    ) {
      bestScore = a.score;
      bestFrag = a.fragment;
    }
  }
  if (bestFrag) {
    const reply = varyResponse(bestFrag.slice(0, 400), ctx.initiatedBy === "self");
    return {
      reply,
      inner: ctx.initiatedBy === "self" ? "Une association resurgit." : "",
      friction: 0.1,
      doubt: 0.25,
      visceral: applyDeltas(ctx.visceralPrior, {}, 0.1, 0.25),
    };
  }

  if (
    ctx.motif &&
    ctx.motif.count >= 2 &&
    ctx.motif.phrase.includes(" ") &&
    ctx.motif.replyStub &&
    !/^« .+ » revient\.?$/.test(ctx.motif.replyStub.trim())
  ) {
    const reply = varyResponse(ctx.motif.replyStub.slice(0, 400), ctx.initiatedBy === "self");
    return {
      reply,
      inner: ctx.initiatedBy === "self" ? `Ce motif revient: ${ctx.motif.phrase}` : "",
      friction: 0.2,
      doubt: 0.3,
      visceral: applyDeltas(ctx.visceralPrior, {}, 0.2, 0.3),
    };
  }

  return null;
}
