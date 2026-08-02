/**
 * Living matter: raw work context that grounds Anima's thought.
 * Sourced from cognition sidecar /matter (vault + optional git), or host inject.
 */

export interface WorldSnippet {
  root?: string;
  path?: string;
  content?: string;
}

export interface LivingMatter {
  /** `git status -sb` + short diff --stat */
  gitStat?: string;
  /** Last compile / runtime error snippet */
  lastError?: string;
  /** Excerpt from a recently touched Vault note */
  vaultExcerpt?: string;
  /** Recent Monde-Mental / journal titles */
  vaultTitles?: string[];
  /** Freeform host note (build log line, sprint focus, etc.) */
  note?: string;
  fetchedAt?: number;
  /** Her world map (journal, agenda, monde propre, mutations) */
  herWorld?: Record<string, unknown>;
  /** Human world map (profile, projects, fluxa notes) */
  yourWorld?: Record<string, unknown>;
  /** Recent /read snippets */
  readSnippets?: WorldSnippet[];
  /** Powers available this session */
  powers?: string[];
  selfModify?: boolean;
  /** Powers / keys card from sidecar GET /keys */
  keys?: Record<string, unknown>;
}

export function livingMatterEmpty(m: LivingMatter | null | undefined): boolean {
  if (!m) return true;
  return !(
    m.gitStat?.trim() ||
    m.lastError?.trim() ||
    m.vaultExcerpt?.trim() ||
    (m.vaultTitles && m.vaultTitles.length > 0) ||
    m.note?.trim() ||
    m.herWorld ||
    m.yourWorld ||
    (m.readSnippets && m.readSnippets.length > 0)
  );
}

/** Powers Anima may choose among (never imposed). */
export const ANIMA_POWERS = [
  "think",
  "speak",
  "silence",
  "read",
  "write_note",
  "mutate",
  "autocode",
  "refuse",
  "invent",
  "reverse",
] as const;

export type AnimaPower = (typeof ANIMA_POWERS)[number];
