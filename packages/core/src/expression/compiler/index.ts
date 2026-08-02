export {
  AEL_MAGIC,
  AEL_HEADER_SIZE,
  AEL_INSTR_SIZE,
  OP_RIPPLE,
  OP_INK,
  OP_ORGANITE,
  OP_FIELD,
  OP_UTTER,
  SIGMA_TABLE,
  emptyProgram,
  type AelProgram,
  type AelOpcode,
} from "./opcodes.js";
export {
  encodeExpandedOps,
  decodeProgram,
  readInstr,
  type DecodedInstr,
} from "./encode.js";
export { compileExpression, compileMacro } from "./compile.js";
export { executeProgram } from "./execute.js";
