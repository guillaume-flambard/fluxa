import type { VisceralState } from "../synaptic/types.js";
import { compileExpression } from "./compiler/compile.js";
import { executeProgram } from "./compiler/execute.js";
import type { AelProgram } from "./compiler/opcodes.js";

export type OrganiteKind = "orb" | "tendril" | "shard";

export type AnimaOp =
  | {
      op: "ripple";
      x: number;
      y: number;
      amp?: number;
      sigma?: number;
    }
  | { op: "ink"; x: number; y: number }
  | {
      op: "organite";
      kind: OrganiteKind;
      x: number;
      y: number;
      hue?: number;
      life?: number;
      radius?: number;
    }
  | {
      op: "field";
      warp?: number;
      stress?: number;
      energy?: number;
      affinity?: number;
    }
  | { op: "utter"; text: string }
  | {
      op: "invoke";
      name: string;
      /** Optional UV bias for relative placement inside macro body */
      x?: number;
      y?: number;
    };

export interface AnimaExpression {
  ops: AnimaOp[];
  visceral_state?: VisceralState;
}

export interface OrganiteSlot {
  x: number;
  y: number;
  /** 0 orb, 1 tendril, 2 shard */
  kind: number;
  life: number;
  hue: number;
  radius: number;
  /** Living panel cell (metric organite); metabolized under stress/dream */
  panel?: boolean;
}

export const MAX_ORGANITES = 8;

export function kindToIndex(kind: OrganiteKind): number {
  if (kind === "tendril") return 1;
  if (kind === "shard") return 2;
  return 0;
}

/** Host surface the executor mutates (implemented by HeightmapSimulator). */
export interface ExpressionHost {
  enqueueRipple: (
    x: number,
    y: number,
    amplitude: number,
    sigma: number,
  ) => void;
  pushInk: (x: number, y: number) => void;
  spawnOrganite: (slot: OrganiteSlot) => void;
  applyField: (partial: {
    warp?: number;
    stress?: number;
    energy?: number;
    affinity?: number;
  }) => void;
  wake: () => void;
}

/** Duck type so executeExpression need not import DialectStore (avoids cycles). */
export interface ExpressionExpander {
  expand(ops: AnimaOp[]): AnimaOp[];
}

function preferAstPath(): boolean {
  try {
    const g = globalThis as {
      __FLUXA_AEL_AST__?: boolean;
      process?: { env?: Record<string, string | undefined> };
    };
    if (g.__FLUXA_AEL_AST__ === true) return true;
    if (g.process?.env?.FLUXA_AEL_AST === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

function runOps(host: ExpressionHost, ops: AnimaOp[]): string | undefined {
  let utter: string | undefined;
  for (const op of ops) {
    switch (op.op) {
      case "ripple":
        host.enqueueRipple(
          op.x,
          op.y,
          op.amp ?? -0.35,
          op.sigma ?? 0.03,
        );
        break;
      case "ink":
        host.pushInk(op.x, op.y);
        break;
      case "organite":
        host.spawnOrganite({
          x: op.x,
          y: op.y,
          kind: kindToIndex(op.kind),
          life: op.life ?? 1,
          hue: op.hue ?? 0.45,
          radius: op.radius ?? 0.04,
        });
        break;
      case "field":
        {
          const partial: {
            warp?: number;
            stress?: number;
            energy?: number;
            affinity?: number;
          } = {};
          if (op.warp != null) partial.warp = op.warp;
          if (op.stress != null) partial.stress = op.stress;
          if (op.energy != null) partial.energy = op.energy;
          if (op.affinity != null) partial.affinity = op.affinity;
          host.applyField(partial);
        }
        break;
      case "utter":
        if (op.text.trim()) utter = op.text.trim();
        break;
      case "invoke":
        break;
    }
  }
  return utter;
}

/**
 * Apply Anima Expression Language to the living body.
 * Default path: compile AST → bytecode → executeProgram.
 * Set FLUXA_AEL_AST=1 or globalThis.__FLUXA_AEL_AST__ for legacy AST interpret.
 */
export function executeExpression(
  host: ExpressionHost,
  expression: AnimaExpression,
  dialect?: ExpressionExpander | null,
): string | undefined {
  if (preferAstPath()) {
    const ops = dialect
      ? dialect.expand(expression.ops)
      : expression.ops.filter((o) => o.op !== "invoke");
    const utter = runOps(host, ops);
    if (expression.visceral_state) {
      host.applyField({
        stress: expression.visceral_state.stress_level,
        energy: expression.visceral_state.energy_level,
        affinity: expression.visceral_state.affinity_level,
      });
    }
    host.wake();
    return utter;
  }

  const program = compileExpression(expression.ops, dialect ?? null);
  return executeProgram(host, program, expression.visceral_state);
}

/** Direct somatic path when bytecode is already burned. */
export function executeCompiled(
  host: ExpressionHost,
  program: AelProgram,
  visceral?: VisceralState,
): string | undefined {
  return executeProgram(host, program, visceral);
}
