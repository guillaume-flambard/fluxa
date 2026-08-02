import type { VisceralState } from "../../synaptic/types.js";
import type { ExpressionHost } from "../types.js";
import { readInstr } from "./encode.js";
import {
  AEL_MAGIC,
  OP_FIELD,
  OP_INK,
  OP_ORGANITE,
  OP_RIPPLE,
  OP_UTTER,
  SIGMA_TABLE,
  type AelProgram,
} from "./opcodes.js";

/**
 * Execute compiled bytecode against the soma host. No AST / string op tags.
 */
export function executeProgram(
  host: ExpressionHost,
  program: AelProgram,
  visceral?: VisceralState,
): string | undefined {
  let utter: string | undefined;
  if (program.instructionCount > 0) {
    const view = new DataView(
      program.bytes.buffer,
      program.bytes.byteOffset,
      program.bytes.byteLength,
    );
    if (view.getUint32(0, true) !== AEL_MAGIC) {
      host.wake();
      return undefined;
    }
    const count = Math.min(program.instructionCount, view.getUint16(4, true));
    for (let i = 0; i < count; i++) {
      const instr = readInstr(view, i);
      switch (instr.opcode) {
        case OP_RIPPLE:
          host.enqueueRipple(
            instr.f0,
            instr.f1,
            instr.f2,
            SIGMA_TABLE[instr.flags & 0b11] ?? 0.03,
          );
          break;
        case OP_INK:
          host.pushInk(instr.f0, instr.f1);
          break;
        case OP_ORGANITE: {
          const kind = instr.flags & 0b11;
          const hue = ((instr.flags >> 2) & 0x3f) / 63;
          const radius = instr.pad / 10000;
          host.spawnOrganite({
            x: instr.f0,
            y: instr.f1,
            kind,
            life: instr.f2,
            hue,
            radius: radius > 0 ? radius : 0.04,
          });
          break;
        }
        case OP_FIELD: {
          const partial: {
            warp?: number;
            stress?: number;
            energy?: number;
            affinity?: number;
          } = {};
          if (instr.pad & 8) partial.warp = instr.flags / 255;
          if (instr.pad & 1) partial.stress = instr.f0;
          if (instr.pad & 2) partial.energy = instr.f1;
          if (instr.pad & 4) partial.affinity = instr.f2;
          host.applyField(partial);
          break;
        }
        case OP_UTTER: {
          const text = program.strings[instr.pad]?.trim();
          if (text) utter = text;
          break;
        }
        default:
          break;
      }
    }
  }

  if (visceral) {
    host.applyField({
      stress: visceral.stress_level,
      energy: visceral.energy_level,
      affinity: visceral.affinity_level,
    });
  }
  host.wake();
  return utter;
}
