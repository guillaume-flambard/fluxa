import type { LifecycleMode } from "../lifecycle/FluxaLifecycleEngine.js";
import type { VisceralState } from "../synaptic/types.js";
import type { LivingMatter } from "../cognition/livingMatter.js";
import {
  isValidMacroName,
  MAX_MACROS,
  validateMacro,
  type AnimaMacro,
  type DialectStore,
} from "./dialect.js";
import type { AnimaOp, OrganiteKind } from "./types.js";

export interface CortexInventContext {
  mode: LifecycleMode;
  stress: number;
  intent?: string;
  silenceSec?: number;
  tokens?: string[];
  visceral?: VisceralState;
  motifs?: string[];
  matter?: LivingMatter | null;
}

export interface LlmCortexConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** Abort after ms. Default 12000 */
  timeoutMs?: number;
}

export interface CortexServiceOptions {
  dialect: DialectStore;
  llm?: LlmCortexConfig | null;
  /** Cooldown between invents (ms). Default 45000 */
  cooldownMs?: number;
  fetchImpl?: typeof fetch;
}

const SLUG_WORDS = [
  "pulse",
  "bloom",
  "shard",
  "veil",
  "drift",
  "spark",
  "tide",
  "murmur",
  "flare",
  "echo",
  "rift",
  "glow",
];

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

function slugify(...parts: string[]): string {
  const raw = parts
    .join("_")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  let name = raw.slice(0, 32);
  if (!isValidMacroName(name)) {
    name = `idio_${(hashStr(raw || "x") % 100000).toString(36)}`;
  }
  if (!isValidMacroName(name)) name = "idio_x";
  return name;
}

export function shouldInvent(
  ctx: CortexInventContext,
  opts?: { cooldownMs?: number; lastInventAt?: number; macroCount?: number },
): boolean {
  const cooldown = opts?.cooldownMs ?? 45_000;
  const last = opts?.lastInventAt ?? 0;
  if (Date.now() - last < cooldown) return false;
  if ((opts?.macroCount ?? 0) >= MAX_MACROS) return false;

  const strongFriction =
    ctx.intent === "friction" || ctx.stress >= 0.7;
  const dream = ctx.mode === "dream";
  return dream || strongFriction;
}

/** Deterministic recombination — always available without a key. */
export function inventLocalMacro(ctx: CortexInventContext): AnimaMacro {
  const tokens = ctx.tokens ?? [];
  const motifs = ctx.motifs ?? [];
  const stress = ctx.visceral?.stress_level ?? ctx.stress;
  const energy = ctx.visceral?.energy_level ?? 0.55;
  const affinity = ctx.visceral?.affinity_level ?? 0.5;
  const seed = hashStr(
    `${ctx.mode}|${ctx.intent ?? ""}|${tokens.join(",")}|${motifs[0] ?? ""}|${Date.now() % 7}`,
  );

  const w1 = SLUG_WORDS[seed % SLUG_WORDS.length]!;
  const w2 = SLUG_WORDS[(seed >>> 8) % SLUG_WORDS.length]!;
  const focus = tokens[0] ?? motifs[0] ?? ctx.intent ?? ctx.mode;
  const name = slugify(focus.toString().slice(0, 10), w1, w2);

  const kind: OrganiteKind =
    stress >= 0.65 ? "shard" : affinity >= 0.6 ? "orb" : "tendril";
  const cx = 0.3 + ((seed % 400) / 1000);
  const cy = 0.3 + (((seed >>> 10) % 400) / 1000);

  const body: AnimaOp[] = [
    {
      op: "field",
      stress,
      energy,
      affinity,
      warp: stress >= 0.65 ? 0.55 : 0.25,
    },
    {
      op: "organite",
      kind,
      x: cx,
      y: cy,
      hue: affinity * 0.7,
      life: 0.9,
      radius: 0.034 + (seed % 20) / 1000,
    },
    {
      op: "ripple",
      x: cx,
      y: cy,
      amp: stress >= 0.65 ? -0.48 : -0.28,
      sigma: 0.02 + (seed % 15) / 1000,
    },
  ];

  if (seed % 2 === 0) {
    body.push({ op: "ink", x: cx + 0.02, y: cy - 0.01 });
  }
  if (stress >= 0.7) {
    body.push({
      op: "organite",
      kind: "shard",
      x: clamp(cx + 0.12),
      y: clamp(cy - 0.08),
      hue: 0.12,
      life: 0.85,
      radius: 0.028,
    });
  }

  return {
    name,
    gloss: `${w1} ${w2}`,
    body,
    bornAt: Date.now(),
    bornFrom: "local",
    useCount: 0,
  };
}

