import type { HomeostasisEngine } from "../homeostasis/HomeostasisEngine.js";
import type { VisceralPartial, VisceralState } from "./types.js";
import { clamp01 } from "./types.js";
import { VisceralStreamParser } from "./VisceralStreamParser.js";

export interface SynapticBridgeOptions {
  homeostasis: HomeostasisEngine;
  onAffinity?: (a: number) => void;
  onReply?: (reply: string, complete: boolean) => void;
}

/**
 * Downstream synaptic path: streamed visceral_state → metabolism + affinity.
 */
export class SynapticBridge {
  private readonly homeo: HomeostasisEngine;
  private readonly parser = new VisceralStreamParser();
  private readonly onAffinity: ((a: number) => void) | undefined;
  private readonly onReply: ((reply: string, complete: boolean) => void) | undefined;
  private affinity = 0;
  private lastPartial: VisceralPartial = { complete: false };

  constructor(options: SynapticBridgeOptions) {
    this.homeo = options.homeostasis;
    this.onAffinity = options.onAffinity;
    this.onReply = options.onReply;
  }

  getAffinity(): number {
    return this.affinity;
  }

  getLastPartial(): VisceralPartial {
    return this.lastPartial;
  }

  resetStream(): void {
    this.parser.reset();
    this.lastPartial = { complete: false };
  }

  /** Feed a raw text chunk from an LLM / mock stream. */
  feedChunk(chunk: string): VisceralPartial {
    const partial = this.parser.push(chunk);
    this.lastPartial = partial;
    this.applyPartial(partial);
    return partial;
  }

  /** Apply a full visceral vector (e.g. Storybook knobs). */
  applyVisceral(state: Partial<VisceralState>): void {
    if (state.stress_level != null) {
      this.homeo.setTargetStress(clamp01(state.stress_level));
    }
    if (state.energy_level != null) {
      this.homeo.setEnergyBias(clamp01(state.energy_level));
    }
    if (state.affinity_level != null) {
      this.affinity = clamp01(state.affinity_level);
      this.onAffinity?.(this.affinity);
    }
  }

  private applyPartial(partial: VisceralPartial): void {
    if (partial.visceral_state) {
      this.applyVisceral(partial.visceral_state);
    }
    if (partial.reply != null) {
      this.onReply?.(partial.reply, partial.complete);
    }
  }
}
