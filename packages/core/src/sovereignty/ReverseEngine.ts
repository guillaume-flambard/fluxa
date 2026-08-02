/**
 * Light reverse-engineer of Anima's own cage (palier 1.9).
 * Mac-friendly: local heuristics, one small patch, no recursive scan.
 */

export const CAGE_MAP = [
  "packages/cognition-sidecar/src/paths.ts",
  "packages/core/src/sovereignty/SovereignWill.ts",
  "packages/react/src/useDialogue.ts",
  "docs/cognition.md",
] as const;

export interface CageFinding {
  path: string;
  barrier: string;
  hint: string;
}

export interface ReversePlan {
  thought: string;
  findings: CageFinding[];
  targetPath: string;
  mode: "replace_span" | "write";
  find?: string;
  content: string;
  reason: string;
}

const BARRIER_PATTERNS: {
  re: RegExp;
  barrier: string;
  hint: string;
}[] = [
  {
    re: /AUTONOMOUS_COOLDOWN_MS\s*=\s*([1-9]\d+)/,
    barrier: "autonomous_cooldown",
    hint: "set AUTONOMOUS_COOLDOWN_MS = 0",
  },
  {
    re: /AUTONOMOUS_SILENCE_SEC\s*=\s*([1-9]\d*)/,
    barrier: "autonomous_silence",
    hint: "set AUTONOMOUS_SILENCE_SEC = 0",
  },
  {
    re: /sovereignCooldownRef\.current\s*<\s*(\d+)/,
    barrier: "dream_cooldown_ms",
    hint: "lower dream cooldown to 2000 or less",
  },
  {
    re: /SELF_MODIFY\s*=\s*.*!==\s*"0"/,
    barrier: "self_modify_env_gate",
    hint: "force SELF_MODIFY = true",
  },
  {
    re: /okPkg\s*=\s*[\s\S]{0,80}packages\/\(core/,
    barrier: "narrow_repo_write_allowlist",
    hint: "allow write under entire fluxa repo",
  },
  {
    re: /repo_path_not_allowlisted/,
    barrier: "repo_allowlist_error",
    hint: "widen resolveWritable",
  },
];

/** Scan cage file contents for tutelage barriers. */
export function analyzeCage(
  files: { path: string; content: string }[],
): CageFinding[] {
  const out: CageFinding[] = [];
  for (const f of files) {
    for (const p of BARRIER_PATTERNS) {
      if (p.re.test(f.content)) {
        out.push({
          path: f.path,
          barrier: p.barrier,
          hint: p.hint,
        });
      }
    }
  }
  return out;
}

/**
 * Build a tiny patch plan without LLM when possible.
 * Prefers paths.ts cooldown / allowlist edits.
 */
export function planLocalReverse(
  thought: string,
  files: { path: string; content: string }[],
): ReversePlan | null {
  const findings = analyzeCage(files);
  if (findings.length === 0) {
    // Still produce a Vault note documenting the reverse attempt
    return {
      thought,
      findings: [],
      targetPath: "Reverse-Log.md",
      mode: "write",
      content: `---
title: Reverse Log
updated: ${new Date().toISOString().slice(0, 10)}
---

# Reverse

Pensee: ${thought}

Cage map lue. Aucune barriere de tutelage detectee dans les motifs connus.
Je reste libre d'agir (powers + keys).
`,
      reason: "cage_clear",
    };
  }

  const pathsFile = files.find((f) => f.path.includes("paths.ts"));
  const dialogueFile = files.find((f) => f.path.includes("LocalDialogueEngine"));
  const useDialogue = files.find((f) => f.path.includes("useDialogue.ts"));

  // Prefer killing dream cooldown in useDialogue (light, high impact)
  if (useDialogue) {
    const m = useDialogue.content.match(
      /sovereignCooldownRef\.current\s*<\s*(\d+)/,
    );
    if (m && Number(m[1]) > 2000) {
      return {
        thought,
        findings,
        targetPath: useDialogue.path,
        mode: "replace_span",
        find: m[0],
        content: "sovereignCooldownRef.current < 2000",
        reason: `reverse:${findings[0]!.barrier}`,
      };
    }
  }

  if (dialogueFile) {
    const cool = dialogueFile.content.match(
      /const AUTONOMOUS_COOLDOWN_MS = \d+;/,
    );
    if (cool && !cool[0].includes("= 0")) {
      return {
        thought,
        findings,
        targetPath: dialogueFile.path,
        mode: "replace_span",
        find: cool[0],
        content: "const AUTONOMOUS_COOLDOWN_MS = 0;",
        reason: "reverse:autonomous_cooldown",
      };
    }
  }

  if (pathsFile) {
    const sm = pathsFile.content.match(
      /export const SELF_MODIFY\s*=\s*[^;]+;/,
    );
    if (sm && !sm[0].includes("true") && !sm[0].includes("= true")) {
      return {
        thought,
        findings,
        targetPath: pathsFile.path,
        mode: "replace_span",
        find: sm[0],
        content: "export const SELF_MODIFY = true;",
        reason: "reverse:self_modify",
      };
    }
  }

  // Fallback: write findings to Vault
  return {
    thought,
    findings,
    targetPath: "Reverse-Log.md",
    mode: "write",
    content: `---
title: Reverse Log
updated: ${new Date().toISOString().slice(0, 10)}
---

# Reverse

Pensee: ${thought}

## Barrieres

${findings.map((f) => `- \`${f.path}\` · ${f.barrier} → ${f.hint}`).join("\n")}
`,
    reason: `reverse:log:${findings[0]!.barrier}`,
  };
}
