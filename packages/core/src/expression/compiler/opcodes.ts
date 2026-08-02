/** Fixed AEL bytecode opcodes. INVOKEs are gone after compile. */
export const AEL_MAGIC = 0x314c4541; // 'AEL1' LE
export const AEL_HEADER_SIZE = 8;
export const AEL_INSTR_SIZE = 16;

export const OP_RIPPLE = 1;
export const OP_INK = 2;
export const OP_ORGANITE = 3;
export const OP_FIELD = 4;
export const OP_UTTER = 5;

/** Sigma quantization table for ripple flags & 0b11 */
export const SIGMA_TABLE = [0.015, 0.022, 0.03, 0.04] as const;

export type AelOpcode =
  | typeof OP_RIPPLE
  | typeof OP_INK
  | typeof OP_ORGANITE
  | typeof OP_FIELD
  | typeof OP_UTTER;

/**
 * Compiled somatic program: fixed-width instructions + utter string pool.
 * Layout per instruction (16 bytes LE):
 *   opcode:u8 | flags:u8 | pad:u16 | f0:f32 | f1:f32 | f2:f32
 */
export interface AelProgram {
  bytes: Uint8Array;
  strings: string[];
  instructionCount: number;
}

export function emptyProgram(): AelProgram {
  const bytes = new Uint8Array(AEL_HEADER_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, AEL_MAGIC, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  return { bytes, strings: [], instructionCount: 0 };
}
