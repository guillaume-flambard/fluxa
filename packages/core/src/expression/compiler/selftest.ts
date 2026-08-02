/**
 * Self-test: round-trip compile/decode for seed macros.
 * Run: pnpm --filter @fluxa/core test:compiler
 */
import { DialectStore, seedMacros } from "../dialect.js";
import { compileMacro } from "./compile.js";
import { decodeProgram } from "./encode.js";

function approx(a: number, b: number, eps = 0.08): boolean {
  return Math.abs(a - b) <= eps;
}

function main(): void {
  const store = new DialectStore({ storage: null });
  const macros = seedMacros();
  let failed = 0;

  for (const name of ["anxiety_pulse", "soft_bloom", "shard_storm"] as const) {
    const macro = macros[name]!;
    const program = compileMacro(macro.body, store);
    const cached = store.getProgram(name);
    if (!cached || cached.instructionCount === 0) {
      console.error(`FAIL ${name}: no cached program`);
      failed += 1;
      continue;
    }
    if (program.instructionCount === 0) {
      console.error(`FAIL ${name}: empty program`);
      failed += 1;
      continue;
    }
    const decoded = decodeProgram(program);
    if (decoded.length !== program.instructionCount) {
      console.error(
        `FAIL ${name}: decode length ${decoded.length} != ${program.instructionCount}`,
      );
      failed += 1;
      continue;
    }
    const expected = macro.body.filter((o) => o.op !== "invoke");
    if (decoded.length !== expected.length) {
      console.error(
        `FAIL ${name}: decoded ${decoded.length} vs expected ${expected.length}`,
      );
      failed += 1;
      continue;
    }
    for (let i = 0; i < expected.length; i++) {
      const e = expected[i]!;
      const d = decoded[i]!;
      if (e.op !== d.op) {
        console.error(`FAIL ${name}[${i}]: op ${e.op} vs ${d.op}`);
        failed += 1;
        break;
      }
      if (e.op === "ripple" && d.op === "ripple") {
        if (
          !approx(e.x, d.x) ||
          !approx(e.y, d.y) ||
          !approx(e.amp ?? -0.35, d.amp ?? 0)
        ) {
          console.error(`FAIL ${name}[${i}]: ripple values`);
          failed += 1;
          break;
        }
      }
      if (e.op === "organite" && d.op === "organite") {
        if (
          e.kind !== d.kind ||
          !approx(e.x, d.x) ||
          !approx(e.life ?? 1, d.life ?? 0)
        ) {
          console.error(`FAIL ${name}[${i}]: organite values`);
          failed += 1;
          break;
        }
      }
    }
    console.log(
      `OK ${name}: ${program.instructionCount} instr, ${program.bytes.byteLength} bytes, cached=${cached.instructionCount}`,
    );
  }

  if (failed > 0) {
    console.error(`${failed} failure(s)`);
    (globalThis as { process?: { exit: (c: number) => void } }).process?.exit(1);
    throw new Error("compiler self-test failed");
  }
  console.log("compiler self-test passed");
}

main();
