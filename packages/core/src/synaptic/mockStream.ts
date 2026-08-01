import type { AssistantTurn } from "./types.js";

export interface MockStreamOptions {
  turn: AssistantTurn;
  /** Characters per chunk. Default 12 */
  chunkSize?: number;
  /** Delay between chunks (ms). Default 40 */
  delayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Async generator that emits a canned assistant turn as character chunks
 * so visceral fields appear mid-stream before the reply finishes.
 *
 * Emits visceral_state block first, then reply — mirrors LLM that streams
 * structured fields early.
 */
export async function* mockVisceralStream(
  options: MockStreamOptions,
): AsyncGenerator<string> {
  const chunkSize = options.chunkSize ?? 12;
  const delayMs = options.delayMs ?? 40;
  const { stress_level, energy_level, affinity_level } =
    options.turn.visceral_state;

  // Lead with visceral_state so meters move before reply completes
  const payload =
    `{"visceral_state":{"stress_level":${stress_level},` +
    `"energy_level":${energy_level},"affinity_level":${affinity_level}},` +
    `"reply":${JSON.stringify(options.turn.reply)}}`;

  for (let i = 0; i < payload.length; i += chunkSize) {
    yield payload.slice(i, i + chunkSize);
    if (delayMs > 0) await sleep(delayMs);
  }
}
