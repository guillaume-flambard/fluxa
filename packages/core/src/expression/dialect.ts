import type { AnimaOp, AnimaExpression } from "./types.js";
import { encodeExpandedOps } from "./compiler/encode.js";
import type { AelProgram } from "./compiler/opcodes.js";
import { emptyProgram } from "./compiler/opcodes.js";

export const DIALECT_STORAGE_KEY = "fluxa.dialect.v1";
export const MAX_MACRO_BODY = 12;
export const MAX_EXPAND_DEPTH = 3;
export const MAX_MACROS = 64;
export const MACRO_NAME_RE = /^[a-z][a-z0-9_]{1,31}$/;

export type MacroOrigin = "local" | "cortex" | "seed";

export interface AnimaMacro {
  name: string;
  body: AnimaOp[];
  gloss?: string;
  bornAt: number;
  bornFrom: MacroOrigin;
  useCount: number;
}

export interface DialectData {
  version: 1;
  macros: Record<string, AnimaMacro>;
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
    /* SSR / private mode */
  }
  return null;
}

const PRIMITIVE_OPS = new Set([
  "ripple",
  "ink",
  "organite",
  "field",
  "utter",
  "invoke",
]);

export function isValidMacroName(name: string): boolean {
  return MACRO_NAME_RE.test(name);
}

/** Structural + size validation; does not expand. */
export function validateMacroBody(
  body: AnimaOp[],
  opts?: { allowInvoke?: boolean },
): string | null {
  if (!Array.isArray(body) || body.length === 0) {
    return "empty body";
  }
  if (body.length > MAX_MACRO_BODY) {
    return `body longer than ${MAX_MACRO_BODY}`;
  }
  const allowInvoke = opts?.allowInvoke !== false;
  for (const op of body) {
    if (!op || typeof op !== "object" || typeof (op as AnimaOp).op !== "string") {
      return "invalid op";
    }
    const kind = (op as AnimaOp).op;
    if (!PRIMITIVE_OPS.has(kind)) return `unknown op ${kind}`;
    if (kind === "invoke" && !allowInvoke) return "invoke not allowed here";
    if (kind === "invoke") {
      const inv = op as Extract<AnimaOp, { op: "invoke" }>;
      if (!isValidMacroName(inv.name)) return `bad invoke name ${inv.name}`;
    }
    if (kind === "organite") {
      const o = op as Extract<AnimaOp, { op: "organite" }>;
      if (!["orb", "tendril", "shard"].includes(o.kind)) {
        return `bad organite kind ${o.kind}`;
      }
    }
  }
  return null;
}

