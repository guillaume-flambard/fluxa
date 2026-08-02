import {
  CognitiveCore,
  CortexService,
  DialectStore,
  type AnimaMacro,
  type LlmCortexConfig,
} from "@fluxa/core";

/**
 * Read OpenAI-compatible cortex config from Vite env (host only).
 * VITE_ANIMA_LLM_BASE_URL + VITE_ANIMA_LLM_API_KEY required; model optional.
 */
export function readLlmConfigFromEnv(
  env: Record<string, string | undefined> = {},
): LlmCortexConfig | null {
  const baseUrl = env.VITE_ANIMA_LLM_BASE_URL?.trim();
  const apiKey = env.VITE_ANIMA_LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  const model = env.VITE_ANIMA_LLM_MODEL?.trim();
  const cfg: LlmCortexConfig = { baseUrl, apiKey };
  if (model) cfg.model = model;
  return cfg;
}

export function readCognitionUrlFromEnv(
  env: Record<string, string | undefined> = {},
): string | null {
  const url = env.VITE_FLUXA_COGNITION_URL?.trim();
  return url || null;
}

export function createAnimaWill(opts?: {
  llm?: LlmCortexConfig | null;
  sidecarUrl?: string | null;
}): {
  dialect: DialectStore;
  cortex: CortexService;
  cognitive: CognitiveCore;
} {
  const dialect = new DialectStore();
  const llm = opts?.llm ?? null;
  const cortex = new CortexService({
    dialect,
    llm,
  });
  const cognitive = new CognitiveCore({
    llm,
    sidecarUrl: opts?.sidecarUrl ?? null,
  });
  return { dialect, cortex, cognitive };
}

export type InventBirthHandler = (macro: AnimaMacro) => void;
