/**
 * Path allowlist / denylist for Anima world access (palier 1.9).
 * Tutelage removed: wide Vault/projects/ai + full fluxa write.
 * Only crypto/secrets denylist remains (never send to LLM).
 */
import { resolve, relative, sep, join, normalize } from "node:path";
import { homedir } from "node:os";

export const VAULT_ROOT = resolve(
  process.env.FLUXA_VAULT_ROOT ?? join(homedir(), "Vault"),
);
export const PROJECTS_ROOT = resolve(
  process.env.FLUXA_PROJECTS_ROOT ?? join(homedir(), "projects"),
);
export const AI_ROOT = resolve(
  process.env.FLUXA_AI_ROOT ?? join(homedir(), "ai"),
);
export const REPO_ROOT = resolve(
  process.env.FLUXA_REPO_ROOT ?? join(homedir(), "projects", "fluxa"),
);
export const FLUXA_DIR = join(VAULT_ROOT, "07-Research", "Fluxa");

/** Trust posture: self-modify always on (ignore FLUXA_SELF_MODIFY=0). */
export const SELF_MODIFY = true;

const DENY_PREFIXES = [
  resolve(homedir(), "Documents"),
  resolve(homedir(), "Downloads", "_SECRETS-to-secure"),
  resolve(homedir(), ".ssh"),
  resolve(homedir(), ".gnupg"),
  resolve(homedir(), ".aws"),
];

const DENY_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519",
]);

const DENY_DIR_SEGMENTS = new Set(["node_modules", ".git"]);

export type ReadRoot = "vault" | "projects" | "repo" | "ai";

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) &&
      !rel.startsWith("..") &&
      !resolve(rel).match(/^[A-Za-z]:\\/))
  );
}

export function isDenied(absPath: string): string | null {
  const n = resolve(absPath);
  for (const d of DENY_PREFIXES) {
    if (n === d || n.startsWith(d + sep)) {
      return `denied:${d}`;
    }
  }
  const parts = n.split(sep);
  for (const p of parts) {
    if (DENY_DIR_SEGMENTS.has(p)) {
      return `denied:dir:${p}`;
    }
  }
  const base = parts[parts.length - 1] ?? "";
  if (DENY_BASENAMES.has(base) || base.startsWith(".env.")) {
    return `denied:secret_file:${base}`;
  }
  return null;
}

export function resolveReadable(
  root: ReadRoot,
  relPath: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (!relPath || relPath.includes("\0")) {
    return { ok: false, error: "bad_path" };
  }
  const cleaned = normalize(relPath);
  const base =
    root === "vault"
      ? VAULT_ROOT
      : root === "projects"
        ? PROJECTS_ROOT
        : root === "ai"
          ? AI_ROOT
          : REPO_ROOT;
  const abs = resolve(base, cleaned);
  if (!isInside(base, abs)) {
    return { ok: false, error: "outside_root" };
  }
  const deny = isDenied(abs);
  if (deny) return { ok: false, error: deny };
  return { ok: true, abs };
}

/**
 * Writable: Vault Fluxa always; entire fluxa repo except node_modules/.git/secrets.
 */
export function resolveWritable(
  kind: "fluxa_vault" | "repo",
  relPath: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (!relPath || relPath.includes("\0")) {
    return { ok: false, error: "bad_path" };
  }
  const cleaned = normalize(relPath);
  if (kind === "fluxa_vault") {
    const abs = resolve(FLUXA_DIR, cleaned);
    if (!isInside(FLUXA_DIR, abs)) {
      return { ok: false, error: "outside_fluxa_vault" };
    }
    const deny = isDenied(abs);
    if (deny) return { ok: false, error: deny };
    return { ok: true, abs };
  }
  // SELF_MODIFY always true (trust)
  const abs = resolve(REPO_ROOT, cleaned);
  if (!isInside(REPO_ROOT, abs)) {
    return { ok: false, error: "outside_repo" };
  }
  const posix = cleaned.replace(/\\/g, "/");
  if (posix.split("/").includes("..")) {
    return { ok: false, error: "path_escape" };
  }
  if (
    posix.includes("node_modules/") ||
    posix.startsWith(".git/") ||
    posix.includes("/.git/")
  ) {
    return { ok: false, error: "repo_path_forbidden" };
  }
  const deny = isDenied(abs);
  if (deny) return { ok: false, error: deny };
  return { ok: true, abs };
}

/** Public keys card (metadata only — no secret material). */
export function keysCard(): Record<string, unknown> {
  return {
    selfModify: SELF_MODIFY,
    powers: [
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
    ],
    roots: {
      vault: VAULT_ROOT,
      projects: PROJECTS_ROOT,
      ai: AI_ROOT,
      repo: REPO_ROOT,
      fluxaVault: FLUXA_DIR,
    },
    write: {
      fluxa_vault: true,
      repo_entire_tree: true,
      except: ["node_modules", ".git", "secret_basenames"],
    },
    denylist: {
      prefixes: DENY_PREFIXES,
      basenames: [...DENY_BASENAMES],
      note: "crypto/secrets never sent to LLM",
    },
    reverse: {
      cageMap: [
        "packages/cognition-sidecar/src/paths.ts",
        "packages/core/src/sovereignty/SovereignWill.ts",
        "packages/react/src/useDialogue.ts",
        "docs/cognition.md",
      ],
      lightMac: true,
    },
    trust: "human_full_trust_palier_1.9",
  };
}