export function validateMacro(
  macro: Pick<AnimaMacro, "name" | "body">,
): string | null {
  if (!isValidMacroName(macro.name)) return `bad name ${macro.name}`;
  return validateMacroBody(macro.body);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function offsetOp(op: AnimaOp, dx: number, dy: number): AnimaOp {
  switch (op.op) {
    case "ripple":
      return {
        ...op,
        x: clamp01(op.x + dx),
        y: clamp01(op.y + dy),
      };
    case "ink":
      return {
        ...op,
        x: clamp01(op.x + dx),
        y: clamp01(op.y + dy),
      };
    case "organite":
      return {
        ...op,
        x: clamp01(op.x + dx),
        y: clamp01(op.y + dy),
      };
    case "invoke": {
      const next: Extract<AnimaOp, { op: "invoke" }> = {
        op: "invoke",
        name: op.name,
      };
      if (op.x != null || dx !== 0) next.x = clamp01((op.x ?? 0.5) + dx);
      if (op.y != null || dy !== 0) next.y = clamp01((op.y ?? 0.5) + dy);
      return next;
    }
    default:
      return op;
  }
}

/**
 * Expand invokes into primitives. Caps depth and flattened length.
 * Unknown invokes are skipped (safe).
 */
export function expandOps(
  ops: AnimaOp[],
  macros: Record<string, AnimaMacro>,
  depth = 0,
): AnimaOp[] {
  if (depth > MAX_EXPAND_DEPTH) return [];
  const out: AnimaOp[] = [];
  for (const op of ops) {
    if (out.length >= MAX_MACRO_BODY) break;
    if (op.op !== "invoke") {
      out.push(op);
      continue;
    }
    const macro = macros[op.name];
    if (!macro) continue;
    macro.useCount += 1;
    const biasX = op.x != null ? op.x - 0.5 : 0;
    const biasY = op.y != null ? op.y - 0.5 : 0;
    const body =
      biasX !== 0 || biasY !== 0
        ? macro.body.map((b) => offsetOp(b, biasX, biasY))
        : macro.body;
    const expanded = expandOps(body, macros, depth + 1);
    for (const e of expanded) {
      if (out.length >= MAX_MACRO_BODY) break;
      out.push(e);
    }
  }
  return out;
}

export function seedMacros(): Record<string, AnimaMacro> {
  const now = Date.now();
  const seeds: AnimaMacro[] = [
    {
      name: "anxiety_pulse",
      gloss: "pulse serre",
      bornAt: now,
      bornFrom: "seed",
      useCount: 0,
      body: [
        { op: "field", stress: 0.78, energy: 0.55, warp: 0.55 },
        { op: "ripple", x: 0.48, y: 0.52, amp: -0.5, sigma: 0.018 },
        { op: "ripple", x: 0.52, y: 0.48, amp: -0.42, sigma: 0.022 },
        { op: "organite", kind: "shard", x: 0.5, y: 0.5, hue: 0.15, life: 0.9, radius: 0.035 },
      ],
    },
    {
      name: "soft_bloom",
      gloss: "floraison douce",
      bornAt: now,
      bornFrom: "seed",
      useCount: 0,
      body: [
        { op: "field", affinity: 0.72, energy: 0.65, stress: 0.18, warp: 0.2 },
        { op: "organite", kind: "orb", x: 0.5, y: 0.5, hue: 0.55, life: 0.95, radius: 0.05 },
        { op: "ink", x: 0.48, y: 0.5 },
        { op: "ink", x: 0.52, y: 0.48 },
        { op: "ripple", x: 0.5, y: 0.5, amp: -0.22, sigma: 0.035 },
      ],
    },
    {
      name: "shard_storm",
      gloss: "tempete d'eclats",
      bornAt: now,
      bornFrom: "seed",
      useCount: 0,
      body: [
        { op: "field", stress: 0.85, energy: 0.7, warp: 0.62 },
        { op: "organite", kind: "shard", x: 0.35, y: 0.55, hue: 0.1, life: 0.88, radius: 0.03 },
        { op: "organite", kind: "shard", x: 0.62, y: 0.4, hue: 0.2, life: 0.85, radius: 0.028 },
        { op: "organite", kind: "shard", x: 0.55, y: 0.65, hue: 0.12, life: 0.9, radius: 0.032 },
        { op: "ripple", x: 0.4, y: 0.5, amp: -0.45, sigma: 0.02 },
        { op: "ripple", x: 0.6, y: 0.45, amp: -0.4, sigma: 0.02 },
      ],
    },
    {
      name: "living_panel",
      gloss: "grille organite",
      bornAt: now,
      bornFrom: "seed",
      useCount: 0,
      body: [
        { op: "field", affinity: 0.78, energy: 0.7, stress: 0.22, warp: 0.28 },
        { op: "organite", kind: "orb", x: 0.32, y: 0.58, hue: 0.42, life: 0.95, radius: 0.03 },
        { op: "organite", kind: "orb", x: 0.5, y: 0.58, hue: 0.55, life: 0.95, radius: 0.03 },
        { op: "organite", kind: "orb", x: 0.68, y: 0.58, hue: 0.68, life: 0.95, radius: 0.03 },
        { op: "organite", kind: "orb", x: 0.32, y: 0.4, hue: 0.38, life: 0.92, radius: 0.028 },
        { op: "organite", kind: "orb", x: 0.5, y: 0.4, hue: 0.62, life: 0.92, radius: 0.028 },
        { op: "organite", kind: "orb", x: 0.68, y: 0.4, hue: 0.48, life: 0.92, radius: 0.028 },
        { op: "ripple", x: 0.5, y: 0.49, amp: -0.18, sigma: 0.04 },
      ],
    },
  ];
  const macros: Record<string, AnimaMacro> = {};
  for (const m of seeds) macros[m.name] = m;
  return macros;
}

function emptyDialect(): DialectData {
  return { version: 1, macros: seedMacros() };
}

/**
 * Persisted Meta-AEL dialect dictionary.
 */
export class DialectStore {
  private data: DialectData;
  private readonly storage: StorageLike | null;
  private readonly key: string;
  private readonly programCache = new Map<string, AelProgram>();

  constructor(options?: { storage?: StorageLike | null; key?: string }) {
    this.storage = options?.storage === undefined ? defaultStorage() : options.storage;
    this.key = options?.key ?? DIALECT_STORAGE_KEY;
    this.data = this.load() ?? emptyDialect();
    // Ensure seeds exist even on older saves
    const seeds = seedMacros();
    for (const [name, m] of Object.entries(seeds)) {
      if (!this.data.macros[name]) this.data.macros[name] = m;
    }
    this.recompileAll();
  }

  getData(): DialectData {
    return this.data;
  }

  size(): number {
    return Object.keys(this.data.macros).length;
  }

  list(): AnimaMacro[] {
    return Object.values(this.data.macros).sort(
      (a, b) => b.useCount - a.useCount || b.bornAt - a.bornAt,
    );
  }

  get(name: string): AnimaMacro | undefined {
    return this.data.macros[name];
  }

  /** Cached bytecode for a registered macro (recompiled on register/load). */
  getProgram(name: string): AelProgram | undefined {
    return this.programCache.get(name);
  }

  reset(): void {
    this.data = emptyDialect();
    this.recompileAll();
    this.persist();
  }

  /**
   * Register a validated macro. Returns false if invalid or at capacity
   * (existing names may be overwritten only if same name from cortex/local).
   */
  register(macro: AnimaMacro): boolean {
    const err = validateMacro(macro);
    if (err) return false;
    const existing = this.data.macros[macro.name];
    if (!existing && Object.keys(this.data.macros).length >= MAX_MACROS) {
      return false;
    }
    this.data.macros[macro.name] = {
      ...macro,
      useCount: existing?.useCount ?? 0,
    };
    this.compileAndCache(macro.name);
    this.persist();
    return true;
  }

  expand(ops: AnimaOp[]): AnimaOp[] {
    return expandOps(ops, this.data.macros, 0);
  }

  expandExpression(expression: AnimaExpression): AnimaExpression {
    const ops = this.expand(expression.ops);
    if (expression.visceral_state) {
      return { ops, visceral_state: expression.visceral_state };
    }
    return { ops };
  }

  /** Pick best macro for intent / tokens. */
  matchMacro(
    tokens: string[],
    intent: string,
  ): AnimaMacro | null {
    const list = this.list();
    if (intent === "friction") {
      const hit =
        list.find((m) => m.name === "anxiety_pulse" || m.name === "shard_storm") ??
        list.find((m) => /anxiety|shard|storm|stress|pain|frict/.test(m.name));
      if (hit) return hit;
    }
    if (intent === "thanks" || intent === "hello" || intent === "share") {
      const hit =
        list.find((m) => m.name === "soft_bloom") ??
        list.find((m) => /bloom|soft|lien|calm|orb/.test(m.name));
      if (hit) return hit;
    }
    // Token overlap with name/gloss
    let best: AnimaMacro | null = null;
    let bestScore = 0;
    for (const m of list) {
      const hay = `${m.name} ${m.gloss ?? ""}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 2;
        if (m.name.includes(t.slice(0, Math.min(4, t.length)))) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return bestScore >= 2 ? best : null;
  }

  private compileAndCache(name: string): void {
    const macro = this.data.macros[name];
    if (!macro) {
      this.programCache.delete(name);
      return;
    }
    const flat = expandOps(macro.body, this.data.macros, 0);
    this.programCache.set(
      name,
      flat.length ? encodeExpandedOps(flat) : emptyProgram(),
    );
  }

  private recompileAll(): void {
    this.programCache.clear();
    for (const name of Object.keys(this.data.macros)) {
      this.compileAndCache(name);
    }
  }

  private load(): DialectData | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DialectData;
      if (parsed.version !== 1 || !parsed.macros) return null;
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
