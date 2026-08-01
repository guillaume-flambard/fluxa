import {
  clamp01,
  type AssistantTurn,
  type VisceralPartial,
  type VisceralState,
} from "./types.js";

const FIELD_RE: Record<keyof VisceralState, RegExp> = {
  stress_level: /"stress_level"\s*:\s*(-?\d+(?:\.\d+)?)/,
  energy_level: /"energy_level"\s*:\s*(-?\d+(?:\.\d+)?)/,
  affinity_level: /"affinity_level"\s*:\s*(-?\d+(?:\.\d+)?)/,
};

const REPLY_RE = /"reply"\s*:\s*"((?:\\.|[^"\\])*)"/;

/**
 * Incremental parser for assistant turns streamed as JSON chunks.
 * Extracts visceral_state numerics as soon as they appear; no JSON-repair lib.
 */
export class VisceralStreamParser {
  private buffer = "";

  reset(): void {
    this.buffer = "";
  }

  /** Append a text chunk; returns latest partial / complete view. */
  push(chunk: string): VisceralPartial {
    this.buffer += chunk;
    return this.snapshot();
  }

  snapshot(): VisceralPartial {
    const visceral_state: Partial<VisceralState> = {};
    for (const key of Object.keys(FIELD_RE) as (keyof VisceralState)[]) {
      const m = this.buffer.match(FIELD_RE[key]);
      if (m?.[1] != null) {
        visceral_state[key] = clamp01(Number(m[1]));
      }
    }

    let reply: string | undefined;
    const rm = this.buffer.match(REPLY_RE);
    if (rm?.[1] != null) {
      reply = rm[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }

    const complete = tryParseComplete(this.buffer);
    if (complete) {
      return {
        reply: complete.reply,
        visceral_state: complete.visceral_state,
        complete: true,
      };
    }

    const out: VisceralPartial = { complete: false };
    if (reply !== undefined) out.reply = reply;
    if (Object.keys(visceral_state).length > 0) {
      out.visceral_state = visceral_state;
    }
    return out;
  }
}

function tryParseComplete(buf: string): AssistantTurn | null {
  const start = buf.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < buf.length; i++) {
    const c = buf[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(buf.slice(start, i + 1)) as Partial<AssistantTurn>;
          if (typeof obj.reply !== "string" || !obj.visceral_state) return null;
          const vs = obj.visceral_state;
          return {
            reply: obj.reply,
            visceral_state: {
              stress_level: clamp01(Number(vs.stress_level ?? 0)),
              energy_level: clamp01(Number(vs.energy_level ?? 0)),
              affinity_level: clamp01(Number(vs.affinity_level ?? 0)),
            },
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
