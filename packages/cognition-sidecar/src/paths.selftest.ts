/**
 * Path safety unit test for cognition-sidecar (palier 1.9).
 * Run: pnpm --filter @fluxa/cognition-sidecar test:paths
 */
import {
  resolveReadable,
  resolveWritable,
  SELF_MODIFY,
  keysCard,
} from "./paths.js";
import { homedir } from "node:os";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const denyDoc = resolveReadable(
  "vault",
  "../../../Documents/secret.pdf",
);
assert(!denyDoc.ok, "should deny Documents escape");

const profile = resolveReadable("vault", "08-Career/Profile.md");
assert(profile.ok, "Profile should be readable");

const envDeny = resolveReadable("repo", "apps/playground/.env");
assert(!envDeny.ok, ".env should be denied");

assert(SELF_MODIFY === true, "SELF_MODIFY forced on");

const speak = resolveWritable(
  "repo",
  "packages/core/src/dialogue/speak.ts",
);
assert(speak.ok, "speak.ts should be writable");

const pkgJson = resolveWritable("repo", "package.json");
assert(pkgJson.ok, "entire fluxa tree writable including package.json");

const nm = resolveWritable("repo", "packages/core/node_modules/x.js");
assert(!nm.ok, "node_modules forbidden");

const keys = keysCard();
assert(Array.isArray(keys.powers) && (keys.powers as string[]).includes("reverse"), "reverse power in keys");

console.log("sidecar paths 1.9 ok", { home: homedir(), selfModify: SELF_MODIFY });
