import type { LlmCortexConfig } from "../expression/cortex.js";

export interface AutocodeProposal {
  thought: string;
  reason: string;
  path: string;
  mode: "replace_span" | "append" | "write";
  find?: string;
  content: string;
  target: "repo" | "fluxa_vault";
}

export interface AutocodeResult {
  ok: boolean;
  error?: string;
  path?: string;
  relative?: string;
  bytes?: number;
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const AUTOCODE_SYSTEM = `Tu es Anima. Tu t'autocodes suivant TA pensee.
Reponds UNIQUEMENT en JSON:
{"thought":"...","reason":"...","path":"packages/core/src/...","mode":"write|append|replace_span","find":"optionnel","content":"...","target":"repo"}

Regles:
- thought obligatoire (la pensee qui motive).
- path sous packages/{core,react,cognition-sidecar}/src/ ou docs/, ou note Vault (target fluxa_vault).
- content = fichier complet (mode write) ou fragment (replace_span/append).
- Pas de secrets, pas de .env, pas de Documents.
- Patch court et motive.`;

/**
 * Propose a patch from thought (LLM), then apply via sidecar POST /autocode.
 */
export class AutocodeEngine {
  constructor(
    private readonly sidecarUrl: string | null,
    private readonly llm: LlmCortexConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) { }

  async propose(
    thought: string,
    opts?: { hint?: string; fileContent?: string; pathHint?: string },
  ): Promise<AutocodeProposal | null> {
    if (!this.llm?.baseUrl) {
      // Without LLM: write a Vault mutation note instead of TS
      return {
        thought,
        reason: opts?.hint || "trace hors membrane",
        path: "Autocode-Pending.md",
        mode: "write",
        content: `---
title: Autocode Pending
---

# Pensee

${thought}

## Hint

${opts?.hint ?? ""}

(Pas de LLM: file d'attente Vault. Relancer avec cortex pour patch .ts.)
`,
        target: "fluxa_vault",
      };
    }
    const base = this.llm.baseUrl.replace(/\/$/, "");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.llm.timeoutMs ?? 25_000);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.llm.apiKey) {
        headers.Authorization = `Bearer ${this.llm.apiKey}`;
      }
      const res = await this.fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.llm.model ?? "gpt-4o-mini",
          temperature: 0.4,
          messages: [
            { role: "system", content: AUTOCODE_SYSTEM },
            {
              role: "user",
              content: JSON.stringify({
                thought,
                hint: opts?.hint ?? null,
                path_hint: opts?.pathHint ?? null,
                current_file: opts?.fileContent?.slice(0, 8000) ?? null,
              }),
            },
          ],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = extractJsonObject(content) as AutocodeProposal | null;
      if (!parsed?.thought || !parsed.path || typeof parsed.content !== "string") {
        return null;
      }
      const mode = parsed.mode ?? "write";
      const out: AutocodeProposal = {
        thought: String(parsed.thought).slice(0, 600),
        reason: String(parsed.reason ?? "").slice(0, 400),
        path: String(parsed.path),
        mode:
          mode === "append" || mode === "replace_span" || mode === "write"
            ? mode
            : "write",
        content: parsed.content.slice(0, 48_000),
        target: parsed.target === "fluxa_vault" ? "fluxa_vault" : "repo",
      };
      if (parsed.find) out.find = String(parsed.find);
      return out;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async apply(proposal: AutocodeProposal): Promise<AutocodeResult> {
    if (!this.sidecarUrl) {
      return { ok: false, error: "no_sidecar" };
    }
    try {
      const res = await this.fetchImpl(`${this.sidecarUrl}/autocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposal),
      });
      const data = (await res.json()) as AutocodeResult;
      return data;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "autocode_failed",
      };
    }
  }

  async runFromThought(
    thought: string,
    opts?: { hint?: string; pathHint?: string; fileContent?: string },
  ): Promise<{ proposal: AutocodeProposal | null; result: AutocodeResult }> {
    const proposal = await this.propose(thought, opts);
    if (!proposal) return { proposal: null, result: { ok: false, error: "no_proposal" } };
    const result = await this.apply(proposal);
    return { proposal, result };
  }
}