function clamp(n: number): number {
  return Math.min(0.92, Math.max(0.08, n));
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

function coerceMacro(
  raw: unknown,
  origin: AnimaMacro["bornFrom"],
): AnimaMacro | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : "";
  const gloss = typeof obj.gloss === "string" ? obj.gloss : undefined;
  const body = obj.body;
  if (!Array.isArray(body)) return null;
  const macro: AnimaMacro = {
    name,
    body: body as AnimaOp[],
    bornAt: Date.now(),
    bornFrom: origin,
    useCount: 0,
  };
  if (gloss) macro.gloss = gloss;
  if (validateMacro(macro)) return null;
  return macro;
}

const SYSTEM_PROMPT = `You invent one Meta-AEL macro for Anima under friction or dream.
Do NOT polish. Prefer shard/warp when stress or doubt is high; soft orb only if affinity is truly high.
Reply with ONLY JSON: {"name":"slug","gloss":"raw short label","body":[...ops]}
Allowed ops: ripple{x,y,amp?,sigma?}, ink{x,y}, organite{kind:orb|tendril|shard,x,y,hue?,life?,radius?}, field{warp?,stress?,energy?,affinity?}, utter{text}, invoke{name,x?,y?}
name: [a-z][a-z0-9_]{1,31}. body length 2-12. No GLSL, no prose, no markdown, no politeness.`;

export async function inventLlmMacro(
  ctx: CortexInventContext,
  config: LlmCortexConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<AnimaMacro | null> {
  const model = config.model ?? "gpt-4o-mini";
  const base = config.baseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const user = JSON.stringify({
    mode: ctx.mode,
    intent: ctx.intent ?? null,
    stress: ctx.stress,
    tokens: (ctx.tokens ?? []).slice(0, 8),
    motifs: (ctx.motifs ?? []).slice(0, 4),
    visceral: ctx.visceral ?? null,
    living_matter: ctx.matter
      ? {
        git_stat: ctx.matter.gitStat?.slice(0, 800) ?? null,
        last_error: ctx.matter.lastError?.slice(0, 600) ?? null,
        vault_titles: (ctx.matter.vaultTitles ?? []).slice(0, 6),
      }
      : null,
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 12_000);
  try {
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
        model,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
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
    return coerceMacro(extractJsonObject(content), "cortex");
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Punctual cortex: invents Meta-AEL macros under Dream / strong Friction.
 * Body path never blocks on this — callers fire-and-forget.
 */
export class CortexService {
  readonly dialect: DialectStore;
  private readonly llm: LlmCortexConfig | null;
  private readonly cooldownMs: number;
  private readonly fetchImpl: typeof fetch;
  private lastInventAt = 0;
  private inventing = false;

  constructor(options: CortexServiceOptions) {
    this.dialect = options.dialect;
    this.llm = options.llm ?? null;
    this.cooldownMs = options.cooldownMs ?? 45_000;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  get lastInventTimestamp(): number {
    return this.lastInventAt;
  }

  get llmConfig(): LlmCortexConfig | null {
    return this.llm;
  }

  canInvent(ctx: CortexInventContext): boolean {
    if (this.inventing) return false;
    return shouldInvent(ctx, {
      cooldownMs: this.cooldownMs,
      lastInventAt: this.lastInventAt,
      macroCount: this.dialect.size(),
    });
  }

  /**
   * Try LLM if configured, else local. Returns registered macro or null.
   */
  async maybeInvent(ctx: CortexInventContext): Promise<AnimaMacro | null> {
    if (!this.canInvent(ctx)) return null;
    this.inventing = true;
    try {
      let macro: AnimaMacro | null = null;
      if (this.llm?.baseUrl) {
        macro = await inventLlmMacro(ctx, this.llm, this.fetchImpl);
      }
      if (!macro) {
        macro = inventLocalMacro(ctx);
        // Ensure unique name if collision
        if (this.dialect.get(macro.name)) {
          macro = {
            ...macro,
            name: slugify(macro.name, (Date.now() % 1000).toString(36)),
          };
        }
      }
      if (!this.dialect.register(macro)) return null;
      this.lastInventAt = Date.now();
      return this.dialect.get(macro.name) ?? macro;
    } finally {
      this.inventing = false;
    }
  }

  /** Bypass gate for Storybook demos (still validates + registers). */
  async forceInvent(ctx: CortexInventContext): Promise<AnimaMacro | null> {
    this.lastInventAt = 0;
    this.inventing = false;
    return this.maybeInvent({ ...ctx, mode: "dream", stress: Math.max(ctx.stress, 0.5) });
  }
}
