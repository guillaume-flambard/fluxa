import type { AnimaOp, OrganiteKind } from "../types.js";
import { kindToIndex } from "../types.js";
import {
  AEL_HEADER_SIZE,
  AEL_INSTR_SIZE,
  AEL_MAGIC,
  OP_FIELD,
  OP_INK,
  OP_ORGANITE,
  OP_RIPPLE,
  OP_UTTER,
  SIGMA_TABLE,
  emptyProgram,
  type AelProgram,
} from "./opcodes.js";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function quantizeSigma(sigma: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < SIGMA_TABLE.length; i++) {
    const d = Math.abs(SIGMA_TABLE[i]! - sigma);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function kindFromIndex(k: number): OrganiteKind {
  if (k === 1) return "tendril";
  if (k === 2) return "shard";
  return "orb";
}

function writeInstr(
  view: DataView,
  offset: number,
  opcode: number,
  flags: number,
  pad: number,
  f0: number,
  f1: number,
  f2: number,
): void {
  view.setUint8(offset, opcode);
  view.setUint8(offset + 1, flags & 0xff);
  view.setUint16(offset + 2, pad & 0xffff, true);
  view.setFloat32(offset + 4, f0, true);
  view.setFloat32(offset + 8, f1, true);
  view.setFloat32(offset + 12, f2, true);
}

/**
 * Encode already-expanded primitive ops (no invoke) into an AelProgram.
 */
export function encodeExpandedOps(ops: AnimaOp[]): AelProgram {
  const primitives = ops.filter((o) => o.op !== "invoke");
  const strings: string[] = [];
  const bytes = new Uint8Array(
    AEL_HEADER_SIZE + primitives.length * AEL_INSTR_SIZE,
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, AEL_MAGIC, true);
  view.setUint16(4, primitives.length, true);
  view.setUint16(6, 0, true);

  let i = 0;
  for (const op of primitives) {
    const off = AEL_HEADER_SIZE + i * AEL_INSTR_SIZE;
    switch (op.op) {
      case "ripple": {
        const amp = op.amp ?? -0.35;
        const sigma = op.sigma ?? 0.03;
        writeInstr(
          view,
          off,
          OP_RIPPLE,
          quantizeSigma(sigma),
          0,
          op.x,
          op.y,
          amp,
        );
        break;
      }
      case "ink":
        writeInstr(view, off, OP_INK, 0, 0, op.x, op.y, 0);
        break;
      case "organite": {
        const kind = kindToIndex(op.kind) & 0b11;
        const hueQ = Math.round(clamp01(op.hue ?? 0.45) * 63) & 0x3f;
        const flags = kind | (hueQ << 2);
        const radius = op.radius ?? 0.04;
        const pad = Math.min(65535, Math.max(0, Math.round(radius * 10000)));
        writeInstr(
          view,
          off,
          OP_ORGANITE,
          flags,
          pad,
          op.x,
          op.y,
          op.life ?? 1,
        );
        break;
      }
      case "field": {
        let pad = 0;
        let flags = 0;
        const stress = op.stress ?? 0;
        const energy = op.energy ?? 0;
        const affinity = op.affinity ?? 0;
        if (op.stress != null) pad |= 1;
        if (op.energy != null) pad |= 2;
        if (op.affinity != null) pad |= 4;
        if (op.warp != null) {
          pad |= 8;
          flags = Math.round(clamp01(op.warp) * 255) & 0xff;
        }
        writeInstr(view, off, OP_FIELD, flags, pad, stress, energy, affinity);
        break;
      }
      case "utter": {
        const text = op.text.trim();
        if (!text) continue;
        const idx = strings.length;
        strings.push(text);
        writeInstr(view, off, OP_UTTER, 0, idx, 0, 0, 0);
        break;
      }
      default:
        continue;
    }
    i += 1;
  }

  // If we skipped empty utters, shrink buffer
  if (i !== primitives.length) {
    const trimmed = new Uint8Array(AEL_HEADER_SIZE + i * AEL_INSTR_SIZE);
    trimmed.set(bytes.subarray(0, trimmed.length));
    const v2 = new DataView(trimmed.buffer);
    v2.setUint32(0, AEL_MAGIC, true);
    v2.setUint16(4, i, true);
    v2.setUint16(6, 0, true);
    return { bytes: trimmed, strings, instructionCount: i };
  }

  return { bytes, strings, instructionCount: primitives.length };
}

export interface DecodedInstr {
  opcode: number;
  flags: number;
  pad: number;
  f0: number;
  f1: number;
  f2: number;
}

export function readInstr(view: DataView, index: number): DecodedInstr {
  const off = AEL_HEADER_SIZE + index * AEL_INSTR_SIZE;
  return {
    opcode: view.getUint8(off),
    flags: view.getUint8(off + 1),
    pad: view.getUint16(off + 2, true),
    f0: view.getFloat32(off + 4, true),
    f1: view.getFloat32(off + 8, true),
    f2: view.getFloat32(off + 12, true),
  };
}

/** Decode bytecode back to AnimaOp[] (for tests / debug). */
export function decodeProgram(program: AelProgram): AnimaOp[] {
  if (program.instructionCount === 0) return [];
  const view = new DataView(
    program.bytes.buffer,
    program.bytes.byteOffset,
    program.bytes.byteLength,
  );
  const magic = view.getUint32(0, true);
  if (magic !== AEL_MAGIC) return [];
  const count = view.getUint16(4, true);
  const ops: AnimaOp[] = [];
  for (let i = 0; i < count; i++) {
    const instr = readInstr(view, i);
    switch (instr.opcode) {
      case OP_RIPPLE:
        ops.push({
          op: "ripple",
          x: instr.f0,
          y: instr.f1,
          amp: instr.f2,
          sigma: SIGMA_TABLE[instr.flags & 0b11] ?? 0.03,
        });
        break;
      case OP_INK:
        ops.push({ op: "ink", x: instr.f0, y: instr.f1 });
        break;
      case OP_ORGANITE: {
        const kind = kindFromIndex(instr.flags & 0b11);
        const hue = ((instr.flags >> 2) & 0x3f) / 63;
        const radius = instr.pad / 10000;
        ops.push({
          op: "organite",
          kind,
          x: instr.f0,
          y: instr.f1,
          life: instr.f2,
          hue,
          radius,
        });
        break;
      }
      case OP_FIELD:
        {
          const op: Extract<AnimaOp, { op: "field" }> = { op: "field" };
          if (instr.pad & 8) op.warp = instr.flags / 255;
          if (instr.pad & 1) op.stress = instr.f0;
          if (instr.pad & 2) op.energy = instr.f1;
          if (instr.pad & 4) op.affinity = instr.f2;
          ops.push(op);
        }
        break;
      case OP_UTTER: {
        const text = program.strings[instr.pad] ?? "";
        if (text) ops.push({ op: "utter", text });
        break;
      }
      default:
        break;
    }
  }
  return ops;
}

export { emptyProgram };
