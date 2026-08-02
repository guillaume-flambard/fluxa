import type { AnimaOp, ExpressionExpander } from "../types.js";
import { encodeExpandedOps } from "./encode.js";
import { emptyProgram, type AelProgram } from "./opcodes.js";

/**
 * Burn ops into bytecode. Pass a dialect expander so invoke macros flatten first.
 */
export function compileExpression(
  ops: AnimaOp[],
  dialect?: ExpressionExpander | null,
): AelProgram {
  const flat = dialect
    ? dialect.expand(ops)
    : ops.filter((o) => o.op !== "invoke");
  if (flat.length === 0) return emptyProgram();
  return encodeExpandedOps(flat);
}

/**
 * Compile a macro body using an expander (DialectStore or { expand }).
 */
export function compileMacro(
  body: AnimaOp[],
  dialect: ExpressionExpander,
): AelProgram {
  return compileExpression(body, dialect);
}
